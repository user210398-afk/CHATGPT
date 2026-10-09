import { z } from 'zod';
import type { Catalog } from '../../schema/catalog';
import {
  legacyAttemptSchema,
  normalizeLegacyAttempt,
  type Attempt,
  type Result,
} from './exam-state';
import {
  readableCurrentEnvelopeSchema,
  previousEnvelopeSchema,
  historyEnvelopeSchema,
  historyV2EnvelopeSchema,
  historyEntrySchema,
  readableHistoryEntrySchema,
  HISTORY_LIMIT,
  includeCurrent,
  summary,
  storageKey,
  historyStorageKey,
  type HistoryEntry,
  type StorageAdapter,
} from './persistence';

export type CatalogExam = Catalog['exams'][number];
export type ExamProgressStatus = 'not-started' | 'in-progress' | 'completed';
export type ExamProgressSummary = {
  status: ExamProgressStatus;
  answeredCount: number;
  questionCount: number;
  progressPercentage: number;
  attemptCount: number;
  lastResultPercentage: number | null;
  lastResultAt: string | null;
  bestResultPercentage: number | null;
  lastActivityAt: string | null;
};
// Reuse envelope contracts, but salvage individual history entries without rewriting storage.
const legacyReaderSchema = previousEnvelopeSchema.extend({ history: z.unknown() });
const historyReaderSchema = z.union([
  historyEnvelopeSchema.extend({ history: z.array(z.unknown()).max(HISTORY_LIMIT) }),
  historyV2EnvelopeSchema.extend({ history: z.array(z.unknown()).max(HISTORY_LIMIT) }),
]);
// V2 keeps its existing salvage behavior; v3 must require an explicit mode per entry.
export function isCatalogResultConsistent(exam: CatalogExam, result: Result): boolean {
  return (
    result.objectiveTotal === exam.objectiveCount &&
    result.essayTotal === exam.essayCount &&
    result.correct + result.incorrect === result.objectiveAnswered &&
    result.objectiveAnswered + result.unanswered === result.objectiveTotal &&
    result.essayAnswered <= result.essayTotal &&
    result.percentage ===
      (result.objectiveTotal === 0
        ? null
        : Math.round((result.correct / result.objectiveTotal) * 100))
  );
}
function matchingAttempt(exam: CatalogExam, attempt: Attempt): boolean {
  return (
    attempt.examId === exam.id &&
    attempt.examRevision === exam.revision &&
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
    (!attempt.completedAt || Date.parse(attempt.completedAt) >= Date.parse(attempt.startedAt)) &&
    (!attempt.result || isCatalogResultConsistent(exam, attempt.result))
  );
}
export function readExamProgress(
  exam: CatalogExam,
  storage: () => Pick<StorageAdapter, 'getItem'> = () => window.localStorage,
): {
  progress: ExamProgressSummary;
  unavailable: boolean;
  includesStudy: boolean;
  includesExam: boolean;
} {
  let current: Attempt | null = null;
  let history: HistoryEntry[] = [];
  let legacyHistory: unknown = [];
  let unavailable = false;
  try {
    const raw = storage().getItem(storageKey(exam));
    if (raw) {
      const value: unknown = JSON.parse(raw);
      const v2 = readableCurrentEnvelopeSchema.safeParse(value);
      const v1 = legacyReaderSchema.safeParse(value);
      const candidate = v2.success
        ? v2.data.current
        : v1.success
          ? normalizeLegacyAttempt(v1.data.current)
          : null;
      if (candidate && matchingAttempt(exam, candidate)) current = candidate;
      if (v1.success) legacyHistory = v1.data.history;
    }
  } catch (error) {
    // Invalid JSON is not a blocked storage; either case is read-only.
    unavailable = !(error instanceof SyntaxError);
  }
  if (Array.isArray(legacyHistory)) {
    for (const entry of legacyHistory.slice(0, HISTORY_LIMIT)) {
      const parsed = legacyAttemptSchema.transform(normalizeLegacyAttempt).safeParse(entry);
      if (parsed.success && parsed.data.completedAt && matchingAttempt(exam, parsed.data))
        history.push(summary(parsed.data));
    }
  }
  try {
    const raw = storage().getItem(historyStorageKey(exam));
    const parsed = raw ? historyReaderSchema.safeParse(JSON.parse(raw)) : null;
    if (parsed?.success) {
      for (const entry of parsed.data.history) {
        const item =
          parsed.data.storageVersion === 3
            ? historyEntrySchema.safeParse(entry)
            : readableHistoryEntrySchema.safeParse(entry);
        if (
          item.success &&
          Date.parse(item.data.completedAt) >= Date.parse(item.data.startedAt) &&
          isCatalogResultConsistent(exam, item.data.result)
        )
          history.push(item.data);
      }
    }
  } catch (error) {
    unavailable ||= !(error instanceof SyntaxError);
  }
  // Prefer the separate v2 history over a stale legacy entry with the same ID.
  history = [...new Map(history.map((entry) => [entry.id, entry])).values()].sort(
    (a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt),
  );
  if (current) history = includeCurrent(current, history);
  history = history
    .slice(0, HISTORY_LIMIT)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  const scored = history.filter((entry) => entry.result.percentage !== null);
  const answered = current
    ? Object.values(current.answers).filter((answer) => answer.trim()).length
    : 0;
  const count = Math.max(0, Math.min(answered, exam.questionCount));
  const activity =
    [current?.completedAt ?? current?.startedAt, history[0]?.completedAt]
      .filter((date): date is string => Boolean(date))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  return {
    unavailable,
    includesStudy: current?.mode === 'study' || history.some((entry) => entry.mode === 'study'),
    includesExam: current?.mode === 'exam' || history.some((entry) => entry.mode === 'exam'),
    progress: {
      status: current ? (current.completedAt ? 'completed' : 'in-progress') : 'not-started',
      answeredCount: count,
      questionCount: exam.questionCount,
      progressPercentage:
        exam.questionCount > 0 ? Math.round((count / exam.questionCount) * 100) : 0,
      attemptCount: history.length,
      lastResultPercentage: scored[0]?.result.percentage ?? null,
      lastResultAt: scored[0]?.completedAt ?? null,
      bestResultPercentage: scored.length
        ? Math.max(...scored.map((entry) => entry.result.percentage!))
        : null,
      lastActivityAt: activity,
    },
  };
}
