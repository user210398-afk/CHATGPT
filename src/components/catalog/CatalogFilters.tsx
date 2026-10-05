import { useMemo } from 'react';
import type { Catalog } from '../../../schema/catalog';
import { catalogFilterOptions, type CatalogFiltersState } from '../../engine/catalog-query';
export function CatalogFilters({
  catalog,
  filters,
  onChange,
  active,
  onClear,
  showSubject = true,
}: {
  catalog: Catalog;
  filters: CatalogFiltersState;
  onChange: (filters: CatalogFiltersState) => void;
  active: boolean;
  onClear: () => void;
  showSubject?: boolean;
}) {
  const options = useMemo(() => catalogFilterOptions(catalog.exams), [catalog]);
  const selects: {
    key: Exclude<keyof CatalogFiltersState, 'query'>;
    label: string;
    options: [string, string][];
  }[] = [
    {
      key: 'subject',
      label: 'Disciplina',
      options: [
        ['all', 'Todas as disciplinas'],
        ...options.subjects.map((subject): [string, string] => [subject, subject]),
      ],
    },
    {
      key: 'year',
      label: 'Ano',
      options: [
        ['all', 'Todos os anos'],
        ...options.years.map((year): [string, string] => [String(year), String(year)]),
        ...(options.hasUnknownYear ? [['unknown', 'Ano não informado'] as [string, string]] : []),
      ],
    },
    {
      key: 'status',
      label: 'Status',
      options: [
        ['all', 'Todas'],
        ['not-started', 'Não iniciadas'],
        ['in-progress', 'Em andamento'],
        ['completed', 'Concluídas'],
      ],
    },
    {
      key: 'favorites',
      label: 'Favoritos',
      options: [
        ['all', 'Todos'],
        ['favorites', 'Somente favoritos'],
      ],
    },
    {
      key: 'type',
      label: 'Tipo',
      options: [
        ['all', 'Todas'],
        ['objective-only', 'Somente objetivas'],
        ['mixed', 'Mistas'],
        ['essay-only', 'Somente dissertativas'],
      ],
    },
    {
      key: 'sort',
      label: 'Ordenação',
      options: [
        ['default', 'Padrão'],
        ['title', 'A–Z'],
        ['year', 'Ano: mais recente'],
        ['recent', 'Atividade recente'],
        ['best', 'Melhor desempenho'],
        ['lowest', 'Menor desempenho'],
      ],
    },
  ];
  return (
    <div className="catalog-filters">
      <div className="catalog-search">
        <label htmlFor="search">Buscar por tema, disciplina ou ano</label>
        <input
          id="search"
          type="search"
          placeholder="Ex.: fisiologia, hipófise…"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
        />
      </div>
      {selects
        .filter(({ key }) => showSubject || key !== 'subject')
        .map(({ key, label, options }) => (
          <div key={key}>
            <label htmlFor={`catalog-${key}`}>{label}</label>
            <select
              id={`catalog-${key}`}
              value={filters[key]}
              onChange={(event) => onChange({ ...filters, [key]: event.target.value })}
            >
              {options.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>
        ))}
      {active && (
        <button className="catalog-clear" onClick={onClear}>
          Limpar filtros
        </button>
      )}
    </div>
  );
}
