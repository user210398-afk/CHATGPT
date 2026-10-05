import type { aggregateGlobalMetrics } from '../../engine/dashboard-metrics';
export const percentage = (value: number | null) => (value === null ? '—' : `${value}%`);
export const dateTime = (value: string | null) =>
  value === null ? '—' : new Date(value).toLocaleString('pt-BR');
export function Metrics({ metrics: m }: { metrics: ReturnType<typeof aggregateGlobalMetrics> }) {
  const values: [string, string | number][] = [
    ['Provas disponíveis', m.available],
    ['Provas concluídas', m.completed],
    ['Em andamento', m.inProgress],
    ['Não iniciadas', m.notStarted],
    ['Tentativas concluídas no total', m.attempts],
    ['Melhor resultado', percentage(m.best)],
    ['Último resultado', percentage(m.last)],
    ['Última atividade', dateTime(m.lastActivityAt)],
  ];
  return (
    <dl className="metrics-grid">
      {values.map(([label, value]) => (
        <div className="card metric" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
