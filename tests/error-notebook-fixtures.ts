import type { Catalog } from '../schema/catalog';
import type { Exam } from '../src/types/exam';
import {
  createAttempt,
  transition,
  type Attempt,
  type AttemptMode,
} from '../src/engine/exam-state';
import { poc, firstEssay } from './fixtures';
import { catalogExam } from './catalog-fixtures';
import { memory } from './phase7b1-fixtures';

export const notebookExam: Exam = {
  ...poc,
  questions: [...poc.questions.filter((q) => q.type === 'multiple-choice').slice(0, 2), firstEssay],
};
export const notebookCatalog: Catalog = {
  schemaVersion: 1,
  exams: [{ ...catalogExam, questionCount: 3, objectiveCount: 2, essayCount: 1 }],
};
export function notebookAttempt(
  outcome: 'correct' | 'incorrect' | 'unanswered',
  id = 'attempt',
  day = 1,
  mode: AttemptMode = 'exam',
  exam = notebookExam,
): Attempt {
  const date = `2026-10-${String(day).padStart(2, '0')}`;
  let attempt = createAttempt(exam, `${date}T10:00:00.000Z`, id, mode);
  const question = exam.questions[0]!;
  if (question.type !== 'multiple-choice') throw new Error('Objetiva requerida.');
  if (outcome !== 'unanswered') {
    attempt = transition(exam, attempt, {
      type: 'answer',
      questionId: question.id,
      value:
        outcome === 'correct'
          ? question.correctAnswer
          : question.options.find((option) => option.id !== question.correctAnswer)!.id,
    });
    if (mode === 'study')
      attempt = transition(exam, attempt, { type: 'confirm-answer', questionId: question.id });
  }
  return transition(exam, attempt, { type: 'finish', now: `${date}T11:00:00.000Z` });
}
export function notebookMemory(entries: [string, string][] = []) {
  const store = memory(entries);
  return {
    ...store,
    get length() {
      return store.values.size;
    },
    key: (index: number) => [...store.values.keys()][index] ?? null,
  };
}
