import { useLayoutEffect, useRef } from 'react';
import type { MultipleChoice } from '../../types/exam';
import { RichContent } from '../common/RichContent';
import { OptionClickArbiter } from '../../engine/option-click-arbiter';
import type { QuestionProps } from './types';
export function MultipleChoiceQuestion({
  question,
  answer,
  readOnly,
  onAnswer,
  solver,
  scopeIdentity = 'standalone',
}: QuestionProps<MultipleChoice>) {
  const arbiter = useRef(new OptionClickArbiter());
  const latest = useRef({ onAnswer, readOnly });
  latest.current = { onAnswer, readOnly };
  useLayoutEffect(() => {
    const current = arbiter.current;
    current.dispose();
    return () => current.dispose();
  }, [question.id, scopeIdentity, readOnly]);
  function respond(id: string) {
    arbiter.current.cancel();
    if (!latest.current.readOnly) latest.current.onAnswer(id);
  }
  return (
    <>
      <fieldset className="options" disabled={readOnly}>
        <legend className="sr-only">Selecione uma alternativa</legend>
        {question.options.map((option, optionIndex) => {
          const selected = option.id === answer;
          const eliminated =
            !readOnly && !selected && Boolean(solver?.eliminated.includes(option.id));
          const status =
            readOnly && option.id === question.correctAnswer
              ? 'correct'
              : readOnly && selected
                ? 'incorrect'
                : selected
                  ? 'selected'
                  : '';
          const contentId = `option-text-${question.id}-${option.id}`;
          return (
            <div
              className={`option ${status} ${eliminated ? 'eliminated' : ''}`}
              key={option.id}
              onClick={(event) => {
                if (readOnly) return;
                if (
                  (event.target as Element).closest(
                    'input,button,a,select,textarea,label,summary,[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex="-1"]),[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="link"],[role="textbox"],[role="slider"],[role="combobox"]',
                  )
                ) {
                  arbiter.current.cancel();
                  return;
                }
                event.currentTarget.querySelector('input')?.focus();
                arbiter.current.click(
                  JSON.stringify([scopeIdentity, question.id, option.id]),
                  event.detail,
                  () => respond(option.id),
                  () => solver?.setEliminated(option.id, !eliminated),
                );
              }}
            >
              <input
                type="radio"
                name={question.id}
                value={option.id}
                aria-labelledby={contentId}
                checked={selected}
                onClick={(event) => {
                  event.stopPropagation();
                  arbiter.current.cancel();
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                onChange={() => respond(option.id)}
              />
              <div className="option-content" id={contentId}>
                <RichContent content={option.text} />
                {eliminated && <span className="elimination-note">Eliminada para estudo</span>}
                {readOnly && option.id === question.correctAnswer && (
                  <span className="answer-note">Resposta correta</span>
                )}
                {readOnly && selected && <span className="answer-note">Sua resposta</span>}
              </div>
              {!readOnly && solver && (
                <button
                  className="eliminate-button"
                  aria-controls={contentId}
                  aria-pressed={eliminated}
                  aria-label={`${eliminated ? 'Restaurar' : 'Eliminar'} alternativa ${optionIndex + 1}`}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    arbiter.current.cancel();
                    solver.setEliminated(option.id, !eliminated);
                  }}
                >
                  {eliminated ? 'Restaurar alternativa' : 'Eliminar alternativa'}
                </button>
              )}
            </div>
          );
        })}
      </fieldset>
      {solver?.warning && (
        <p role="status" className="notice">
          {solver.warning}
        </p>
      )}
      {readOnly && (
        <section className="feedback">
          <h3>Explicação</h3>
          <RichContent content={question.explanation} />
        </section>
      )}
    </>
  );
}
