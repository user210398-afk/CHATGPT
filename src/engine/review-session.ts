import { z } from 'zod';
import { identifier } from '../../schema/exam';
import type { Exam } from '../types/exam';
import {
  attemptModeSchema,
  calculateResult,
  resultSchema,
  isCompatibleAttempt,
  type Attempt,
} from './exam-state';
import { questionBehaviors } from './question-behaviors';
import { defaultReviewFilters, reviewQuestionIndices, type ReviewFilters } from './review-filters';
import { sameContent } from './content-equality';
const ids = z
  .array(identifier)
  .max(2000)
  .refine((items) => new Set(items).size === items.length);
export const reviewSelectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('incorrect') }),
  z.strictObject({ kind: z.literal('flagged') }),
  z.strictObject({
    kind: z.literal('filtered'),
    filters: z.strictObject({
      status: z.enum(['all', 'correct', 'incorrect', 'unanswered', 'essay']),
      flaggedOnly: z.boolean(),
      category: z.string().max(2000),
      tag: z.string().max(2000),
    }),
  }),
]);
export const reviewSessionResultSchema = resultSchema
  .extend({ total: z.number().int().positive() })
  .refine(
    (r) =>
      r.total === r.objectiveTotal + r.essayTotal &&
      r.correct + r.incorrect === r.objectiveAnswered &&
      r.objectiveAnswered + r.unanswered === r.objectiveTotal &&
      r.essayAnswered <= r.essayTotal &&
      r.percentage === (r.objectiveTotal ? Math.round((r.correct / r.objectiveTotal) * 100) : null),
  );
export const reviewSessionSchema = z
  .strictObject({
    id: z.string().min(1).max(256),
    examId: identifier,
    examRevision: z.number().int().positive(),
    sourceAttemptId: z.string().min(1).max(256),
    sourceCompletedAt: z.iso.datetime(),
    selection: reviewSelectionSchema,
    questionIds: ids.refine((items) => items.length > 0),
    mode: attemptModeSchema,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    currentIndex: z.number().int().nonnegative(),
    answers: z.record(identifier, z.string().max(200_000)),
    confirmedQuestionIds: ids,
    result: reviewSessionResultSchema.nullable(),
  })
  .superRefine((s, ctx) => {
    const valid = new Set(s.questionIds);
    if (
      s.currentIndex >= s.questionIds.length ||
      Object.keys(s.answers).some((id) => !valid.has(id)) ||
      s.confirmedQuestionIds.some((id) => !valid.has(id) || !s.answers[id]?.trim()) ||
      (s.mode === 'exam' && s.confirmedQuestionIds.length > 0) ||
      Boolean(s.completedAt) !== Boolean(s.result) ||
      Date.parse(s.sourceCompletedAt) > Date.parse(s.startedAt) ||
      (s.completedAt && Date.parse(s.completedAt) < Date.parse(s.startedAt)) ||
      (s.result && s.result.total !== s.questionIds.length) ||
      (s.completedAt &&
        s.mode === 'study' &&
        Object.entries(s.answers).some(
          ([id, answer]) => answer.trim() && !s.confirmedQuestionIds.includes(id),
        ))
    )
      ctx.addIssue({ code: 'custom', message: 'Sessão de revisão inconsistente.' });
  });
