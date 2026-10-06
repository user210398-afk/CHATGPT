import type { Question } from '../../types/exam';
export interface QuestionProps<Q = Question> {
  solver?: {
    eliminated: string[];
    warning: string | null;
    setEliminated: (id: string, eliminated: boolean) => void;
  };
  scopeIdentity?: string;
  question: Q;
  answer: string | undefined;
  readOnly: boolean;
  onAnswer: (value: string) => void;
}
