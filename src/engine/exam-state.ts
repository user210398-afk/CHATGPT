import { z } from 'zod';
import type { Exam } from '../types/exam';
import { questionBehaviors } from './question-behaviors';

export const resultSchema = z.strictObject({
  objectiveTotal: z.number().int().nonnegative(),
  objectiveAnswered: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(),
  unanswered: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100).nullable(),
  essayTotal: z.number().int().nonnegative(),
  essayAnswered: z.number().int().nonnegative(),
});
export const attemptSchema = z.strictObject({
  id: z.string().min(1),
  examId: z.string(),
  examRevision: z.number().int().positive(),
  currentIndex: z.number().int().nonnegative(),
  answers: z.record(z.string(), z.string()),
  flagged: z.array(z.string()),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  result: resultSchema.nullable(),
});
export type Attempt = z.infer<typeof attemptSchema>;
export type Result = z.infer<typeof resultSchema>;
export type ExamAction =
  | { type: 'answer'; questionId: string; value: string }
  | { type: 'navigate'; index: number }
  | { type: 'flag'; questionId: string }
  | { type: 'finish'; now: string };

export function createAttempt(
  exam: Exam,
  now = new Date().toISOString(),
  id = crypto.randomUUID(),
): Attempt {
  return {
    id,
    examId: exam.id,
    examRevision: exam.revision,
    currentIndex: 0,
    answers: {},
    flagged: [],
    startedAt: now,
    completedAt: null,
    result: null,
  };
}
export function answeredCount(exam: Exam, state: Attempt): number {
  return exam.questions.filter((q) => questionBehaviors[q.type].isAnswered(state.answers[q.id]))
    .length;
}
export function calculateResult(exam: Exam, state: Attempt): Result {
  const result: Result = {
    objectiveTotal: 0,
    objectiveAnswered: 0,
    correct: 0,
    incorrect: 0,
    unanswered: 0,
    percentage: null,
    essayTotal: 0,
    essayAnswered: 0,
  };
  for (const q of exam.questions) {
    const behavior = questionBehaviors[q.type];
    const answered = behavior.isAnswered(state.answers[q.id]);
    const grade = behavior.grade(q, state.answers[q.id]);
    if (grade === null) {
      result.essayTotal++;
      if (answered) result.essayAnswered++;
    } else {
      result.objectiveTotal++;
      if (answered) {
        result.objectiveAnswered++;
        if (grade) result.correct++;
        else result.incorrect++;
      } else result.unanswered++;
    }
  }
  result.percentage = result.objectiveTotal
    ? Math.round((result.correct / result.objectiveTotal) * 100)
    : null;
  return result;
}
export function transition(exam: Exam, state: Attempt, action: ExamAction): Attempt {
  if (action.type === 'navigate') {
    if (
      !Number.isInteger(action.index) ||
      action.index < 0 ||
      action.index >= exam.questions.length
    )
      return state;
    return { ...state, currentIndex: action.index };
  }
  if (state.completedAt) return state;
  if (action.type === 'finish') {
    if (
      !z.iso.datetime().safeParse(action.now).success ||
      Date.parse(action.now) < Date.parse(state.startedAt)
    )
      return state;
    return { ...state, completedAt: action.now, result: calculateResult(exam, state) };
  }
  const q = exam.questions.find((question) => question.id === action.questionId);
  if (!q) return state;
  if (action.type === 'flag')
    return {
      ...state,
      flagged: state.flagged.includes(q.id)
        ? state.flagged.filter((id) => id !== q.id)
        : [...state.flagged, q.id],
    };
  if (!questionBehaviors[q.type].accepts(q, action.value)) return state;
  return { ...state, answers: { ...state.answers, [q.id]: action.value } };
}
export function isCompatibleAttempt(exam: Exam, state: Attempt): boolean {
  if (
    state.examId !== exam.id ||
    state.examRevision !== exam.revision ||
    state.currentIndex >= exam.questions.length
  )
    return false;
  if (
    new Set(state.flagged).size !== state.flagged.length ||
    state.flagged.some((id) => !exam.questions.some((q) => q.id === id))
  )
    return false;
  for (const [id, answer] of Object.entries(state.answers)) {
    const q = exam.questions.find((item) => item.id === id);
    if (!q || !questionBehaviors[q.type].accepts(q, answer)) return false;
  }
  if (Boolean(state.completedAt) !== Boolean(state.result)) return false;
  if (state.completedAt && Date.parse(state.completedAt) < Date.parse(state.startedAt))
    return false;
  return (
    !state.result || JSON.stringify(state.result) === JSON.stringify(calculateResult(exam, state))
  );
}
