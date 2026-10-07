import type { SubjectStatistic } from '../../engine/analytics';
export function SubjectPerformanceChart({
  subjects,
  onSelect,
}: {
  subjects: SubjectStatistic[];
  onSelect: (subject: string) => void;
}) {
  return (
    <section className="analytics-complement" aria-labelledby="subject-performance-title">
      <h3 id="subject-performance-title">Médias por disciplina</h3>
      <p className="muted small">
        Média dos percentuais; cada tentativa pontuada tem peso 1. Toque em uma disciplina para
        filtrar.
      </p>
      {!subjects.length ? (
        <p className="analytics-empty">Nenhuma tentativa concluída neste recorte.</p>
      ) : (
        <ul className="subject-performance-list">
          {subjects.map((item) => (
            <li key={item.subject}>
              <button
                className="subject-performance-bar"
                onClick={() => onSelect(item.subject)}
                aria-label={`Filtrar ${item.subject}: ${item.average === null ? 'sem nota automática' : `${item.average.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}, ${item.scoredCount} resultados usados`}
              >
                <span className="subject-bar-label">
                  <strong>{item.subject}</strong>
                  <strong>
                    {item.average === null
                      ? '—'
                      : `${item.average.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
                  </strong>
                </span>
                <span className="subject-bar-track" aria-hidden="true">
                  <span style={{ width: `${item.average ?? 0}%` }} />
                </span>
                <span className="muted small">
                  {item.scoredCount} resultados usados
                  {item.scoredCount < 3 ? ' · amostra pequena' : ''}
                  {item.scoredCount === 0 ? ' · sem nota automática' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
