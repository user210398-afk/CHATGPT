import type { aggregateGlobalMetrics } from '../../engine/dashboard-metrics';
export const percentage = (value: number | null) => (value === null ? '—' : `${value}%`);
export const dateTime = (value: string | null) =>
  value === null ? '—' : new Date(value).toLocaleString('pt-BR');
export function Metrics({
  metrics: m,
  unavailable = false,
}: {
  metrics: ReturnType<typeof aggregateGlobalMetrics>;
  unavailable?: boolean;
}) {
  const values: [string, string | number][] = [
    ['Último resultado', percentage(m.last)],
    ['Melhor resultado', percentage(m.best)],
    ['Tentativas concluídas no total', m.attempts],
    ['Provas disponíveis', m.available],
    ['Provas concluídas', m.completed],
    ['Em andamento', m.inProgress],
    ['Não iniciadas', m.notStarted],
    ['Última atividade', dateTime(m.lastActivityAt)],
  ];
  return (
    <dl className="metrics-grid">
      {values.map(([label, value]) => (
        <div
          className={`metric ${['Último resultado', 'Melhor resultado', 'Tentativas concluídas no total'].includes(label) ? 'metric-featured' : 'metric-secondary'}`}
          key={label}
        >
          <dt>{label}</dt>
          <dd>{unavailable && label !== 'Provas disponíveis' ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  );
}
