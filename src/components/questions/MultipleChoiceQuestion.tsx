import type { MultipleChoice } from '../../types/exam';
import { RichContent } from '../common/RichContent';
import type { QuestionProps } from './types';
export function MultipleChoiceQuestion({
  question,
  answer,
  readOnly,
  onAnswer,
}: QuestionProps<MultipleChoice>) {
  return (
    <>
      <fieldset className="options" disabled={readOnly}>
        <legend className="sr-only">Selecione uma alternativa</legend>
        {question.options.map((option) => {
          const status =
            readOnly && option.id === question.correctAnswer
              ? 'correct'
              : readOnly && option.id === answer
                ? 'incorrect'
                : option.id === answer
                  ? 'selected'
                  : '';
          return (
            <label className={`option ${status}`} key={option.id}>
              <input
                type="radio"
                name={question.id}
                value={option.id}
                checked={option.id === answer}
                onChange={() => onAnswer(option.id)}
              />
              <span className="option-content">
                <RichContent content={option.text} />
                {readOnly && option.id === question.correctAnswer && (
                  <span className="answer-note">Resposta correta</span>
                )}
                {readOnly && option.id === answer && (
                  <span className="answer-note">Sua resposta</span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      {readOnly && (
        <section className="feedback">
          <h3>Explicação</h3>
          <RichContent content={question.explanation} />
        </section>
      )}
    </>
  );
}
