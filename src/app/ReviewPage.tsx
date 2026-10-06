import { useCallback, useEffect, useState } from 'react';
import type { Catalog } from '../../schema/catalog';
import type { Exam } from '../types/exam';
import { loadExam } from '../engine/exam-loader';
import { readReviewSummary, ReviewRepository } from '../engine/review-history';
import { readReviewSessionSummary } from '../engine/review-session-storage';
import { reviewSessionUrl, reviewUrl } from '../utils/paths';
import { useResource } from './useResource';
import { ReviewView } from '../components/review/ReviewView';
import { dateTime } from '../components/dashboard/Metrics';
const repository = new ReviewRepository(() => window.localStorage);
function AttemptReview({ exam, id }: { exam: Exam; id: string }) {
  const [loaded] = useState(() => {
    try {
      return { attempt: repository.load(exam, id), error: null };
    } catch (error) {
      return {
        attempt: null,
        error: error instanceof Error ? error.message : 'Revisão indisponível.',
      };
    }
  });
  const [attempt, setAttempt] = useState(loaded.attempt);
  const [error, setError] = useState(loaded.error);
  if (!attempt)
    return (
      <p role="alert" className="notice">
        {error}
      </p>
    );
  return (
    <>
      <header className="page-heading">
        <h1>{exam.title}</h1>
        <p>
          {dateTime(attempt.completedAt)} ·{' '}
          {attempt.mode === 'study' ? 'Modo Estudo' : 'Modo Prova'} ·{' '}
          {attempt.result!.percentage === null
            ? 'Sem nota automática'
            : `${attempt.result!.percentage}%`}
        </p>
      </header>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <ReviewView
        exam={exam}
        allowSessions
        attempt={attempt}
        onFlag={(questionId) => {
          try {
            setAttempt(repository.toggleFlag(exam, attempt, questionId));
            setError(null);
          } catch (error) {
            setError(
              `Não foi possível alterar a marcação de revisão. ${error instanceof Error ? error.message : ''}`,
            );
          }
        }}
      />
    </>
  );
}
function HistoricalRoute({ examId, attemptId }: { examId: string; attemptId: string }) {
  const loader = useCallback((signal: AbortSignal) => loadExam(examId, fetch, signal), [examId]);
  const { data, error } = useResource(loader);
  return (
    <>
      <a className="back-link" href={reviewUrl()}>
        ← Histórico de revisão
      </a>
      {data ? (
        <AttemptReview key={`${data.id}:${attemptId}`} exam={data} id={attemptId} />
      ) : (
        <p role={error ? 'alert' : 'status'}>{error ?? 'Carregando…'}</p>
      )}
    </>
  );
}
export function ReviewPage({
  catalog,
  examId,
  attemptId,
}: {
  catalog: Catalog;
  examId?: string;
  attemptId?: string;
}) {
  const snapshot = () =>
    catalog.exams.map((exam) => ({
      exam,
      ...readReviewSummary(exam),
      reviewSession: readReviewSessionSummary(exam),
    }));
  const [items, setItems] = useState(snapshot);
  useEffect(() => {
    const refresh = () => setItems(snapshot());
    window.addEventListener('pageshow', refresh);
    return () => window.removeEventListener('pageshow', refresh);
  }, [catalog]);
  if (examId && attemptId)
    return catalog.exams.some((exam) => exam.id === examId) ? (
      <HistoricalRoute examId={examId} attemptId={attemptId} />
    ) : (
      <p role="alert">Prova desconhecida. O registro local foi preservado.</p>
    );
  const available = items.filter(
    (item) => item.attempts.length || item.reviewSession.session || item.reviewSession.warning,
  );
  return (
    <div className="page-stack">
      <header className="page-heading">
        <p className="eyebrow">HISTÓRICO DETALHADO</p>
        <h1>Revisão</h1>
        <p className="muted">
          Revise respostas e explicações das tentativas concluídas neste navegador. As marcações
          podem ser alteradas.
        </p>
      </header>
      {items.some((item) => item.warning) && (
        <p role="status" className="notice">
          Há históricos detalhados incompatíveis ou indisponíveis. Os registros existentes foram
          preservados.
        </p>
      )}
      {!available.length && (
        <p role="status">Nenhuma tentativa detalhada disponível para revisão.</p>
      )}
      {available.map(({ exam, attempts, reviewSession }) => (
        <article className="card" key={exam.id}>
          <h2>{exam.title}</h2>
          <p>
            {exam.subject} · {attempts.length} tentativa(s) detalhada(s)
          </p>
          {reviewSession.warning && <p role="status">{reviewSession.warning}</p>}
          {reviewSession.session && (
            <p>
              <a className="button" href={reviewSessionUrl(exam.id)}>
                {reviewSession.session.completedAt
                  ? 'Ver resultado da sessão de revisão'
                  : 'Continuar sessão de revisão'}
              </a>
            </p>
          )}
          {attempts.length > 0 && (
            <p className="muted">
              Mais recente: {dateTime(attempts[0]!.completedAt)} ·{' '}
              {attempts[0]!.mode === 'study' ? 'Modo Estudo' : 'Modo Prova'} ·{' '}
              {attempts[0]!.result!.percentage === null
                ? 'Sem nota automática'
                : `${attempts[0]!.result!.percentage}%`}{' '}
              · {attempts[0]!.result!.incorrect} erros · {attempts[0]!.flagged.length} marcadas
            </p>
          )}
          <ul className="review-attempt-list">
            {attempts.map((attempt) => (
              <li key={attempt.id}>
                <a href={reviewUrl(exam.id, attempt.id)}>
                  Revisar tentativa de {dateTime(attempt.completedAt)}
                </a>
                <p>
                  {attempt.mode === 'study' ? 'Modo Estudo' : 'Modo Prova'} ·{' '}
                  {attempt.result!.percentage === null
                    ? 'Sem nota automática'
                    : `${attempt.result!.percentage}%`}{' '}
                  · {attempt.result!.correct} acertos · {attempt.result!.incorrect} erros ·{' '}
                  {attempt.result!.unanswered} em branco · {attempt.flagged.length} marcadas
                </p>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
