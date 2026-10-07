import type { Catalog } from '../../schema/catalog';
import type { Exam, RichText } from '../types/exam';
import { isCompatibleAttempt, type Attempt, type AttemptMode } from './exam-state';
import { summary } from './persistence';
import { completedReviewAttemptSchema, sameAttemptAcademic } from './review-history';
import { reviewQuestionStatus } from './review-filters';
import { sameContent } from './content-equality';
import { loadExam } from './exam-loader';
import {
  captureNotebookRaws,
  parseNotebookKey,
  readNotebookSources,
  sameNotebookRaws,
  type NotebookIdentity,
  type NotebookSources,
  type NotebookStorage,
  type NotebookWarning,
} from './error-notebook-storage';

export type NotebookOutcome = {
  attemptId: string;
  mode: AttemptMode;
  attemptStartedAt: string;
  attemptCompletedAt: string;
  outcome: 'correct' | 'incorrect';
};
export type QuestionPerformance = {
  examId: string;
  examRevision: number;
  questionId: string;
  examTitle: string;
  subject: string;
  questionLabel: string;
  statement: RichText;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  firstAnsweredAttemptCompletedAt: string;
  lastAnsweredAttemptCompletedAt: string;
  firstWrongAttemptCompletedAt: string;
  lastWrongAttemptCompletedAt: string;
  lastOutcome: 'correct' | 'incorrect';
  lastAnsweredAttemptId: string;
  outcomes: NotebookOutcome[];
  chronologyTie: boolean;
};
export type NotebookCategory = 'all' | 'pending' | 'recurring' | 'never-correct' | 'overcome';
export type NotebookFilters = { category: NotebookCategory; subject: string; examId: string };
export const defaultNotebookFilters: NotebookFilters = { category: 'all', subject: '', examId: '' };
export const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function notebookCategories(item: QuestionPerformance) {
  return {
    pending: item.wrongCount > 0 && item.lastOutcome === 'incorrect',
    recurring: item.wrongCount >= 2,
    'never-correct': item.wrongCount > 0 && item.correctCount === 0,
    overcome: item.wrongCount > 0 && item.lastOutcome === 'correct',
  };
}
export function compareNotebookItems(a: QuestionPerformance, b: QuestionPerformance): number {
  const ac = notebookCategories(a),
    bc = notebookCategories(b);
  return (
    Number(bc.pending) - Number(ac.pending) ||
    Number(bc['never-correct']) - Number(ac['never-correct']) ||
    b.wrongCount - a.wrongCount ||
    Date.parse(b.lastWrongAttemptCompletedAt) - Date.parse(a.lastWrongAttemptCompletedAt) ||
    lexical(a.examId, b.examId) ||
    a.examRevision - b.examRevision ||
    lexical(a.questionId, b.questionId)
  );
}
export function filterNotebookItems(items: QuestionPerformance[], filters: NotebookFilters) {
  return items.filter(
    (item) =>
      (filters.category === 'all' || notebookCategories(item)[filters.category]) &&
      (!filters.subject || item.subject === filters.subject) &&
      (!filters.examId || item.examId === filters.examId),
  );
}
export function notebookCounts(items: QuestionPerformance[]) {
  const counts = { all: items.length, pending: 0, recurring: 0, 'never-correct': 0, overcome: 0 };
  for (const item of items) {
    const categories = notebookCategories(item);
    for (const category of Object.keys(categories) as (keyof typeof categories)[])
      if (categories[category]) counts[category]++;
  }
  return counts;
}

