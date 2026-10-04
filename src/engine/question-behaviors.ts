import type { Question } from '../types/exam';

interface QuestionBehavior {
  accepts: (question: Question, answer: string) => boolean;
  isAnswered: (answer: string | undefined) => boolean;
  grade: (question: Question, answer: string | undefined) => boolean | null;
}
// Novos tipos adicionam um contrato aqui e um renderer; o ciclo da tentativa é comum.
export const questionBehaviors: Record<Question['type'], QuestionBehavior> = {
  'multiple-choice': {
    accepts: (q, answer) =>
      q.type === 'multiple-choice' && q.options.some((option) => option.id === answer),
    isAnswered: (answer) => answer !== undefined && answer.length > 0,
    grade: (q, answer) => q.type === 'multiple-choice' && answer === q.correctAnswer,
  },
  essay: {
    accepts: (_q, answer) => answer.length <= 100_000,
    isAnswered: (answer) => Boolean(answer?.trim()),
    grade: () => null,
  },
};
