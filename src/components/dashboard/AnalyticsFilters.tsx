import type { AnalyticsFilters as Filters } from '../../engine/analytics';
import { defaultAnalyticsFilters } from '../../engine/analytics';
export function AnalyticsFilters({
  filters,
  subjects,
  onChange,
}: {
  filters: Filters;
  subjects: string[];
  onChange: (filters: Filters) => void;
}) {
  const active = filters.period !== 'all' || filters.mode !== 'all' || Boolean(filters.subject);
  return (
    <div className="analytics-filters">
      <fieldset>
        <legend>Período</legend>
        <div className="filter-chips">
          {(['all', 90, 30, 7] as const).map((period) => (
            <button
              key={period}
              aria-pressed={filters.period === period}
              onClick={() => onChange({ ...filters, period })}
            >
              {period === 'all' ? 'Todo período' : `Últimos ${period} dias`}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Modo</legend>
        <div className="filter-chips">
          {(['all', 'exam', 'study'] as const).map((mode) => (
            <button
              key={mode}
              aria-pressed={filters.mode === mode}
              onClick={() => onChange({ ...filters, mode })}
            >
              {mode === 'all' ? 'Todos' : mode === 'exam' ? 'Prova' : 'Estudo'}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="analytics-subject-filter">
        <label className="field-label" htmlFor="analytics-subject">
          Disciplina
        </label>
        <select
          id="analytics-subject"
          value={filters.subject}
          onChange={(event) => onChange({ ...filters, subject: event.target.value })}
        >
          <option value="">Todas</option>
          {subjects.map((subject) => (
            <option key={subject}>{subject}</option>
          ))}
        </select>
      </div>
      {active && (
        <button
          className="clear-analytics-filters"
          onClick={() => onChange({ ...defaultAnalyticsFilters })}
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