export type ReviewSession = z.infer<typeof reviewSessionSchema>;
export type ReviewSelection = z.infer<typeof reviewSelectionSchema>;
export type ReviewSessionResult = z.infer<typeof reviewSessionResultSchema>;
export function selectReviewQuestions(
  exam: Exam,
  source: Attempt,
  selection: ReviewSelection,
): string[] {
  const filters: ReviewFilters =
    selection.kind === 'filtered'
      ? selection.filters
      : {
          ...defaultReviewFilters,
          ...(selection.kind === 'incorrect'
            ? { status: 'incorrect' as const }
            : { flaggedOnly: true }),
        };
  return reviewQuestionIndices(exam, source, filters).map((index) => exam.questions[index]!.id);
}
export function sessionExam(exam: Exam, session: Pick<ReviewSession, 'questionIds'>): Exam {
  return {
    ...exam,
    questions: session.questionIds.map((id) => exam.questions.find((q) => q.id === id)!),
  };
}
export function calculateSessionResult(exam: Exam, session: ReviewSession): ReviewSessionResult {
  return {
    ...calculateResult(sessionExam(exam, session), session),
    total: session.questionIds.length,
  };
}
export function pendingSessionConfirmations(exam: Exam, session: ReviewSession): string[] {
  return session.mode === 'study'
    ? sessionExam(exam, session)
        .questions.filter(
          (q) =>
            questionBehaviors[q.type].isAnswered(session.answers[q.id]) &&
            !session.confirmedQuestionIds.includes(q.id),
        )
        .map((q) => q.id)
    : [];
}
export function isCompatibleReviewSession(exam: Exam, session: ReviewSession): boolean {
  if (
    !reviewSessionSchema.safeParse(session).success ||
    session.examId !== exam.id ||
    session.examRevision !== exam.revision
  )
    return false;
  const order = exam.questions.filter((q) => session.questionIds.includes(q.id)).map((q) => q.id);
  if (!sameContent(order, session.questionIds)) return false;
  for (const [id, answer] of Object.entries(session.answers)) {
    const q = exam.questions.find((q) => q.id === id);
    if (!q || !questionBehaviors[q.type].accepts(q, answer)) return false;
  }
  return !session.result || sameContent(session.result, calculateSessionResult(exam, session));
}
export function createReviewSession(
  exam: Exam,
  source: Attempt,
  selection: ReviewSelection,
  mode: ReviewSession['mode'],
  now = new Date().toISOString(),
  id: string = crypto.randomUUID(),
): ReviewSession {
  if (
    !isCompatibleAttempt(exam, source) ||
    !source.completedAt ||
    !source.result ||
    source.examId !== exam.id ||
    source.examRevision !== exam.revision
  )
    throw new Error('A sessão requer uma tentativa concluída desta prova.');
  const session = reviewSessionSchema.parse({
    id,
    examId: exam.id,
    examRevision: exam.revision,
    sourceAttemptId: source.id,
    sourceCompletedAt: source.completedAt,
    selection,
    questionIds: selectReviewQuestions(exam, source, selection),
    mode,
    startedAt: now,
    completedAt: null,
    currentIndex: 0,
    answers: {},
    confirmedQuestionIds: [],
    result: null,
  });
  if (!isCompatibleReviewSession(exam, session)) throw new Error('Seleção incompatível.');
  return session;
}
export type ReviewSessionAction =
  | { type: 'answer'; questionId: string; value: string }
  | { type: 'confirm-answer'; questionId: string }
  | { type: 'navigate'; index: number }
  | { type: 'finish'; now: string };
export function transitionReviewSession(
  exam: Exam,
  session: ReviewSession,
  action: ReviewSessionAction,
): ReviewSession {
  if (action.type === 'navigate')
    return Number.isInteger(action.index) &&
      action.index >= 0 &&
      action.index < session.questionIds.length
      ? { ...session, currentIndex: action.index }
      : session;
  if (session.completedAt) return session;
  if (action.type === 'finish') {
    if (
      pendingSessionConfirmations(exam, session).length ||
      !z.iso.datetime().safeParse(action.now).success ||
      Date.parse(action.now) < Date.parse(session.startedAt)
    )
      return session;
    return { ...session, completedAt: action.now, result: calculateSessionResult(exam, session) };
  }
  const q = exam.questions.find((q) => q.id === action.questionId);
  if (!q || !session.questionIds.includes(q.id) || session.confirmedQuestionIds.includes(q.id))
    return session;
  if (action.type === 'confirm-answer')
    return session.mode === 'study' && questionBehaviors[q.type].isAnswered(session.answers[q.id])
      ? { ...session, confirmedQuestionIds: [...session.confirmedQuestionIds, q.id] }
      : session;
  return questionBehaviors[q.type].accepts(q, action.value)
    ? { ...session, answers: { ...session.answers, [q.id]: action.value } }
    : session;
}
// Presentation-only shape. It has neither Attempt.id nor an official persistence contract.
export type QuestionState = Pick<
  Attempt,
  'answers' | 'flagged' | 'mode' | 'confirmedQuestionIds' | 'completedAt' | 'currentIndex'
>;
export function sessionQuestionState(session: ReviewSession, flagged: string[]): QuestionState {
  return {
    answers: session.answers,
    flagged,
    mode: session.mode,
    confirmedQuestionIds: session.confirmedQuestionIds,
    completedAt: session.completedAt,
    currentIndex: session.currentIndex,
  };
}
