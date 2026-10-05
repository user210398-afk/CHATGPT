import { useEffect, useMemo, useState } from 'react';
import type { Catalog } from '../../schema/catalog';
import { readExamProgress } from '../engine/catalog-progress';
import { CatalogPreferencesRepository } from '../engine/catalog-preferences';
import {
  defaultCatalogFilters,
  hasCatalogFilters,
  selectCatalogItems,
  type CatalogFiltersState,
} from '../engine/catalog-query';
const preferencesRepository = new CatalogPreferencesRepository();
function readCatalog(catalog: Catalog) {
  const progress = catalog.exams.map((exam) => ({ exam, ...readExamProgress(exam) }));
  return { progress, ...preferencesRepository.load() };
}
export function useCatalogState(catalog: Catalog) {
  const [snapshot, setSnapshot] = useState(() => readCatalog(catalog));
  const [filters, setFilters] = useState<CatalogFiltersState>({ ...defaultCatalogFilters });
  useEffect(() => {
    // Normal links remount the catalog. Also refresh when the browser restores it from bfcache.
    const refresh = () => setSnapshot(readCatalog(catalog));
    window.addEventListener('pageshow', refresh);
    return () => window.removeEventListener('pageshow', refresh);
  }, [catalog]);
  const items = useMemo(() => {
    const favorites = new Set(snapshot.preferences.favorites);
    return selectCatalogItems(
      snapshot.progress.map(({ exam, progress }) => ({
        exam,
        progress,
        favorite: favorites.has(exam.id),
      })),
      filters,
    );
  }, [snapshot, filters]);
  function toggleFavorite(id: string) {
    const saved = preferencesRepository.setFavorite(
      id,
      !snapshot.preferences.favorites.includes(id),
    );
    setSnapshot((previous) => ({ ...previous, ...saved }));
  }
  return {
    items,
    filters,
    setFilters,
    toggleFavorite,
    clearFilters: () => setFilters({ ...defaultCatalogFilters }),
    active: hasCatalogFilters(filters),
    warning:
      snapshot.warning ??
      (snapshot.progress.some((item) => item.unavailable)
        ? 'O progresso local está indisponível neste navegador. Você pode continuar abrindo as provas.'
        : null),
  };
}
