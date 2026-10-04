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
          const contentId = `option-text-${question.id}-${option.id}`;
          return (
            <div
              className={`option ${status}`}
              key={option.id}
              onClick={(event) => {
                if (readOnly) return;
                event.currentTarget.querySelector('input')?.focus();
                onAnswer(option.id);
              }}
            >
              <input
                type="radio"
                name={question.id}
                value={option.id}
                aria-labelledby={contentId}
                checked={option.id === answer}
                onClick={(event) => event.stopPropagation()}
                onChange={() => onAnswer(option.id)}
              />
              <div className="option-content" id={contentId}>
                <RichContent content={option.text} />
                {readOnly && option.id === question.correctAnswer && (
                  <span className="answer-note">Resposta correta</span>
                )}
                {readOnly && option.id === answer && (
                  <span className="answer-note">Sua resposta</span>
                )}
              </div>
            </div>
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
