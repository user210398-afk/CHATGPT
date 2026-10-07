import { z } from 'zod';
import type { Catalog } from '../../schema/catalog';
import { isCatalogResultConsistent, type CatalogExam } from './catalog-progress';
import { sameContent } from './content-equality';
import { legacyAttemptSchema, normalizeLegacyAttempt, type Attempt } from './exam-state';
import {
  HISTORY_LIMIT,
  historyEnvelopeSchema,
  historyV2EnvelopeSchema,
  historyEntrySchema,
  historyEntryV2Schema,
  previousEnvelopeSchema,
  readableCurrentEnvelopeSchema,
  storageKey,
  historyStorageKey,
  summary,
  type HistoryEntry,
  type StorageAdapter,
} from './persistence';

export type AnalyticsAttempt = {
  attemptId: string;
  examId: string;
  examRevision: number;
  examTitle: string;
  subject: string;
  mode: 'exam' | 'study';
  completedAt: string;
  percentage: number | null;
  correct: number;
  incorrect: number;
  unanswered: number;
  objectiveTotal: number;
};
export type AnalyticsSnapshot = {
  attempts: AnalyticsAttempt[];
  coverage: 'complete' | 'partial' | 'unavailable';
  warnings: string[];
};
// Validate the envelope independently of each entry, preserving valid siblings.
const legacyEnvelope = previousEnvelopeSchema.extend({
  current: z.unknown(),
  history: z.unknown(),
});
const historyEntries = z.array(z.unknown()).max(HISTORY_LIMIT);
const historyV3 = historyEnvelopeSchema.extend({ history: historyEntries });
const historyV2 = historyV2EnvelopeSchema.extend({ history: historyEntries });

function compatibleMetadata(exam: CatalogExam, attempt: Attempt): boolean {
  return (
    attempt.currentIndex < exam.questionCount &&
    (attempt.mode !== 'exam' || attempt.confirmedQuestionIds.length === 0) &&
    attempt.confirmedQuestionIds.every((id) => Boolean(attempt.answers[id]?.trim())) &&
    (!attempt.completedAt ||
      attempt.mode !== 'study' ||
      Object.entries(attempt.answers).every(
        ([id, answer]) => !answer.trim() || attempt.confirmedQuestionIds.includes(id),
      )) &&
    new Set(attempt.flagged).size === attempt.flagged.length &&
    Boolean(attempt.completedAt) === Boolean(attempt.result) &&
    (!attempt.completedAt || Date.parse(attempt.completedAt) >= Date.parse(attempt.startedAt))
  );
}
export const analyticsIdentity = (attempt: AnalyticsAttempt) =>
  JSON.stringify([attempt.examId, attempt.examRevision, attempt.attemptId]);
export const compareCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const compareAnalyticsAttempts = (a: AnalyticsAttempt, b: AnalyticsAttempt) =>
  Date.parse(a.completedAt) - Date.parse(b.completedAt) ||
  compareCodeUnits(a.examId, b.examId) ||
  compareCodeUnits(a.attemptId, b.attemptId);

