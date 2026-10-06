import { useState } from 'react';
import type { Exam } from '../../types/exam';
import { useExamSession } from '../../app/useExamSession';
import { answeredCount, pendingConfirmationIds } from '../../engine/exam-state';
import { readUiPreferences, type UiPreferences } from '../../engine/ui-preferences';
import { subjectUrl } from '../../utils/paths';
import { subjectGroupDefinition } from '../../engine/subject-groups';
import { Images } from '../common/Images';
import { Results } from '../results/Results';
import { QuestionNavigation } from './QuestionNavigation';
import { ModeChooser } from './ModeChooser';
import { QuestionCard } from '../questions/QuestionCard';
import { ReviewView } from '../review/ReviewView';
export function ExamPage({
  exam,
  preference,
}: {
  exam: Exam;
  preference?: UiPreferences['attemptModePreference'];
}) {
  const [fallback] = useState(() => readUiPreferences().preferences.attemptModePreference);
  const { current, history, restored, warning, saving, choosing, dispatch, restart, start } =
    useExamSession(exam, preference ?? fallback);
  const [review, setReview] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const finished = Boolean(current?.completedAt);
  const count = current ? answeredCount(exam, current) : 0;
  const pending = current ? pendingConfirmationIds(exam, current) : [];
  const question = current ? exam.questions[current.currentIndex]! : null;
  return (
    <>
      <a className="back-link" href={subjectUrl(subjectGroupDefinition(exam.subject).id)}>
        ← Simulados da matéria
      </a>
      <header className="page-heading">
        <p className="eyebrow">
          {exam.subject} / {exam.division} / {exam.year ?? 'Ano não informado'}
        </p>
        <h1>{exam.title}</h1>
        {exam.description && <p className="muted">{exam.description}</p>}
        {current && !choosing && (
          <>
            <p className="badge">{current.mode === 'study' ? 'Modo Estudo' : 'Modo Prova'}</p>
            {!finished && (
              <p className="muted small">
                {current.mode === 'study'
                  ? 'Confirme cada resposta para liberar o feedback.'
                  : 'Feedback após finalizar.'}
              </p>
            )}
          </>
        )}
      </header>
      <Images images={exam.images} />
      {warning && (
        <p role="alert" className="notice">
          {warning}
        </p>
      )}
      {restored && !choosing && (
        <p className="save-status">✓ Tentativa restaurada neste navegador.</p>
      )}
      {choosing || !current ? (
        <ModeChooser onStart={start} />
      ) : finished ? (
        review ? (
          <>
            <div className="notice actions">
              <span>Revisão · respostas e resultado preservados.</span>
              <button onClick={() => setReview(false)}>Voltar ao resultado</button>
            </div>
            <ReviewView
              exam={exam}
              attempt={current}
              onFlag={(questionId) => dispatch({ type: 'flag', questionId })}
            />
          </>
        ) : (
          <Results
            attempt={current}
            history={history}
            onReview={() => setReview(true)}
            onRestart={() => {
              if (restart()) setReview(false);
            }}
          />
        )
      ) : (
        <div className="exam-layout">
          <QuestionCard
            exam={exam}
            attempt={current}
            solverScope={{ kind: 'attempt', id: current.id }}
            index={current.currentIndex}
            feedback={
              current.mode === 'study' && current.confirmedQuestionIds.includes(question!.id)
            }
            onAnswer={(value) => dispatch({ type: 'answer', questionId: question!.id, value })}
            onFlag={() => dispatch({ type: 'flag', questionId: question!.id })}
            onConfirm={() => dispatch({ type: 'confirm-answer', questionId: question!.id })}
          >
            <div className="question-controls">
              <button
                disabled={current.currentIndex === 0}
                onClick={() => dispatch({ type: 'navigate', index: current.currentIndex - 1 })}
              >
                ← Anterior
              </button>
              <span className="muted small">
                {current.currentIndex + 1} / {exam.questions.length}
              </span>
              <button
                className="primary"
                disabled={current.currentIndex === exam.questions.length - 1}
                onClick={() => dispatch({ type: 'navigate', index: current.currentIndex + 1 })}
              >
                Próxima →
              </button>
            </div>
          </QuestionCard>
          <div className="exam-sidebar">
            <QuestionNavigation
              exam={exam}
              attempt={current}
              onNavigate={(index) => dispatch({ type: 'navigate', index })}
            />
            <section className="card finish-card">
              <p className="save-status">
                {saving
                  ? 'Salvando resposta…'
                  : warning
                    ? 'Salvamento local indisponível'
                    : '✓ Progresso salvo neste navegador'}
              </p>
              {confirmFinish ? (
                <div role="region" aria-label="Confirmar finalização">
                  <h3>Finalizar tentativa?</h3>
                  {pending.length ? (
                    <>
                      <p role="alert">Existem {pending.length} respostas ainda não confirmadas.</p>
                      <button
                        onClick={() => {
                          dispatch({
                            type: 'navigate',
                            index: exam.questions.findIndex((q) => q.id === pending[0]),
                          });
                          setConfirmFinish(false);
                        }}
                      >
                        Ir para primeira resposta pendente
                      </button>
                    </>
                  ) : (
                    <>
                      <p>
                        {exam.questions.length - count} questão(ões) sem resposta. Após finalizar,
                        as respostas ficam disponíveis para revisão.
                      </p>
                      <button
                        className="primary"
                        onClick={() => {
                          dispatch({ type: 'finish', now: new Date().toISOString() });
                          setConfirmFinish(false);
                        }}
                      >
                        Confirmar finalização
                      </button>
                    </>
                  )}
                  <button onClick={() => setConfirmFinish(false)}>Continuar respondendo</button>
                </div>
              ) : (
                <button className="full-width" onClick={() => setConfirmFinish(true)}>
                  Finalizar tentativa
                </button>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
