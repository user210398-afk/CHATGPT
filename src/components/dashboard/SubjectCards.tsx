import type { aggregateSubjects } from '../../engine/dashboard-metrics';
import { percentage } from './Metrics';
export function SubjectCards({ subjects }: { subjects: ReturnType<typeof aggregateSubjects> }) {
  return (
    <section className="subject-coverage" aria-labelledby="subjects-title">
      <p className="eyebrow">COBERTURA GLOBAL</p>
      <h2 id="subjects-title">Desempenho por disciplina</h2>
      <p className="muted small">
        Média dos melhores: média arredondada do melhor resultado de cada prova com nota automática.
      </p>
      <div className="subject-coverage-list">
        {subjects.map((s) => (
          <article className="subject-coverage-row" key={s.subject}>
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
