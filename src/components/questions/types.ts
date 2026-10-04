import type { Question } from '../../types/exam';
export interface QuestionProps<Q = Question> {
  question: Q;
  answer: string | undefined;
  readOnly: boolean;
  onAnswer: (value: string) => void;
}
