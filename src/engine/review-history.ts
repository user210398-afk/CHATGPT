import { z } from 'zod';
import type { Exam } from '../types/exam';
import {
  attemptSchema,
  normalizeLegacyAttempt,
  isCompatibleAttempt,
  transition,
  type Attempt,
} from './exam-state';
import {
  readableCurrentEnvelopeSchema,
  previousEnvelopeSchema,
  storageKey,
  historyStorageKey,
  type StorageAdapter,
} from './persistence';
import { isCatalogResultConsistent, type CatalogExam } from './catalog-progress';
import { sameContent } from './content-equality';
import { writeTransaction } from './storage-transaction';
export const REVIEW_LIMIT = 20;
export const completedReviewAttemptSchema = attemptSchema.refine(
  (attempt) =>
    attempt.completedAt !== null &&
    attempt.result !== null &&
    Date.parse(attempt.completedAt) >= Date.parse(attempt.startedAt) &&
    (attempt.mode !== 'exam' || attempt.confirmedQuestionIds.length === 0) &&
    attempt.confirmedQuestionIds.every((id) => Boolean(attempt.answers[id]?.trim())) &&
    (attempt.mode !== 'study' ||
      Object.entries(attempt.answers).every(
        ([id, answer]) => !answer.trim() || attempt.confirmedQuestionIds.includes(id),
      )),
  'Snapshot concluído incompatível',
);
export const reviewEnvelopeSchema = z.strictObject({
  storageVersion: z.literal(1),
  attempts: z
    .array(completedReviewAttemptSchema)
    .max(REVIEW_LIMIT)
    .refine((attempts) => new Set(attempts.map((attempt) => attempt.id)).size === attempts.length),
});
export function reviewStorageKey(exam: Pick<Exam, 'id' | 'revision'>): string {
  return `${storageKey(exam)}:review`;
}
export function sameAttemptAcademic(a: Attempt, b: Attempt): boolean {
  // Navigation is UI state. Flags are the only mutable study metadata.
  const academic = ({ flagged: _flags, currentIndex: _index, ...rest }: Attempt) => rest;
  return sameContent(academic(a), academic(b));
}
export function retainReviews(attempts: Attempt[], limit = REVIEW_LIMIT): Attempt[] {
  return attempts
    .map((attempt, index) => ({ attempt, index }))
    .sort(
      (a, b) =>
        Date.parse(b.attempt.completedAt!) - Date.parse(a.attempt.completedAt!) ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map(({ attempt }) => attempt);
}
export function validateReviewArchive(exam: Exam, attempts: Attempt[]) {
  if (
    !reviewEnvelopeSchema.safeParse({ storageVersion: 1, attempts }).success ||
    attempts.some((attempt) => !isCompatibleAttempt(exam, attempt))
  )
    throw new Error('Histórico detalhado incompatível.');
}
function readArchive(
  storage: Pick<StorageAdapter, 'getItem'>,
  exam: Pick<Exam, 'id' | 'revision'>,
) {
  const raw = storage.getItem(reviewStorageKey(exam));
  return {
    raw,
    attempts: raw === null ? [] : reviewEnvelopeSchema.parse(JSON.parse(raw)).attempts,
  };
}
export function readStoredCurrent(raw: string | null): Attempt | null {
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw),
    parsed = readableCurrentEnvelopeSchema.safeParse(value);
  return parsed.success
    ? parsed.data.current
    : normalizeLegacyAttempt(previousEnvelopeSchema.parse(value).current);
}
export function combineDetailedAttempts(current: Attempt | null, archive: Attempt[]): Attempt[] {
  const attempts = new Map(archive.map((attempt) => [attempt.id, attempt]));
  if (current?.completedAt && current.result) {
    const existing = attempts.get(current.id);
    if (existing && !sameAttemptAcademic(existing, current))
      throw new Error('Conflito entre tentativa atual e revisão.');
    attempts.set(current.id, current); // current flags are authoritative when listing.
  }
  // The completed current remains available even when 20 newer imported snapshots exist.
  // Only the persisted archive, and the backup archive field, have the 20-entry limit.
  return retainReviews([...attempts.values()], REVIEW_LIMIT + 1);
}
export function readReviewSummary(
  exam: CatalogExam,
  storage: () => Pick<StorageAdapter, 'getItem'> = () => window.localStorage,
) {
  try {
    const store = storage(),
      archive = readArchive(store, exam);
    const current = readStoredCurrent(store.getItem(storageKey(exam)));
    const candidates = combineDetailedAttempts(current, archive.attempts);
    const attempts = candidates.filter(
      (attempt) =>
        completedReviewAttemptSchema.safeParse(attempt).success &&
        attempt.examId === exam.id &&
        attempt.examRevision === exam.revision &&
        attempt.currentIndex < exam.questionCount &&
        new Set(attempt.flagged).size === attempt.flagged.length &&
        isCatalogResultConsistent(exam, attempt.result!),
    );
    return {
      attempts,
      warning:
        attempts.length !== candidates.length
          ? 'Há registros de revisão incompatíveis preservados neste navegador.'
          : null,
    };
  } catch {
    return {
      attempts: [],
      warning:
        'O histórico detalhado desta prova está indisponível ou incompatível. O registro foi preservado.',
    };
  }
}
export class ReviewRepository {
  constructor(private readonly storage: () => StorageAdapter) {}
  load(exam: Exam, id: string): Attempt {
    const store = this.storage(),
      archive = readArchive(store, exam);
    validateReviewArchive(exam, archive.attempts);
    const current = readStoredCurrent(store.getItem(storageKey(exam)));
    const selected = combineDetailedAttempts(current, archive.attempts).find(
      (attempt) => attempt.id === id,
    );
    if (
      !selected ||
      !completedReviewAttemptSchema.safeParse(selected).success ||
      !isCompatibleAttempt(exam, selected)
    )
      throw new Error(
        'Esta tentativa não está disponível para revisão ou é incompatível com a prova.',
      );
    return selected;
  }
  capture(exam: Exam, attempt: Attempt, requireCurrent = false): Map<string, string | null> {
    validateReviewArchive(exam, [attempt]);
    const store = this.storage(),
      { raw, attempts } = readArchive(store, exam);
    validateReviewArchive(exam, attempts);
    const existing = attempts.find((item) => item.id === attempt.id);
    if (existing && !sameAttemptAcademic(existing, attempt))
      throw new Error('Conflito real no histórico detalhado.');
    const next = retainReviews([attempt, ...attempts.filter((item) => item.id !== attempt.id)]);
    const currentRaw = store.getItem(storageKey(exam)),
      current = readStoredCurrent(currentRaw);
    if (requireCurrent && current?.id !== attempt.id)
      throw new Error('Tentativa atual mudou antes da captura.');
    if (
      current?.id === attempt.id &&
      (!isCompatibleAttempt(exam, current) ||
        !sameAttemptAcademic(current, attempt) ||
        !sameContent(current.flagged, attempt.flagged))
    )
      throw new Error('Tentativa atual mudou antes da captura.');
    if (requireCurrent && !next.some((item) => item.id === attempt.id))
      throw new Error('O limite de revisão não permite preservar esta tentativa atual.');
    const expected = new Map([
      [reviewStorageKey(exam), raw],
      [storageKey(exam), currentRaw],
    ]);
    if (requireCurrent)
      expected.set(historyStorageKey(exam), store.getItem(historyStorageKey(exam)));
    const changes = sameContent(next, attempts)
      ? []
      : [
          {
            key: reviewStorageKey(exam),
            before: raw,
            after: JSON.stringify({ storageVersion: 1, attempts: next }),
          },
        ];
    writeTransaction(store, expected, changes);
    for (const change of changes) expected.set(change.key, change.after);
    return expected;
  }
  toggleFlag(exam: Exam, expectedAttempt: Attempt, questionId: string): Attempt {
    validateReviewArchive(exam, [expectedAttempt]);
    if (!exam.questions.some((q) => q.id === questionId)) throw new Error('Questão inexistente.');
    const store = this.storage(),
      currentRaw = store.getItem(storageKey(exam));
    const current = readStoredCurrent(currentRaw),
      archive = readArchive(store, exam);
    validateReviewArchive(exam, archive.attempts);
    const archived = archive.attempts.find((item) => item.id === expectedAttempt.id);
    const isCurrent = current?.id === expectedAttempt.id;
    const source = isCurrent ? current! : archived;
    if (
      !source ||
      !sameAttemptAcademic(source, expectedAttempt) ||
      !sameContent(source.flagged, expectedAttempt.flagged)
    )
      throw new Error('A tentativa mudou por concorrência. Reabra a revisão.');
    validateReviewArchive(exam, [source]);
    if (archived && !sameAttemptAcademic(source, archived))
      throw new Error('Conflito real entre current e archive.');
    const next = transition(exam, source, { type: 'flag', questionId });
    const attempts = retainReviews([
      next,
      ...archive.attempts.filter((item) => item.id !== next.id),
    ]);
    if (!attempts.some((item) => item.id === next.id))
      throw new Error('O limite de revisão não permite preservar esta marcação.');
    const embedded = isCurrent ? previousEnvelopeSchema.safeParse(JSON.parse(currentRaw!)) : null;
    const changes = isCurrent
      ? [
          {
            key: storageKey(exam),
            before: currentRaw,
            // Never erase embedded v1 history while flagging. When none exists,
            // retain 7B.1's explicit-action migration to the current v3 contract.
            after: JSON.stringify(
              embedded?.success && embedded.data.history.length
                ? { ...embedded.data, current: { ...embedded.data.current, flagged: next.flagged } }
                : { storageVersion: 3, current: next },
            ),
          },
        ]
      : [];
    changes.push({
      key: reviewStorageKey(exam),
      before: archive.raw,
      after: JSON.stringify({ storageVersion: 1, attempts }),
    });
    writeTransaction(
      store,
      new Map([
        [storageKey(exam), currentRaw],
        [reviewStorageKey(exam), archive.raw],
      ]),
      changes,
    );
    return next;
  }
}
