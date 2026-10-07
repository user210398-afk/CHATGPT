import type { ActivityBucket, AnalyticsFilters } from '../../engine/analytics';
export function StudyRhythmChart({
  buckets,
  period,
}: {
  buckets: ActivityBucket[];
  period: AnalyticsFilters['period'];
}) {
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.exam + bucket.study));
  return (
    <section className="analytics-complement" aria-labelledby="study-rhythm-title">
      <h3 id="study-rhythm-title">Ritmo de estudo</h3>
      <p className="muted small">
        Tentativas concluídas, incluindo as sem nota automática.{' '}
        {period === 'all'
          ? 'Meses com atividade (UTC).'
          : `Intervalos ${period === 7 ? 'diários' : 'semanais'} a partir do início do recorte; datas em UTC.`}
      </p>
      <div className="chart-legend">
        <span className="legend-block">Prova · sólido</span>
        <span className="legend-block study">Estudo · tracejado</span>
      </div>
      {!buckets.length ? (
        <p className="analytics-empty">Nenhuma atividade concluída neste recorte.</p>
      ) : (
        <ul className="rhythm-list">
          {buckets.map((bucket) => (
            <li
              key={bucket.start}
              aria-label={`${bucket.label}: ${bucket.exam} Modo Prova; ${bucket.study} Modo Estudo`}
            >
              <span className="rhythm-label">{bucket.label}</span>
              <span className="rhythm-track" aria-hidden="true">
                {bucket.exam > 0 && (
                  <span
                    className="rhythm-exam"
                    style={{ width: `${(bucket.exam / maximum) * 100}%` }}
                  />
                )}
                {bucket.study > 0 && (
                  <span
                    className="rhythm-study"
                    style={{ width: `${(bucket.study / maximum) * 100}%` }}
                  />
                )}
              </span>
              <span className="rhythm-count">
                {bucket.exam} Prova · {bucket.study} Estudo
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
