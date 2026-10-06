import { storageFixtureJson } from './legacy-fixtures';
import { describe, expect, it } from 'vitest';
import {
  advancedStatistics,
  aggregateGlobalMetrics,
  aggregateSubjectGroups,
  aggregateSubjects,
  recentActivity,
  type DashboardItem,
} from '../src/engine/dashboard-metrics';
import { readExamProgress } from '../src/engine/catalog-progress';
import { historyStorageKey, storageKey, summary } from '../src/engine/persistence';
import { createAttempt, transition } from '../src/engine/exam-state';
import { catalogExam, completedAttempt, testCatalog } from './catalog-fixtures';
import { poc } from './fixtures';
function items(): DashboardItem[] {
  return testCatalog.exams.map((exam) => ({ exam, progress: readExamProgress(exam).progress }));
}
const date = (day: number) => `2026-10-0${day}T12:00:00.000Z`;
describe('métricas globais e tempo de resultados', () => {
  it('catálogo vazio e todas não iniciadas têm notas ausentes', () => {
    expect(aggregateGlobalMetrics([])).toMatchObject({
      available: 0,
      best: null,
      last: null,
      attempts: 0,
    });
    expect(aggregateGlobalMetrics(items())).toEqual({
      available: 3,
      completed: 0,
      inProgress: 0,
      notStarted: 3,
      attempts: 0,
      best: null,
      last: null,
      lastResultAt: null,
      lastActivityAt: null,
    });
  });
  it('mix de status, soma de tentativas e máximo real incluindo 0%', () => {
    const source = items();
    Object.assign(source[0]!.progress, {
      status: 'completed',
      attemptCount: 4,
      bestResultPercentage: 90,
    });
    Object.assign(source[1]!.progress, {
      status: 'in-progress',
      attemptCount: 2,
      bestResultPercentage: 0,
    });
    expect(aggregateGlobalMetrics(source)).toMatchObject({
      completed: 1,
      inProgress: 1,
      notStarted: 1,
      attempts: 6,
      best: 90,
    });
  });
  it('último resultado usa conclusão objetiva e não atividade aberta mais recente', () => {
    const source = items();
    Object.assign(source[0]!.progress, {
      lastResultPercentage: 80,
      lastResultAt: date(2),
      lastActivityAt: date(5),
    });
    Object.assign(source[1]!.progress, {
      lastResultPercentage: 0,
      lastResultAt: date(3),
      lastActivityAt: date(3),
    });
    Object.assign(source[2]!.progress, {
      lastResultPercentage: null,
      lastResultAt: null,
      lastActivityAt: date(4),
    });
    expect(aggregateGlobalMetrics(source)).toMatchObject({
      last: 0,
      lastResultAt: date(3),
      lastActivityAt: date(5),
    });
  });
  it('empates de resultados preservam explicitamente ordem do catálogo', () => {
    const source = items();
    source.forEach(({ progress }, i) =>
      Object.assign(progress, { lastResultAt: date(3), lastResultPercentage: i * 10 }),
    );
    expect(aggregateGlobalMetrics(source).last).toBe(0);
  });
  it('history fora de ordem deriva lastResultAt read-only, mesmo após reabrir prova', () => {
    localStorage.setItem(
      storageKey(poc),
      storageFixtureJson({ storageVersion: 2, current: createAttempt(poc, date(5)) }),
    );
    localStorage.setItem(
      historyStorageKey(poc),
      storageFixtureJson({
        storageVersion: 2,
        history: [
          summary(completedAttempt('old', 10)),
          summary(completedAttempt('new', 2, date(4))),
        ],
      }),
    );
    const before = localStorage.getItem(historyStorageKey(poc));
    expect(readExamProgress(catalogExam).progress).toMatchObject({
      lastResultPercentage: 10,
      lastResultAt: date(4),
      lastActivityAt: date(5),
    });
    expect(localStorage.getItem(historyStorageKey(poc))).toBe(before);
  });
  it('somente dissertativa concluída mantém lastResultAt e nota null', () => {
    const essay = { ...poc, questions: poc.questions.filter((q) => q.type === 'essay') };
    const current = transition(essay, createAttempt(essay, date(1)), {
      type: 'finish',
      now: date(4),
    });
    localStorage.setItem(storageKey(essay), storageFixtureJson({ storageVersion: 2, current }));
    expect(
      readExamProgress({ ...catalogExam, questionCount: 10, objectiveCount: 0, essayCount: 10 })
        .progress,
    ).toMatchObject({ lastResultAt: null, lastResultPercentage: null, lastActivityAt: date(4) });
  });
});
describe('agregação exata por disciplina', () => {
  it('agrupa, soma, calcula melhor/último e média arredondada dos melhores válidos', () => {
    const source = items();
    source.forEach((item, i) => {
      item.exam = { ...item.exam, subject: 'Disciplina' };
      Object.assign(item.progress, {
        status: i === 0 ? 'completed' : i === 1 ? 'in-progress' : 'not-started',
        attemptCount: i + 1,
        bestResultPercentage: [87, 76, null][i],
        lastResultPercentage: [80, 40, null][i],
        lastResultAt: i < 2 ? date(i + 2) : null,
      });
    });
    expect(aggregateSubjects(source)).toMatchObject([
      {
        subject: 'Disciplina',
        available: 3,
        completed: 1,
        inProgress: 1,
        notStarted: 1,
        attempts: 6,
        best: 87,
        last: 40,
        meanOfBests: 82,
      },
    ]);
  });
  it('0% entra na média; provas sem nota e disciplina dissertativa não inventam média', () => {
    const source = items();
    source[0]!.progress.bestResultPercentage = 0;
    expect(
      aggregateSubjects(source).find((s) => s.subject === catalogExam.subject)?.meanOfBests,
    ).toBe(0);
    expect(aggregateSubjects(items()).every((s) => s.meanOfBests === null)).toBe(true);
  });
  it('strings semelhantes permanecem distintas e ordem é locale-aware pt-BR', () => {
    const source = items();
    ['Farmacologia Básica', 'Farmacologia', 'Álgebra'].forEach(
      (subject, i) => (source[i]!.exam = { ...source[i]!.exam, subject }),
    );
    expect(aggregateSubjects(source).map((s) => s.subject)).toEqual([
      'Álgebra',
      'Farmacologia',
      'Farmacologia Básica',
    ]);
  });
  it('empate na ordenação locale tem desempate explícito pela inserção', () => {
    const source = items().slice(0, 2);
    source[0]!.exam = { ...source[0]!.exam, subject: 'Á' };
    source[1]!.exam = { ...source[1]!.exam, subject: 'A\u0301' };
    expect(aggregateSubjects(source).map((s) => s.subject)).toEqual(['Á', 'A\u0301']);
  });
});

