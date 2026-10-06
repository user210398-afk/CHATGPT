import { z } from 'zod';
import type { Exam } from '../types/exam';
import type { CatalogExam } from './catalog-progress';
import { storageKey, type StorageAdapter } from './persistence';
import { ReviewRepository, reviewStorageKey } from './review-history';
import { sameContent } from './content-equality';
import { writeTransaction } from './storage-transaction';
import {
  createReviewSession,
  isCompatibleReviewSession,
  reviewSessionSchema,
  type ReviewSession,
  type ReviewSelection,
} from './review-session';
import type { Attempt } from './exam-state';
export const reviewSessionEnvelopeSchema = z.strictObject({
  storageVersion: z.literal(1),
  session: reviewSessionSchema,
});
export function reviewSessionStorageKey(exam: Pick<Exam, 'id' | 'revision'>): string {
  return `${storageKey(exam)}:review-session`;
}
export function readReviewSessionSummary(
  exam: CatalogExam,
  storage: () => Pick<StorageAdapter, 'getItem'> = () => window.localStorage,
) {
  try {
    const raw = storage().getItem(reviewSessionStorageKey(exam));
    const session =
      raw === null ? null : reviewSessionEnvelopeSchema.parse(JSON.parse(raw)).session;
    if (
      session &&
      (session.examId !== exam.id ||
        session.examRevision !== exam.revision ||
        session.questionIds.length > exam.questionCount)
    )
      throw new Error('incompatível');
    return { session, warning: null };
  } catch {
    return {
      session: null,
      warning: 'Sessão de revisão incompatível ou indisponível. O registro foi preservado.',
    };
  }
}
export class ReviewSessionRepository {
  constructor(readonly storage: () => StorageAdapter) {}
  read(exam: Exam): { session: ReviewSession | null; raw: string | null } {
    try {
      const raw = this.storage().getItem(reviewSessionStorageKey(exam));
      const session =
        raw === null ? null : reviewSessionEnvelopeSchema.parse(JSON.parse(raw)).session;
      if (session && !isCompatibleReviewSession(exam, session)) throw new Error('incompatível');
      return { session, raw };
    } catch {
      throw new Error('Sessão de revisão incompatível ou indisponível. O registro foi preservado.');
    }
  }
  start(
    exam: Exam,
    source: Attempt,
    selection: ReviewSelection,
    mode: ReviewSession['mode'],
    expectedRaw: string | null,
    replaceActive = false,
  ) {
    const store = this.storage();
    const expected = new Map([
      [reviewSessionStorageKey(exam), expectedRaw],
      [storageKey(exam), store.getItem(storageKey(exam))],
      [reviewStorageKey(exam), store.getItem(reviewStorageKey(exam))],
    ]);
    const previous = this.read(exam);
    if (previous.raw !== expectedRaw)
      throw new Error('A sessão mudou por concorrência. Reabra a revisão.');
    if (previous.session && !previous.session.completedAt && !replaceActive)
      throw new Error('Existe uma sessão em andamento. Continue ou confirme o descarte.');
    const actual = new ReviewRepository(this.storage).load(exam, source.id);
    if (!sameContent(actual, source)) throw new Error('A tentativa fonte mudou. Reabra a revisão.');
    const session = createReviewSession(exam, source, selection, mode);
    const raw = JSON.stringify({ storageVersion: 1, session });
    writeTransaction(store, expected, [
      { key: reviewSessionStorageKey(exam), before: expectedRaw, after: raw },
    ]);
    return { session, raw };
  }
  save(exam: Exam, session: ReviewSession, expectedRaw: string | null): string {
    if (!isCompatibleReviewSession(exam, session))
      throw new Error('Sessão incompatível: não foi salva.');
    if (expectedRaw === null) throw new Error('A sessão foi removida. Não será recriada.');
    const previous = reviewSessionEnvelopeSchema.parse(JSON.parse(expectedRaw)).session;
    if (
      previous.id !== session.id ||
      !sameContent(
        [
          previous.examId,
          previous.examRevision,
          previous.sourceAttemptId,
          previous.sourceCompletedAt,
          previous.selection,
          previous.questionIds,
          previous.mode,
          previous.startedAt,
        ],
        [
          session.examId,
          session.examRevision,
          session.sourceAttemptId,
          session.sourceCompletedAt,
          session.selection,
          session.questionIds,
          session.mode,
          session.startedAt,
        ],
      )
    )
      throw new Error('Origem da sessão é imutável.');
    if (
      previous.completedAt &&
      !sameContent({ ...previous, currentIndex: session.currentIndex }, session)
    )
      throw new Error('Sessão concluída é imutável.');
    if (
      previous.confirmedQuestionIds.some(
        (id) =>
          !session.confirmedQuestionIds.includes(id) ||
          session.answers[id] !== previous.answers[id],
      )
    )
      throw new Error('Resposta confirmada é imutável.');
    const raw = JSON.stringify({ storageVersion: 1, session });
    writeTransaction(this.storage(), new Map([[reviewSessionStorageKey(exam), expectedRaw]]), [
      { key: reviewSessionStorageKey(exam), before: expectedRaw, after: raw },
    ]);
    return raw;
  }
  discard(exam: Exam, expectedRaw: string) {
    writeTransaction(this.storage(), new Map([[reviewSessionStorageKey(exam), expectedRaw]]), [
      { key: reviewSessionStorageKey(exam), before: expectedRaw, after: null },
    ]);
  }
}