export function aggregateNotebookExam(exam: Exam, sources: NotebookSources) {
  const warnings = [...sources.warnings];
  const copies = new Map<string, Attempt[]>();
  for (const attempt of sources.detailed)
    copies.set(attempt.id, [...(copies.get(attempt.id) ?? []), attempt]);
  const attempts: Attempt[] = [];
  const warnConflict = () =>
    warnings.push({
      id: exam.id,
      revision: exam.revision,
      kind: 'conflict',
      message:
        'Conflito entre cópias detalhadas ou resumo da mesma tentativa. A tentativa foi excluída da análise; a cobertura é parcial.',
    });
  for (const [id, representations] of copies) {
    const reference = representations[0]!;
    // Academic conflicts exclude the ID before any compatibility fallback.
    if (representations.some((attempt) => !sameAttemptAcademic(reference, attempt))) {
      warnConflict();
      continue;
    }
    const compatible = representations.filter(
      (attempt) =>
        completedReviewAttemptSchema.safeParse(attempt).success &&
        isCompatibleAttempt(exam, attempt),
    );
    if (compatible.length !== representations.length)
      warnings.push({
        id: exam.id,
        revision: exam.revision,
        kind: 'invalid-source',
        message:
          'Uma representação detalhada é incompatível e foi excluída da análise. A cobertura é parcial; o registro foi preservado.',
      });
    // Reader orders current, archive, embedded; prefer the first compatible copy.
    const preferred = compatible[0];
    if (!preferred) continue;
    if (sources.summaries.some((entry) => entry.id === id && !sameContent(entry, summary(preferred))))
      warnConflict();
    else attempts.push(preferred);
  }
  if (sources.summaries.some((entry) => !attempts.some((attempt) => attempt.id === entry.id)))
    warnings.push({
      id: exam.id,
      revision: exam.revision,
      kind: 'partial',
      message:
        'Há tentativas disponíveis apenas como resumos. Esses registros não identificam erros por questão; a cobertura é parcial.',
    });
  attempts.sort(
    (a, b) => Date.parse(a.completedAt!) - Date.parse(b.completedAt!) || lexical(a.id, b.id),
  );
  const outcomesByQuestion = new Map<string, NotebookOutcome[]>();
  for (const attempt of attempts)
    for (const question of exam.questions) {
      const outcome = reviewQuestionStatus(question, attempt);
      if (outcome !== 'correct' && outcome !== 'incorrect') continue;
      const outcomes = outcomesByQuestion.get(question.id) ?? [];
      outcomes.push({
        attemptId: attempt.id,
        mode: attempt.mode,
        attemptStartedAt: attempt.startedAt,
        attemptCompletedAt: attempt.completedAt!,
        outcome,
      });
      outcomesByQuestion.set(question.id, outcomes);
    }
  const items: QuestionPerformance[] = [];
  for (const question of exam.questions) {
    const outcomes = outcomesByQuestion.get(question.id) ?? [];
    const wrong = outcomes.filter((outcome) => outcome.outcome === 'incorrect');
    if (!wrong.length) continue;
    const first = outcomes[0]!,
      last = outcomes.at(-1)!;
    items.push({
      examId: exam.id,
      examRevision: exam.revision,
      questionId: question.id,
      examTitle: exam.title,
      subject: exam.subject,
      questionLabel: question.label || question.id,
      statement: question.statement,
      answeredCount: outcomes.length,
      correctCount: outcomes.length - wrong.length,
      wrongCount: wrong.length,
      firstAnsweredAttemptCompletedAt: first.attemptCompletedAt,
      lastAnsweredAttemptCompletedAt: last.attemptCompletedAt,
      firstWrongAttemptCompletedAt: wrong[0]!.attemptCompletedAt,
      lastWrongAttemptCompletedAt: wrong.at(-1)!.attemptCompletedAt,
      lastOutcome: last.outcome,
      lastAnsweredAttemptId: last.attemptId,
      outcomes,
      chronologyTie: outcomes.some(
        (outcome) =>
          Date.parse(outcome.attemptCompletedAt) === Date.parse(last.attemptCompletedAt) &&
          outcome.outcome !== last.outcome,
      ),
    });
  }
  return { items, warnings, attemptCount: attempts.length };
}

export type NotebookSnapshot = {
  items: QuestionPerformance[];
  warnings: NotebookWarning[];
  historical: NotebookIdentity[];
  attemptCount: number;
  hasHistory: boolean;
  coverage: 'complete' | 'partial' | 'unavailable';
  error: string | null;
};
type ExamLoader = (id: string, signal?: AbortSignal) => Promise<Exam>;
const defaultLoader: ExamLoader = (id, signal) => loadExam(id, fetch, signal);
function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Leitura cancelada.', 'AbortError');
}
const unavailable = (error: string): NotebookSnapshot => ({
  items: [],
  warnings: [],
  historical: [],
  attemptCount: 0,
  hasHistory: false,
  coverage: 'unavailable',
  error,
});

