import type { recentActivity } from '../../engine/dashboard-metrics';
import { examUrl } from '../../utils/paths';
import { dateTime, percentage } from './Metrics';
const status = {
  'not-started': 'Não iniciada',
  'in-progress': 'Em andamento',
  completed: 'Concluída',
};
export function RecentActivity({ items }: { items: ReturnType<typeof recentActivity> }) {
  return (
    <section className="card" aria-labelledby="recent-title">
      <h2 id="recent-title">Atividade recente</h2>
      {items.length === 0 ? (
        <p className="muted">Nenhuma atividade salva neste navegador.</p>
      ) : (
        <ul className="recent-list">
          {items.map(({ exam, progress: p }) => (
            <li key={exam.id}>
              <a href={examUrl(exam.id)}>{exam.title}</a>
              <p className="muted small">{exam.subject}</p>
              <p>
                {status[p.status]}
                {p.status === 'completed'
                  ? p.lastResultPercentage === null
                    ? ' · sem nota automática'
                    : ` · ${percentage(p.lastResultPercentage)}`
                  : ''}{' '}
                · <time dateTime={p.lastActivityAt!}>{dateTime(p.lastActivityAt)}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
