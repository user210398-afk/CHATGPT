import type { advancedStatistics } from '../../engine/dashboard-metrics';
import { percentage } from './Metrics';

type Statistics = ReturnType<typeof advancedStatistics>;

function subjectValue(value: Statistics['strongestSubject']) {
  return value === null ? '—' : `${value.subject} · ${percentage(value.meanOfBests)}`;
}

export function AdvancedStatistics({ statistics }: { statistics: Statistics }) {
  const values: [string, string][] = [
    ['Cobertura prática', percentage(statistics.practiceCoverage)],
    ['Média dos melhores', percentage(statistics.meanOfBests)],
    ['Melhor matéria praticada', subjectValue(statistics.strongestSubject)],
    ['Menor média praticada', subjectValue(statistics.lowestSubject)],
  ];
  return (
    <section aria-labelledby="advanced-statistics-title">
      <h2 id="advanced-statistics-title">Visão avançada</h2>
      <p className="muted small">
        Derivada apenas das tentativas oficiais salvas neste navegador. Sessões de revisão não
        entram nestas métricas.
      </p>
      <dl className="metrics-grid">
        {values.map(([label, value]) => (
          <div className="card metric" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">
        Cobertura prática: {statistics.practiced} de {statistics.available} provas com tentativa
        concluída ou em andamento. Média dos melhores: {statistics.scoredExamCount} provas com nota
        automática.
      </p>
    </section>
  );
}
