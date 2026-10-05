import { useEffect, useRef } from 'react';
import type { Attempt } from '../../engine/exam-state';
import type { HistoryEntry } from '../../engine/persistence';
export function Results({
  attempt,
  history,
  onReview,
  onRestart,
}: {
  attempt: Attempt;
  history: HistoryEntry[];
  onReview: () => void;
  onRestart: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const result = attempt.result;
  if (!result) return null;
  return (
    <section className="card results" aria-labelledby="results-title">
      <p className="eyebrow">TENTATIVA CONCLUÍDA</p>
      <p className="badge">{attempt.mode === 'study' ? 'Modo Estudo' : 'Modo Prova'}</p>
      <h2 id="results-title" ref={heading} tabIndex={-1}>
        Seu resultado
      </h2>
      <div className="score">
        {result.percentage === null ? 'Sem nota automática' : `${result.percentage}%`}
      </div>
      <p>
        {result.correct} de {result.objectiveTotal} questões objetivas corretas
      </p>
      <div className="result-metrics">
        <div>
          <strong className="success">{result.correct}</strong>
          <span>Acertos</span>
        </div>
        <div>
          <strong className="error">{result.incorrect}</strong>
          <span>Erros</span>
        </div>
        <div>
          <strong className="attention">{result.unanswered}</strong>
          <span>Objetivas em branco</span>
        </div>
      </div>
      {result.essayTotal > 0 && (
        <p className="notice">
          {result.essayAnswered} de {result.essayTotal} dissertativas respondidas. Consulte as
          respostas-modelo na revisão. Dissertativas não entram no percentual.
        </p>
      )}
      <div className="actions">
        <button className="primary" onClick={onReview}>
          Revisar respostas
        </button>
        <button onClick={onRestart}>Nova tentativa</button>
      </div>
      <details className="history">
        <summary>Histórico local · {history.length} tentativa(s)</summary>
        <ul>
          {history.map((item) => (
            <li key={item.id}>
              {new Date(item.completedAt ?? item.startedAt).toLocaleString('pt-BR')} ·{' '}
              {item.mode === 'study' ? 'Modo Estudo' : 'Modo Prova'} ·{' '}
              {item.result?.percentage === null
                ? 'Dissertativa'
                : `${item.result?.percentage}% nas objetivas`}
            </li>
          ))}
        </ul>
        <p className="muted small">Até 20 tentativas por prova e revisão, neste navegador.</p>
      </details>
    </section>
  );
}
