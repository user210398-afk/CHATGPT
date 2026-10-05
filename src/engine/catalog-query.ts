import type { CatalogExam, ExamProgressSummary, ExamProgressStatus } from './catalog-progress';
export type ExamType = 'objective-only' | 'mixed' | 'essay-only';
export type CatalogSort = 'default' | 'title' | 'year' | 'recent' | 'best' | 'lowest';
export type CatalogFiltersState = {
  query: string;
  subject: string;
  year: string;
  status: 'all' | ExamProgressStatus;
  favorites: 'all' | 'favorites';
  type: 'all' | ExamType;
  sort: CatalogSort;
};
export const defaultCatalogFilters: CatalogFiltersState = {
  query: '',
  subject: 'all',
  year: 'all',
  status: 'all',
  favorites: 'all',
  type: 'all',
  sort: 'default',
};
export type CatalogItem = { exam: CatalogExam; progress: ExamProgressSummary; favorite: boolean };
const collator = new Intl.Collator('pt-BR');
const normalize = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
export function examType(exam: CatalogExam): ExamType {
  return exam.objectiveCount === 0
    ? 'essay-only'
    : exam.essayCount === 0
      ? 'objective-only'
      : 'mixed';
}
export function hasCatalogFilters(filters: CatalogFiltersState): boolean {
  return (Object.keys(defaultCatalogFilters) as (keyof CatalogFiltersState)[]).some(
    (key) => filters[key] !== defaultCatalogFilters[key],
  );
}
export function catalogFilterOptions(exams: CatalogExam[]) {
  return {
    subjects: [...new Set(exams.map((exam) => exam.subject))].sort(collator.compare),
    years: [...new Set(exams.flatMap((exam) => (exam.year === null ? [] : [exam.year])))].sort(
      (a, b) => b - a,
    ),
    hasUnknownYear: exams.some((exam) => exam.year === null),
  };
}
function compareNumber(a: number | null, b: number | null, ascending = false): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return ascending ? a - b : b - a;
}
export function selectCatalogItems(
  items: CatalogItem[],
  filters: CatalogFiltersState,
): CatalogItem[] {
  const query = normalize(filters.query.trim());
  const filtered = items.filter(
    ({ exam, progress, favorite }) =>
      normalize(
        [exam.title, exam.subject, exam.division, exam.year, ...exam.tags].join(' '),
      ).includes(query) &&
      (filters.subject === 'all' || exam.subject === filters.subject) &&
      (filters.year === 'all' ||
        (filters.year === 'unknown' ? exam.year === null : String(exam.year) === filters.year)) &&
      (filters.status === 'all' || progress.status === filters.status) &&
      (filters.favorites === 'all' || favorite) &&
      (filters.type === 'all' || examType(exam) === filters.type),
  );
  if (filters.sort === 'default') return filtered;
  function compare(a: CatalogItem, b: CatalogItem): number {
    switch (filters.sort) {
      case 'title':
        return collator.compare(a.exam.title, b.exam.title);
      case 'year':
        return compareNumber(a.exam.year, b.exam.year);
      case 'recent':
        return compareNumber(
          a.progress.lastActivityAt ? Date.parse(a.progress.lastActivityAt) : null,
          b.progress.lastActivityAt ? Date.parse(b.progress.lastActivityAt) : null,
        );
      case 'best':
        return compareNumber(a.progress.bestResultPercentage, b.progress.bestResultPercentage);
      case 'lowest':
        return compareNumber(
          a.progress.bestResultPercentage,
          b.progress.bestResultPercentage,
          true,
        );
      default:
        return 0;
    }
  }
  return filtered
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);
}