export function readAnalytics(
  catalog: Catalog,
  storage: () => Pick<StorageAdapter, 'getItem'> = () => window.localStorage,
): AnalyticsSnapshot {
  const warnings = new Set<string>();
  const candidates = new Map<
    string,
    {
      attempt: AnalyticsAttempt;
      entry: HistoryEntry;
      detailed?: Pick<Attempt, 'answers'>;
      valid: boolean;
      conflict: boolean;
    }
  >();
  const warn = () =>
    warnings.add('Uma fonte oficial está inválida ou incompatível; o registro foi preservado.');
  function add(
    exam: CatalogExam,
    entry: HistoryEntry,
    detailed?: Attempt,
    representationCompatible = true,
  ) {
    const attempt: AnalyticsAttempt = {
      attemptId: entry.id,
      examId: exam.id,
      examRevision: exam.revision,
      examTitle: exam.title,
      subject: exam.subject,
      mode: entry.mode,
      completedAt: entry.completedAt,
      percentage: entry.result.percentage,
      correct: entry.result.correct,
      incorrect: entry.result.incorrect,
      unanswered: entry.result.unanswered,
      objectiveTotal: entry.result.objectiveTotal,
    };
    const valid =
      representationCompatible &&
      Date.parse(entry.completedAt) >= Date.parse(entry.startedAt) &&
      isCatalogResultConsistent(exam, entry.result);
    if (!valid) warn();
    const key = analyticsIdentity(attempt),
      previous = candidates.get(key);
    const academic = detailed ? { answers: detailed.answers } : undefined;
    if (previous) {
      // All schema-readable copies of this identity are academic conflict evidence,
      // including incompatible metadata and structurally inconsistent Results.
      previous.conflict ||=
        !sameContent(previous.entry, entry) ||
        Boolean(previous.detailed && academic && !sameContent(previous.detailed, academic));
      // Equivalent incompatible copies cannot invalidate a compatible representation.
      // Keep conflict evidence separately from the representation selected for output.
      if (!previous.valid && valid) previous.attempt = attempt;
      previous.valid ||= valid;
      previous.detailed ??= academic;
      if (previous.conflict)
        warnings.add('Tentativas com a mesma identidade e conteúdo conflitante foram excluídas.');
    } else candidates.set(key, { attempt, entry, detailed: academic, valid, conflict: false });
  }
  function detailed(exam: CatalogExam, attempt: Attempt) {
    // A mismatched exam/revision is a different identity, never evidence against
    // an Attempt in this published catalog key.
    if (attempt.examId !== exam.id || attempt.examRevision !== exam.revision) {
      warn();
      return;
    }
    const compatible = compatibleMetadata(exam, attempt);
    if (!compatible) warn();
    if (attempt.completedAt && attempt.result) add(exam, summary(attempt), attempt, compatible);
  }
  function current(exam: CatalogExam, raw: string) {
    try {
      const value: unknown = JSON.parse(raw);
      const modern = readableCurrentEnvelopeSchema.safeParse(value);
      if (modern.success) {
        detailed(exam, modern.data.current);
        return;
      }
      const legacy = legacyEnvelope.safeParse(value);
      if (!legacy.success) {
        warn();
        return;
      }
      const item = legacyAttemptSchema.safeParse(legacy.data.current);
      if (item.success) detailed(exam, normalizeLegacyAttempt(item.data));
      else warn();
      const embedded = historyEntries.safeParse(legacy.data.history);
      if (!embedded.success) {
        warn();
        return;
      }
      for (const entry of embedded.data) {
        const parsed = legacyAttemptSchema.safeParse(entry);
        if (parsed.success && parsed.data.completedAt)
          detailed(exam, normalizeLegacyAttempt(parsed.data));
        else warn();
      }
    } catch {
      warn();
    }
  }
  function history(exam: CatalogExam, raw: string) {
    try {
      const value: unknown = JSON.parse(raw);
      const v3 = historyV3.safeParse(value),
        v2 = historyV2.safeParse(value);
      const entries = v3.success ? v3.data.history : v2.success ? v2.data.history : null;
      if (!entries) {
        warn();
        return;
      }
      for (const entry of entries) {
        // Respect the version-specific contract: missing v3 mode is invalid.
        if (v3.success) {
          const parsed = historyEntrySchema.safeParse(entry);
          if (parsed.success) add(exam, parsed.data);
          else warn();
        } else {
          const parsed = historyEntryV2Schema.safeParse(entry);
          if (parsed.success) add(exam, { ...parsed.data, mode: 'exam' });
          else warn();
        }
      }
    } catch {
      warn();
    }
  }
  try {
    const store = storage();
    for (const exam of catalog.exams) {
      // Only published current-revision keys; never enumerate personal domains.
      const currentRaw = store.getItem(storageKey(exam));
      const historyRaw = store.getItem(historyStorageKey(exam));
      if (currentRaw !== null) current(exam, currentRaw);
      if (historyRaw !== null) history(exam, historyRaw);
    }
  } catch {
    return {
      attempts: [],
      coverage: 'unavailable',
      warnings: ['Analytics indisponível: não foi possível acessar o progresso local.'],
    };
  }
  return {
    attempts: [...candidates.values()]
      .filter((item) => item.valid && !item.conflict)
      .map((item) => item.attempt)
      .sort(compareAnalyticsAttempts),
    coverage: warnings.size ? 'partial' : 'complete',
    warnings: [...warnings],
  };
}
