import { describe, expect, it, vi } from 'vitest';
import {
  catalogFilterOptions,
  defaultCatalogFilters,
  examType,
  hasCatalogFilters,
  selectCatalogItems,
  type CatalogFiltersState,
  type CatalogItem,
} from '../src/engine/catalog-query';
import { readExamProgress } from '../src/engine/catalog-progress';
import { testCatalog } from './catalog-fixtures';
const items: CatalogItem[] = testCatalog.exams.map((exam, i) => ({
  exam,
  favorite: i === 1,
  progress: {
    ...readExamProgress(exam).progress,
    status: i === 0 ? 'in-progress' : i === 1 ? 'completed' : 'not-started',
    bestResultPercentage: i === 0 ? 20 : i === 1 ? 80 : null,
    lastActivityAt:
      i === 0 ? '2026-10-01T10:00:00.000Z' : i === 1 ? '2026-10-02T10:00:00.000Z' : null,
  },
}));
const select = (patch: Partial<CatalogFiltersState> = {}, source = items) =>
  selectCatalogItems(source, { ...defaultCatalogFilters, ...patch });
const ids = (selected: CatalogItem[]) => selected.map((item) => item.exam.id);
describe('busca, filtros e ordenação pura', () => {
  it.each(['algebra', 'ÁLGEBRA', '  algebra  '])('busca tolerante a acentos %s', (query) => {
    expect(ids(select({ query }))).toEqual(['card-objective']);
  });
  it.each(['Farmacologia', '2025'])('busca disciplina/ano %s', (query) => {
    expect(ids(select({ query }))).toEqual(['card-objective']);
  });
  it('busca tags e divisão', () => {
    const source = [
      {
        ...items[0]!,
        exam: { ...items[0]!.exam, division: 'Módulo especial', tags: ['Hipófise'] },
      },
    ];
    expect(select({ query: 'hipofise' }, source)).toHaveLength(1);
    expect(select({ query: 'modulo especial' }, source)).toHaveLength(1);
  });
  it('filtra disciplina, ano numérico, ano desconhecido, status e favoritos', () => {
    expect(ids(select({ subject: 'Farmacologia' }))).toEqual(['card-objective']);
    expect(ids(select({ year: '2025' }))).toEqual(['card-objective']);
    expect(ids(select({ year: 'unknown' }))).toEqual(['card-essay']);
    expect(ids(select({ status: 'in-progress' }))).toEqual([items[0]!.exam.id]);
    expect(ids(select({ favorites: 'favorites' }))).toEqual(['card-objective']);
  });
  it.each(['objective-only', 'mixed', 'essay-only'] as const)('deriva e filtra tipo %s', (type) => {
    const selected = select({ type });
    expect(selected).toHaveLength(1);
    expect(examType(selected[0]!.exam)).toBe(type);
  });
  it('combina TODOS os filtros com AND', () => {
    const filters: Partial<CatalogFiltersState> = {
      query: 'algebra',
      subject: 'Farmacologia',
      year: '2025',
      status: 'completed',
      favorites: 'favorites',
      type: 'objective-only',
    };
    expect(ids(select(filters))).toEqual(['card-objective']);
    expect(select({ ...filters, status: 'in-progress' })).toEqual([]);
  });
  it('estado padrão/limpar restaura busca, todos os filtros e ordenação', () => {
    expect(hasCatalogFilters(defaultCatalogFilters)).toBe(false);
    for (const patch of [
      { query: 'x' },
      { subject: 'x' },
      { year: 'unknown' },
      { status: 'completed' },
      { favorites: 'favorites' },
      { type: 'mixed' },
      { sort: 'title' },
    ] as Partial<CatalogFiltersState>[]) {
      expect(hasCatalogFilters({ ...defaultCatalogFilters, ...patch })).toBe(true);
    }
    expect(ids(select({ ...defaultCatalogFilters }))).toEqual(ids(items));
  });
  it('opções únicas pt-BR, anos decrescentes e ano não informado são derivados', () => {
    expect(catalogFilterOptions([...testCatalog.exams, testCatalog.exams[0]!])).toEqual({
      subjects: ['Farmacologia', 'Fisiologia'],
      years: [2026, 2025],
      hasUnknownYear: true,
    });
  });
  it('ordem default é idêntica ao catálogo e não muta array original', () => {
    const original = structuredClone(items);
    expect(ids(select())).toEqual(ids(items));
    for (const sort of ['title', 'year', 'recent', 'best', 'lowest'] as const) select({ sort });
    expect(items).toEqual(original);
  });
  it('A–Z usa pt-BR', () => {
    expect(ids(select({ sort: 'title' }))).toEqual([
      'card-objective',
      items[0]!.exam.id,
      'card-essay',
    ]);
  });
  it('ano mais recente coloca null ao final', () => {
    expect(ids(select({ sort: 'year' }))).toEqual([
      items[0]!.exam.id,
      'card-objective',
      'card-essay',
    ]);
  });
  it.each(['recent', 'best'] as const)('%s decrescente com null ao final', (sort) => {
    expect(ids(select({ sort }))).toEqual(['card-objective', items[0]!.exam.id, 'card-essay']);
  });
  it('menor desempenho ordena best crescente com null ao final', () => {
    expect(ids(select({ sort: 'lowest' }))).toEqual([
      items[0]!.exam.id,
      'card-objective',
      'card-essay',
    ]);
  });
  it.each(['title', 'year', 'recent', 'best', 'lowest'] as const)(
    'empates em %s mantêm ordem do catálogo',
    (sort) => {
      const ties = items.map((item) => ({
        ...item,
        exam: { ...item.exam, title: 'Mesmo', year: 2026 },
        progress: { ...item.progress, lastActivityAt: null, bestResultPercentage: 20 },
      }));
      expect(ids(select({ sort }, ties))).toEqual(ids(ties));
    },
  );
  it.each(['title', 'year', 'recent', 'best', 'lowest'] as const)(
    'desempate explícito em %s preserva C, A, B mesmo com sort instável',
    (sort) => {
      const source = ['C', 'A', 'B'].map((id, index) => ({
        ...items[index]!,
        exam: { ...items[index]!.exam, id, title: index === 1 ? 'A\u0301' : 'Á', year: 2026 },
        progress: {
          ...items[index]!.progress,
          lastActivityAt: '2026-10-03T10:00:00.000Z',
          bestResultPercentage: 20,
        },
      }));
      expect(new Intl.Collator('pt-BR').compare(source[0]!.exam.title, source[1]!.exam.title)).toBe(
        0,
      );
      const before = structuredClone(source);
      const nativeSort = Array.prototype.sort;
      // Simulate an unstable runtime: ties reverse their original relative order.
      const unstableSort = vi.spyOn(Array.prototype, 'sort').mockImplementation(function (
        this: unknown[],
        compare?: (a: unknown, b: unknown) => number,
      ) {
        const originalIndex = new Map(this.map((value, index) => [value, index]));
        return nativeSort.call(
          this,
          (a, b) => (compare?.(a, b) ?? 0) || originalIndex.get(b)! - originalIndex.get(a)!,
        );
      });
      let selected: CatalogItem[];
      try {
        selected = select({ sort }, source);
      } finally {
        unstableSort.mockRestore();
      }
      expect(ids(selected)).toEqual(['C', 'A', 'B']);
      expect(source).toEqual(before);
      expect(selected[0]).toBe(source[0]);
    },
  );
  it('default preserva ordem e referências dos itens sem executar sort', () => {
    const source = [items[2]!, items[0]!, items[1]!];
    const sort = vi.spyOn(Array.prototype, 'sort');
    const selected = select({}, source);
    const calls = sort.mock.calls.length;
    sort.mockRestore();
    expect(calls).toBe(0);
    expect(selected).toEqual(source);
    selected.forEach((item, index) => expect(item).toBe(source[index]));
  });
  it('menor desempenho mantém 0% antes de null sem mutar a entrada', () => {
    const source = [null, 50, 0].map((percentage, index) => ({
      ...items[index]!,
      progress: { ...items[index]!.progress, bestResultPercentage: percentage },
    }));
    const before = structuredClone(source);
    expect(
      select({ sort: 'lowest' }, source).map((item) => item.progress.bestResultPercentage),
    ).toEqual([0, 50, null]);
    expect(source).toEqual(before);
  });
});
