import { createAttempt, transition } from '../src/engine/exam-state';
import { createReviewSession, type ReviewSelection } from '../src/engine/review-session';
import { first, firstEssay, poc } from './fixtures';
import { catalogExam } from './catalog-fixtures';
export { memory } from './phase7b1-fixtures';
export const now = '2026-10-05T18:00:00.000Z',
  end = '2026-10-05T19:00:00.000Z';
export const tiny = {
  ...poc,
  questions: [
    { ...first, category: 'A', tags: ['x', 'z'] },
    { ...poc.questions[1]!, category: 'A', tags: ['y', 'z'] },
    { ...firstEssay, category: 'B', tags: ['x'] },
  ],
};
export const tinyCatalog = {
  schemaVersion: 1 as const,
  exams: [{ ...catalogExam, questionCount: 3, objectiveCount: 2, essayCount: 1 }],
};
export const objective = tiny.questions[0]!;
export const second = tiny.questions[1]!;
export const essay = tiny.questions[2]!;
export function source(id = 'source') {
  let attempt = createAttempt(tiny, '2026-10-05T16:00:00.000Z', id);
  if (objective.type !== 'multiple-choice' || second.type !== 'multiple-choice')
    throw new Error('fixture');
  const correct = objective.correctAnswer;
  attempt = transition(tiny, attempt, {
    type: 'answer',
    questionId: objective.id,
    value: objective.options.find((o) => o.id !== correct)!.id,
  });
  attempt = transition(tiny, attempt, {
    type: 'answer',
    questionId: second.id,
    value: second.correctAnswer,
  });
  attempt = transition(tiny, attempt, { type: 'flag', questionId: objective.id });
  attempt = transition(tiny, attempt, { type: 'flag', questionId: essay.id });
  return transition(tiny, attempt, { type: 'finish', now: '2026-10-05T17:00:00.000Z' });
}
export const all: ReviewSelection = {
  kind: 'filtered',
  filters: { status: 'all', flaggedOnly: false, category: '', tag: '' },
};
export function session(
  mode: 'exam' | 'study' = 'exam',
  selection: ReviewSelection = all,
  id = 'session',
) {
  return createReviewSession(tiny, source(), selection, mode, now, id);
}
