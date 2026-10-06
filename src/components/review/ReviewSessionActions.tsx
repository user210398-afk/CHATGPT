import { useEffect, useRef, useState } from 'react';
import type { Exam } from '../../types/exam';
import type { Attempt } from '../../engine/exam-state';
import { selectReviewQuestions, type ReviewSelection } from '../../engine/review-session';
import { ReviewSessionRepository } from '../../engine/review-session-storage';
import type { ReviewFilters } from '../../engine/review-filters';
import { reviewSessionUrl } from '../../utils/paths';
const repository = new ReviewSessionRepository(() => window.localStorage);
export function ReviewSessionActions({
  exam,
  attempt,
  filters,
}: {
  exam: Exam;
  attempt: Attempt;
  filters: ReviewFilters;
}) {
  const [choice, setChoice] = useState<{
    selection: ReviewSelection;
    raw: string | null;
    active: boolean;
    completed: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (choice) heading.current?.focus();
  }, [choice]);
  function choose(selection: ReviewSelection, button: HTMLButtonElement) {
    try {
      const { session, raw } = repository.read(exam);
      trigger.current = button;
      setDiscardConfirmed(false);
      setError(null);
      setChoice({
        selection,
        raw,
        active: Boolean(session && !session.completedAt),
        completed: Boolean(session?.completedAt),
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Sessão indisponível. O registro foi preservado.',
      );
    }
  }
  const actions: [ReviewSelection, string][] = [
    [{ kind: 'incorrect' }, 'Refazer erradas'],
    [{ kind: 'flagged' }, 'Refazer marcadas'],
    [{ kind: 'filtered', filters: { ...filters } }, 'Iniciar sessão com filtros atuais'],
  ];
  return (
    <section className="review-session-actions" aria-label="Sessões direcionadas de revisão">
      <p>Esta sessão não altera as estatísticas da prova nem da Dashboard.</p>
      <div className="actions">
        {actions.map(([selection, label]) => {
          const count = selectReviewQuestions(exam, attempt, selection).length;
          return (
            <button
              key={selection.kind}
              disabled={!count}
              onClick={(e) => choose(selection, e.currentTarget)}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {choice && (
        <section
          className="card confirmation-region"
          role="region"
          aria-labelledby="session-choice-title"
        >
          <h3 ref={heading} tabIndex={-1} id="session-choice-title">
            Como deseja fazer esta sessão de revisão?
          </h3>
          <p>
            {selectReviewQuestions(exam, attempt, choice.selection).length} questões selecionadas.
          </p>
          {choice.active && (
            <>
              <p>Existe uma sessão em andamento nesta prova.</p>
              <a className="button" href={reviewSessionUrl(exam.id)}>
                Continuar sessão atual
              </a>
              <label className="setting-check">
                <input
                  type="checkbox"
                  checked={discardConfirmed}
                  onChange={(e) => setDiscardConfirmed(e.target.checked)}
                />
                Descartar sessão atual e iniciar nova
              </label>
            </>
          )}
          {choice.completed && (
            <p>A sessão concluída anterior será substituída ao iniciar uma nova.</p>
          )}
          <div className="actions">
            {(['exam', 'study'] as const).map((mode) => (
              <button
                key={mode}
                disabled={choice.active && !discardConfirmed}
                onClick={() => {
                  try {
                    repository.start(
                      exam,
                      attempt,
                      choice.selection,
                      mode,
                      choice.raw,
                      choice.active && discardConfirmed,
                    );
                    window.location.assign(reviewSessionUrl(exam.id));
                  } catch (error) {
                    setError(error instanceof Error ? error.message : 'Não foi possível iniciar.');
                  }
                }}
              >
                Iniciar sessão em Modo {mode === 'study' ? 'Estudo' : 'Prova'}
              </button>
            ))}
            <button
              onClick={() => {
                setChoice(null);
                trigger.current?.focus();
              }}
            >
              Cancelar
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