describe('estatísticas avançadas e grupos do Hub', () => {
  it('consolida aliases acadêmicos no mesmo grupo sem alterar Exam.subject', () => {
    const source = items();
    source[0]!.exam = { ...source[0]!.exam, subject: 'Farmacologia' };
    source[1]!.exam = { ...source[1]!.exam, subject: 'Farmacologia Básica' };
    source[2]!.exam = { ...source[2]!.exam, subject: 'Fisiologia' };
    source[0]!.progress.bestResultPercentage = 80;
    source[1]!.progress.bestResultPercentage = 60;
    const before = source.map(({ exam }) => exam.subject);
    const groups = aggregateSubjectGroups(source);
    expect(groups.map((group) => group.subject)).toEqual(['Farmacologia', 'Fisiologia']);
    expect(groups[0]).toMatchObject({ available: 2, meanOfBests: 70 });
    expect(source.map(({ exam }) => exam.subject)).toEqual(before);
  });
  it('calcula cobertura, média global e extremos somente com melhores notas válidas', () => {
    const source = items();
    ['Farmacologia', 'Fisiologia', 'Imunologia'].forEach(
      (subject, index) => (source[index]!.exam = { ...source[index]!.exam, subject }),
    );
    Object.assign(source[0]!.progress, {
      status: 'completed',
      attemptCount: 2,
      bestResultPercentage: 80,
    });
    Object.assign(source[1]!.progress, {
      status: 'in-progress',
      attemptCount: 0,
      bestResultPercentage: null,
    });
    Object.assign(source[2]!.progress, {
      status: 'not-started',
      attemptCount: 1,
      bestResultPercentage: 40,
    });
    expect(advancedStatistics(source)).toEqual({
      available: 3,
      practiced: 3,
      practiceCoverage: 100,
      scoredExamCount: 2,
      meanOfBests: 60,
      strongestSubject: { id: 'farmacologia', subject: 'Farmacologia', meanOfBests: 80 },
      lowestSubject: { id: 'imunologia', subject: 'Imunologia', meanOfBests: 40 },
    });
  });
  it('catálogo vazio e ausência de notas não inventam percentuais nem rankings', () => {
    expect(advancedStatistics([])).toEqual({
      available: 0,
      practiced: 0,
      practiceCoverage: null,
      scoredExamCount: 0,
      meanOfBests: null,
      strongestSubject: null,
      lowestSubject: null,
    });
    expect(advancedStatistics(items())).toMatchObject({
      practiceCoverage: 0,
      scoredExamCount: 0,
      meanOfBests: null,
      strongestSubject: null,
      lowestSubject: null,
    });
  });
});

describe('atividade recente', () => {
  it('omite ausência, limita a 6, ordena e mantém empate por índice original', () => {
    const source = Array.from({ length: 8 }, (_, i) => ({
      exam: { ...catalogExam, id: `exam-${i}` },
      progress: {
        ...readExamProgress(catalogExam).progress,
        lastActivityAt: i === 7 ? null : date((i % 3) + 1),
      },
    }));
    expect(recentActivity(source).map((item) => item.exam.id)).toEqual([
      'exam-2',
      'exam-5',
      'exam-1',
      'exam-4',
      'exam-0',
      'exam-3',
    ]);
    expect(recentActivity(items())).toEqual([]);
    expect(recentActivity(source, 2)).toHaveLength(2);
  });
  it('todas as funções preservam os arrays e objetos de entrada', () => {
    const source = items(),
      before = structuredClone(source);
    aggregateGlobalMetrics(source);
    aggregateSubjects(source);
    aggregateSubjectGroups(source);
    advancedStatistics(source);
    recentActivity(source);
    expect(source).toEqual(before);
  });
});
