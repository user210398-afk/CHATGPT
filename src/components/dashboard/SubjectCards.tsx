import type { aggregateSubjectGroups } from '../../engine/dashboard-metrics';
import { percentage } from './Metrics';
export function SubjectCards({
  subjects,
}: {
  subjects: ReturnType<typeof aggregateSubjectGroups>;
}) {
  return (
    <section aria-labelledby="subjects-title">
      <h2 id="subjects-title">Desempenho por disciplina</h2>
      <p className="muted small">
        As disciplinas equivalentes seguem os mesmos grupos do Hub de Matérias. Média dos melhores:
        média arredondada do melhor resultado de cada prova com nota automática.
      </p>
      <div className="catalog-grid">
        {subjects.map((s) => (
          <article className="card" key={s.subject}>
            <h3>{s.subject}</h3>
            <p>{s.available} provas</p>
            <p>
              {s.completed} concluídas · {s.inProgress} em andamento · {s.notStarted} não iniciadas
            </p>
            <dl className="subject-metrics">
              <div>
                <dt>Melhor</dt>
                <dd>{percentage(s.best)}</dd>
              </div>
              <div>
                <dt>Último</dt>
                <dd>{percentage(s.last)}</dd>
              </div>
              <div>
                <dt>Média dos melhores</dt>
                <dd>{percentage(s.meanOfBests)}</dd>
              </div>
            </dl>
            <p className="muted small">{s.attempts} tentativas concluídas</p>
          </article>
        ))}
      </div>
    </section>
  );
}
