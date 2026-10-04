import type { ComponentType } from 'react';
import type { Question } from '../../types/exam';
import { EssayQuestion } from './EssayQuestion';
import { MultipleChoiceQuestion } from './MultipleChoiceQuestion';
import type { QuestionProps } from './types';

const renderers: Record<Question['type'], ComponentType<QuestionProps>> = {
  'multiple-choice': (props) =>
    props.question.type === 'multiple-choice' ? (
      <MultipleChoiceQuestion {...props} question={props.question} />
    ) : null,
  essay: (props) =>
    props.question.type === 'essay' ? <EssayQuestion {...props} question={props.question} /> : null,
};
export function QuestionRenderer(props: QuestionProps) {
  const Renderer = renderers[props.question.type];
  return <Renderer {...props} />;
}
