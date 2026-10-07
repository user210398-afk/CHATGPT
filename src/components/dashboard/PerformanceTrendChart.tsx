import { useRef, useState } from 'react';
import { analyticsIdentity } from '../../engine/analytics-reader';
import type { performanceSeries } from '../../engine/analytics';
import { dateTime, percentage } from './Metrics';
const modeLabel = (mode: 'exam' | 'study') => (mode === 'exam' ? 'Modo Prova' : 'Modo Estudo');
export function PerformanceTrendChart({
  series,
}: {
  series: ReturnType<typeof performanceSeries>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = series.findIndex(({ attempt }) => analyticsIdentity(attempt) === selected);
  const index = selectedIndex >= 0 ? selectedIndex : series.length - 1;
  const chosen = series[index]?.attempt;
  const first = series[0]?.attempt.completedAt,
    last = series.at(-1)?.attempt.completedAt;
  const start = first ? Date.parse(first) : 0,
    end = last ? Date.parse(last) : 0;
  const x = (date: string) =>
    end === start ? 50 : ((Date.parse(date) - start) / (end - start)) * 100;
  const path = (trend: boolean) =>
    series
      .flatMap((point) => {
        const value = trend ? point.movingAverage : point.attempt.percentage;
        return value === null
          ? []
          : [`${x(point.attempt.completedAt) * 10},${(100 - value) * 2.4}`];
      })
      .join(' ');
  const choose = (next: number, focus = false) => {
    const point = series[next];
    if (point) {
      setSelected(analyticsIdentity(point.attempt));
      if (focus) buttons.current[next]?.focus();
    }
  };
  return (
    <section className="analytics-trend" aria-labelledby="performance-trend-title">
      <div className="analytics-chart-heading">
        <div>
          <h3 id="performance-trend-title">Evolução do desempenho</h3>
          <p className="muted small">
            Cada ponto é um resultado oficial. Eixo temporal real · escala de 0 a 100%.
          </p>
        </div>
        <div className="chart-legend">
          <span className="legend-line">Resultados</span>
          <span className="legend-line trend">Média móvel de 3</span>
        </div>
      </div>
      {!chosen ? (
        <p className="analytics-empty">Nenhum resultado com nota automática neste recorte.</p>
      ) : (
        <>
          <div
            className="performance-chart"
            role="group"
            aria-label="Gráfico de evolução; use as setas para percorrer os resultados"
          >
            <div className="chart-y-labels" aria-hidden="true">
              {[100, 75, 50, 25, 0].map((value) => (
                <span key={value} style={{ top: `${100 - value}%` }}>
                  {value}%
                </span>
              ))}
            </div>
            <div className="performance-plot">
              <svg
                viewBox="0 0 1000 240"
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                {[0, 60, 120, 180, 240].map((y) => (
                  <line className="chart-gridline" x1="0" x2="1000" y1={y} y2={y} key={y} />
                ))}
                <polyline className="performance-line" points={path(false)} />
                {series.length >= 3 && (
                  <polyline className="performance-line moving-average" points={path(true)} />
                )}
              </svg>
              {series.length === 3 && series[2]!.movingAverage !== null && (
                <span
                  className="moving-average-marker"
                  aria-hidden="true"
                  style={{
                    left: `${x(series[2]!.attempt.completedAt)}%`,
                    top: `${100 - series[2]!.movingAverage!}%`,
                  }}
                />
              )}
              {series.map(({ attempt }, pointIndex) => (
                <button
                  key={analyticsIdentity(attempt)}
                  ref={(node) => {
                    buttons.current[pointIndex] = node;
                  }}
                  className="performance-point"
                  style={{
                    left: `${x(attempt.completedAt)}%`,
                    top: `${100 - attempt.percentage}%`,
                  }}
                  aria-label={`${attempt.examTitle} · ${attempt.subject} · ${percentage(attempt.percentage)} · ${modeLabel(attempt.mode)} · ${dateTime(attempt.completedAt)}`}
                  aria-pressed={pointIndex === index}
                  tabIndex={pointIndex === index ? 0 : -1}
                  onMouseEnter={() => choose(pointIndex)}
                  onFocus={() => choose(pointIndex)}
                  onClick={() => choose(pointIndex)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === 'ArrowLeft'
                        ? Math.max(0, pointIndex - 1)
                        : event.key === 'ArrowRight'
                          ? Math.min(series.length - 1, pointIndex + 1)
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? series.length - 1
                              : null;
                    if (next !== null) {
                      event.preventDefault();
                      choose(next, true);
                    }
                  }}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          <div className="chart-x-labels" aria-hidden="true">
            <span>{dateTime(first!)}</span>
            {start !== end && <span>{dateTime(last!)}</span>}
          </div>
          <div className="chart-selection" role="status" aria-live="polite" aria-atomic="true">
            <strong>{chosen.examTitle}</strong>
            <span>
              {chosen.subject} · {percentage(chosen.percentage)} · {modeLabel(chosen.mode)}
            </span>
            <time dateTime={chosen.completedAt}>{dateTime(chosen.completedAt)}</time>
          </div>
          <div className="chart-navigation">
            <button
              disabled={index === 0}
              onClick={() => choose(index - 1)}
              aria-label="Resultado anterior"
            >
              ← Anterior
            </button>
            <div className="chart-result-select">
              <label className="field-label" htmlFor="analytics-result">
                Resultado selecionado
              </label>
              <select
                id="analytics-result"
                value={index}
                onChange={(event) => choose(Number(event.target.value))}
              >
                {series.map(({ attempt }, i) => (
                  <option value={i} key={analyticsIdentity(attempt)}>
                    {i + 1} · {attempt.examTitle} · {percentage(attempt.percentage)} ·{' '}
                    {modeLabel(attempt.mode)} · {dateTime(attempt.completedAt)}
                  </option>
                ))}
              </select>
            </div>
            <button
              disabled={index === series.length - 1}
              onClick={() => choose(index + 1)}
              aria-label="Próximo resultado"
            >
              Próximo →
            </button>
          </div>
          <p className="muted small">
            A média móvel é uma leitura visual, não uma nota. Resultados no mesmo instante não
            indicam uma ordem temporal real.
          </p>
          <details className="chart-data">
            <summary>Ver dados do gráfico</summary>
            <div className="chart-table-wrap">
              <table>
                <caption>
                  Resultados pontuados em ordem de conclusão; empates usam identidade.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Prova / disciplina</th>
                    <th scope="col">Resultado</th>
                    <th scope="col">Modo</th>
                    <th scope="col">Conclusão</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map(({ attempt }) => (
                    <tr key={analyticsIdentity(attempt)}>
                      <th scope="row">
                        {attempt.examTitle}
                        <br />
                        <span className="muted">{attempt.subject}</span>
                      </th>
                      <td>{percentage(attempt.percentage)}</td>
                      <td>{modeLabel(attempt.mode)}</td>
                      <td>
                        <time dateTime={attempt.completedAt}>{dateTime(attempt.completedAt)}</time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
