import type { Essay } from '../../types/exam';
import { RichContent } from '../common/RichContent';
import type { QuestionProps } from './types';
export function EssayQuestion({ question, answer, readOnly, onAnswer }: QuestionProps<Essay>) {
  return (
    <>
      <label className="field-label" htmlFor={`answer-${question.id}`}>
        Sua resposta
      </label>
      <textarea
        id={`answer-${question.id}`}
        rows={9}
        maxLength={100_000}
        value={answer ?? ''}
        readOnly={readOnly}
        placeholder="Organize seu raciocínio e escreva com suas palavras…"
        onChange={(event) => onAnswer(event.target.value)}
      />
      <p className="muted small">
        Resposta dissertativa. Compare com o modelo após confirmar no Modo Estudo ou finalizar; ela
        não recebe nota automática.
      </p>
      {readOnly && (
        <section className="feedback">
          <h3>Resposta-modelo</h3>
          <RichContent content={question.modelAnswer} />
          {question.explanation.length > 0 && (
            <>
              <h3>Explicação</h3>
              <RichContent content={question.explanation} />
            </>
          )}
        </section>
      )}
    </>
  );
}
