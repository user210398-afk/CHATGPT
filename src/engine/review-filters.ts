import type { Exam, Question } from '../types/exam';
import type { Attempt } from './exam-state';
import { questionBehaviors } from './question-behaviors';
export type ReviewStatus = 'all' | 'correct' | 'incorrect' | 'unanswered' | 'essay';
export type ReviewFilters = {
  status: ReviewStatus;
  flaggedOnly: boolean;
  category: string;
  tag: string;
};
export const defaultReviewFilters: ReviewFilters = {
  status: 'all',
  flaggedOnly: false,
  category: '',
  tag: '',
};
export function reviewQuestionStatus(
  question: Question,
  attempt: Attempt,
): Exclude<ReviewStatus, 'all'> {
  if (question.type === 'essay') return 'essay';
  if (!questionBehaviors[question.type].isAnswered(attempt.answers[question.id]))
    return 'unanswered';
  return questionBehaviors[question.type].grade(question, attempt.answers[question.id])
    ? 'correct'
    : 'incorrect';
}
export function reviewQuestionIndices(
  exam: Exam,
  attempt: Attempt,
  filters: ReviewFilters,
): number[] {
  return exam.questions.flatMap((q, index) =>
    (filters.status === 'all' || reviewQuestionStatus(q, attempt) === filters.status) &&
    (!filters.flaggedOnly || attempt.flagged.includes(q.id)) &&
    (!filters.category || q.category === filters.category) &&
    (!filters.tag || q.tags.includes(filters.tag))
      ? [index]
      : [],
  );
}
export function reviewCounts(exam: Exam, attempt: Attempt) {
  const counts = {
    correct: 0,
    incorrect: 0,
    unanswered: 0,
    essay: 0,
    flagged: attempt.flagged.length,
  };
  for (const q of exam.questions) counts[reviewQuestionStatus(q, attempt)]++;
  return counts;
}
