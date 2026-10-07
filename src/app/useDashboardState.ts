import { useEffect, useMemo, useState } from 'react';
import type { Catalog } from '../../schema/catalog';
import { readExamProgress } from '../engine/catalog-progress';
import { readAnalytics } from '../engine/analytics-reader';
import { storageKey, historyStorageKey } from '../engine/persistence';
import {
  aggregateGlobalMetrics,
  aggregateSubjects,
  recentActivity,
} from '../engine/dashboard-metrics';
function read(catalog: Catalog) {
  return {
    progress: catalog.exams.map((exam) => ({ exam, ...readExamProgress(exam) })),
    analytics: readAnalytics(catalog),
    now: Date.now(),
  };
}
export function useDashboardState(catalog: Catalog) {
  const [snapshot, setSnapshot] = useState(() => read(catalog));
  useEffect(() => {
    const refresh = () => setSnapshot(read(catalog));
    const officialKeys = new Set(
      catalog.exams.flatMap((exam) => [storageKey(exam), historyStorageKey(exam)]),
    );
    const onStorage = (event: StorageEvent) => {
      // Session scratch and personal domains cannot invalidate official analytics.
      if (event.storageArea) {
        try {
          if (event.storageArea !== window.localStorage) return;
        } catch {
          // The refresh reader reports unavailable storage without throwing.
        }
      }
      if (event.key === null || officialKeys.has(event.key)) refresh();
    };
    window.addEventListener('pageshow', refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [catalog]);
  return useMemo(
    () => ({
      refresh: () => setSnapshot(read(catalog)),
      analytics: snapshot.analytics,
      now: snapshot.now,
      metrics: aggregateGlobalMetrics(snapshot.progress),
      subjects: aggregateSubjects(snapshot.progress),
      recent: recentActivity(snapshot.progress),
      unavailable: snapshot.progress.some((item) => item.unavailable),
      includesStudy: snapshot.progress.some((item) => item.includesStudy),
      includesExam: snapshot.progress.some((item) => item.includesExam),
    }),
    [snapshot, catalog],
  );
}
