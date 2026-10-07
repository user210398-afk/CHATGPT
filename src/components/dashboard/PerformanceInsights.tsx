import type { PerformanceInsight } from '../../engine/analytics';
export function PerformanceInsights({ insights }: { insights: PerformanceInsight[] }) {
  return (
    <section className="performance-insights" aria-labelledby="performance-insights-title">
      <p className="eyebrow">LEITURAS DO RECORTE</p>
      <h2 id="performance-insights-title">Leituras do seu desempenho</h2>
      <p className="muted small">
        Regras determinísticas, sem IA. Leituras descritivas, sem previsão de desempenho futuro.
      </p>
      <div className="insight-list">
        {insights.map((insight) => (
          <article className={`performance-insight ${insight.kind}`} key={insight.title}>
            <h3>{insight.title}</h3>
            <p>{insight.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