export async function readErrorNotebook(
  catalog: Catalog,
  storage: () => NotebookStorage = () => window.localStorage,
  loader: ExamLoader = defaultLoader,
  signal?: AbortSignal,
): Promise<NotebookSnapshot> {
  // Local to this refresh only; a retry never downloads the same revision twice.
  const loaded = new Map<string, Promise<Exam>>();
  for (let read = 0; read < 2; read++) {
    assertActive(signal);
    let store: NotebookStorage, raws: Map<string, string | null>;
    try {
      store = storage();
      raws = captureNotebookRaws(catalog, store);
    } catch {
      return unavailable(
        'O armazenamento local está indisponível ou excede os limites de leitura. Não foi possível analisar os erros; os registros foram preservados.',
      );
    }
    const sources = catalog.exams.map((exam) => readNotebookSources(exam, raws, exam));
    const historical: NotebookIdentity[] = [];
    const historicalWarnings: NotebookWarning[] = [];
    const historicalIdentities = new Map<string, NotebookIdentity>();
    for (const [key, raw] of raws) {
      const identity = raw === null ? null : parseNotebookKey(key);
      if (
        identity &&
        !catalog.exams.some(
          (exam) => exam.id === identity.id && exam.revision === identity.revision,
        )
      )
        historicalIdentities.set(JSON.stringify([identity.id, identity.revision]), identity);
    }
    for (const identity of historicalIdentities.values()) {
      const source = readNotebookSources(identity, raws);
      historicalWarnings.push(...source.warnings);
      if (source.detailed.length || source.summaries.length)
        historical.push({ id: identity.id, revision: identity.revision });
    }
    historical.sort((a, b) => lexical(a.id, b.id) || a.revision - b.revision);
    const candidates = sources.filter((source) => source.detailed.length);
    const results: ReturnType<typeof aggregateNotebookExam>[] = new Array(candidates.length);
    let cursor = 0;
    async function worker() {
      while (cursor < candidates.length) {
        assertActive(signal);
        const index = cursor++,
          source = candidates[index]!;
        const identity = JSON.stringify([source.identity.id, source.identity.revision]);
        try {
          if (!loaded.has(identity)) loaded.set(identity, loader(source.identity.id, signal));
          const exam = await loaded.get(identity)!;
          assertActive(signal);
          if (exam.id !== source.identity.id || exam.revision !== source.identity.revision)
            throw new Error('Conteúdo de outra revision.');
          results[index] = aggregateNotebookExam(exam, source);
        } catch (error) {
          assertActive(signal);
          results[index] = {
            items: [],
            attemptCount: 0,
            warnings: [
              ...source.warnings,
              {
                ...source.identity,
                kind: 'load',
                message:
                  'O conteúdo da revision atual não pôde ser carregado. Não foi possível analisar estas tentativas; os registros foram preservados.',
              },
            ],
          };
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, worker));
    assertActive(signal);
    try {
      if (!sameNotebookRaws(raws, captureNotebookRaws(catalog, store))) {
        if (read === 0) continue;
        return unavailable(
          'Os registros mudaram novamente durante a leitura. A análise está indisponível/desatualizada. Atualize para tentar novamente.',
        );
      }
    } catch {
      return unavailable(
        'O armazenamento ficou indisponível durante a leitura. Não foi possível concluir a análise; os registros foram preservados.',
      );
    }
    const warnings = [...historicalWarnings, ...results.flatMap((result) => result.warnings)];
    for (const source of sources.filter((source) => !source.detailed.length)) {
      warnings.push(...source.warnings);
      if (source.summaries.length)
        warnings.push({
          ...source.identity,
          kind: 'partial',
          message:
            'Há somente resumos desta prova, sem respostas detalhadas para identificar erros por questão. A cobertura é parcial.',
        });
    }
    return {
      items: results.flatMap((result) => result.items).sort(compareNotebookItems),
      warnings,
      historical,
      attemptCount: results.reduce((count, result) => count + result.attemptCount, 0),
      hasHistory:
        sources.some((source) => source.hasHistory) ||
        historical.length > 0 ||
        historicalWarnings.length > 0,
      coverage: warnings.length || historical.length ? 'partial' : 'complete',
      error: null,
    };
  }
  return unavailable('A análise está indisponível.');
}
