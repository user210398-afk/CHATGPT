import { useRef, useEffect, useState } from 'react';
import type { Exam } from '../types/exam';
import { useReviewSession } from './useReviewSession';
import {
  pendingSessionConfirmations,
  sessionExam,
  sessionQuestionState,
} from '../engine/review-session';
import { QuestionCard } from '../components/questions/QuestionCard';
import { QuestionNavigation } from '../components/exam/QuestionNavigation';
import { reviewUrl } from '../utils/paths';
export function ReviewSessionPage({ exam }: { exam: Exam }) {
  const { session, source, error, saving, dispatch, toggleFlag, discard } = useReviewSession(exam);
  const [reviewing, setReviewing] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const region = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const finishTrigger = useRef<HTMLButtonElement>(null);
  const discardTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<'finish' | 'discard' | null>(null);
  useEffect(() => {
    if (session?.completedAt && !reviewing) resultHeading.current?.focus();
  }, [session?.completedAt, reviewing]);
  useEffect(() => {
    if (confirmFinish || confirmDiscard) region.current?.focus();
    else if (returnFocus.current) {
      (returnFocus.current === 'finish' ? finishTrigger : discardTrigger).current?.focus();
      returnFocus.current = null;
    }
  }, [confirmFinish, confirmDiscard]);
  if (!session)
    return (
      <>
        <a href={reviewUrl()}>Voltar ao Review Hub</a>
        <p role="alert">{error ?? 'Nenhuma sessão de revisão disponível para esta prova.'}</p>
      </>
    );
  const subset = sessionExam(exam, session),
    state = sessionQuestionState(session, source?.flagged ?? []);
  const q = subset.questions[session.currentIndex]!;
  const pending = pendingSessionConfirmations(exam, session);
  return (
    <div className="page-stack">
      <a className="back-link" href={reviewUrl(exam.id, session.sourceAttemptId)}>
        ← Tentativa original
      </a>
      <header className="page-heading">
        <p className="eyebrow">SESSÃO DE REVISÃO</p>
        <h1>{exam.title}</h1>
        <p>
          {session.mode === 'study' ? 'Modo Estudo' : 'Modo Prova'} · {subset.questions.length}{' '}
          questões selecionadas
        </p>
        <p>Esta sessão não altera as estatísticas da prova nem da Dashboard.</p>
      </header>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {!source && (
        <p role="status" className="notice">
          A tentativa fonte não está disponível. A marcação original não pôde ser atualizada; a
          sessão continua respondível.
        </p>
      )}
      {session.result && (
        <section className="card" aria-labelledby="session-result-title">
          <h2 id="session-result-title" ref={resultHeading} tabIndex={-1}>
            Resultado desta sessão de revisão
          </h2>
          <p>
            {session.result.total} questões revisadas · {session.result.objectiveTotal} objetivas ·{' '}
            {session.result.essayTotal} dissertativas
          </p>
          <p>
            {session.result.correct} corretas · {session.result.incorrect} incorretas ·{' '}
            {session.result.unanswered} objetivas em branco · {session.result.objectiveAnswered}{' '}
            objetivas respondidas
          </p>
          <p>
            {session.result.essayAnswered} dissertativas respondidas ·{' '}
            {session.result.percentage === null
              ? 'Sem nota automática'
              : `${session.result.percentage}% nas objetivas da sessão`}
          </p>
          <p>Dissertativas não recebem nota automática.</p>
          <div className="actions">
            <button onClick={() => setReviewing(!reviewing)}>
              {reviewing ? 'Voltar ao resultado da sessão' : 'Revisar respostas da sessão'}
            </button>
            <a className="button" href={reviewUrl()}>
              Voltar ao Review Hub
            </a>
          </div>
        </section>
      )}
      {(!session.completedAt || reviewing) && (
        <div className="exam-layout">
          <QuestionCard
            isReviewSession
            exam={subset}
            annotationExam={exam}
            solverScope={{ kind: 'review-session', id: session.id }}
            attempt={state}
            index={session.currentIndex}
            feedback={
              Boolean(session.completedAt) ||
              (session.mode === 'study' && session.confirmedQuestionIds.includes(q.id))
            }
            onAnswer={(value) => dispatch({ type: 'answer', questionId: q.id, value })}
            onConfirm={() => dispatch({ type: 'confirm-answer', questionId: q.id })}
            onFlag={() => toggleFlag(q.id)}
          >
            <div className="question-controls">
              <button
                disabled={session.currentIndex === 0}
                onClick={() => dispatch({ type: 'navigate', index: session.currentIndex - 1 })}
              >
                ← Anterior
              </button>
              <span>
                {session.currentIndex + 1} / {subset.questions.length}
              </span>
              <button
                disabled={session.currentIndex === subset.questions.length - 1}
                onClick={() => dispatch({ type: 'navigate', index: session.currentIndex + 1 })}
              >
                Próxima →
              </button>
            </div>
          </QuestionCard>
          <div className="exam-sidebar">
            <QuestionNavigation
              isReviewSession
              title="Mapa da sessão"
              exam={subset}
              attempt={state}
              onNavigate={(index) => dispatch({ type: 'navigate', index })}
            />
            {!session.completedAt && (
              <section className="card finish-card">
                <p role="status">
                  {saving
                    ? 'Salvando resposta…'
                    : error
                      ? 'Confira o aviso de salvamento.'
                      : 'Progresso da sessão salvo neste navegador.'}
                </p>
                {confirmFinish ? (
                  <section role="region" aria-label="Confirmar finalização da sessão">
                    <h3 ref={region} tabIndex={-1}>
                      Finalizar sessão de revisão?
                    </h3>
                    {pending.length > 0 && (
                      <p role="alert">Existem {pending.length} respostas ainda não confirmadas.</p>
                    )}
                    <button
                      disabled={pending.length > 0}
                      onClick={() => {
                        dispatch({ type: 'finish', now: new Date().toISOString() });
                        setConfirmFinish(false);
                      }}
                    >
                      Confirmar finalização da sessão
                    </button>
                    {pending.length > 0 && (
                      <button
                        onClick={() => {
                          dispatch({
                            type: 'navigate',
                            index: subset.questions.findIndex((q) => q.id === pending[0]),
                          });
                          setConfirmFinish(false);
                        }}
                      >
                        Ir para primeira resposta pendente
                      </button>
                    )}
                    <button
                      onClick={() => {
                        returnFocus.current = 'finish';
                        setConfirmFinish(false);
                      }}
                    >
                      Continuar respondendo
                    </button>
                  </section>
                ) : (
                  <button
                    ref={finishTrigger}
                    onClick={() => {
                      setConfirmDiscard(false);
                      setConfirmFinish(true);
                    }}
                  >
                    Finalizar sessão
                  </button>
                )}
              </section>
            )}
          </div>
        </div>
      )}
      <section className="card">
        <button
          ref={discardTrigger}
          onClick={() => {
            setConfirmFinish(false);
            setConfirmDiscard(true);
          }}
        >
          Descartar sessão de revisão
        </button>
        {confirmDiscard && (
          <section role="region" aria-label="Confirmar descarte da sessão">
            <h3 ref={region} tabIndex={-1}>
              Descartar esta sessão?
            </h3>
            <p>
              As respostas desta sessão serão removidas. A tentativa original permanece disponível.
            </p>
            <button
              className="danger"
              onClick={() => {
                if (discard()) window.location.assign(reviewUrl());
              }}
            >
              Confirmar descarte da sessão
            </button>
            <button
              onClick={() => {
                returnFocus.current = 'discard';
                setConfirmDiscard(false);
              }}
            >
              Cancelar descarte
            </button>
          </section>
        )}
      </section>
    </div>
  );
}
