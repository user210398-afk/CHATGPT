import type { Catalog } from '../schema/catalog';
import type { CatalogExam } from '../src/engine/catalog-progress';
import { createAttempt, transition } from '../src/engine/exam-state';
import { poc } from './fixtures';
export const catalogExam: CatalogExam = {
  id: poc.id,
  revision: poc.revision,
  title: poc.title,
  subject: poc.subject,
  year: poc.year,
  division: poc.division,
  description: poc.description,
  tags: poc.tags,
  questionCount: poc.questions.length,
  objectiveCount: poc.questions.filter((q) => q.type === 'multiple-choice').length,
  essayCount: poc.questions.filter((q) => q.type === 'essay').length,
};
export const testCatalog: Catalog = {
  schemaVersion: 1,
  exams: [
    catalogExam,
    {
      ...catalogExam,
      id: 'card-objective',
      title: 'Álgebra médica',
      subject: 'Farmacologia',
      year: 2025,
      questionCount: 20,
      essayCount: 0,
    },
    {
      ...catalogExam,
      id: 'card-essay',
      title: 'Zoologia',
      subject: 'Fisiologia',
      year: null,
      questionCount: 10,
      objectiveCount: 0,
    },
  ],
};
export function completedAttempt(id = 'completed', correct = 1, date = '2026-10-03T11:00:00.000Z') {
  let attempt = { ...createAttempt(poc, '2026-10-03T10:00:00.000Z'), id };
  for (const q of poc.questions
    .filter((question) => question.type === 'multiple-choice')
    .slice(0, correct)) {
    if (q.type === 'multiple-choice')
      attempt = transition(poc, attempt, {
        type: 'answer',
        questionId: q.id,
        value: q.correctAnswer,
      });
  }
  return transition(poc, attempt, { type: 'finish', now: date });
}
