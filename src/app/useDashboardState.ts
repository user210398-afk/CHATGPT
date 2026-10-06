import { useEffect, useMemo, useState } from 'react';
import type { Catalog } from '../../schema/catalog';
import { readExamProgress } from '../engine/catalog-progress';
import {
  aggregateGlobalMetrics,
  aggregateSubjects,
  recentActivity,
} from '../engine/dashboard-metrics';
function read(catalog: Catalog) {
  return catalog.exams.map((exam) => ({ exam, ...readExamProgress(exam) }));
}
export function useDashboardState(catalog: Catalog) {
  const [snapshot, setSnapshot] = useState(() => read(catalog));
  useEffect(() => {
    const refresh = () => setSnapshot(read(catalog));
    window.addEventListener('pageshow', refresh);
    return () => window.removeEventListener('pageshow', refresh);
  }, [catalog]);
  return useMemo(
    () => ({
      refresh: () => setSnapshot(read(catalog)),
      metrics: aggregateGlobalMetrics(snapshot),
      subjects: aggregateSubjects(snapshot),
      recent: recentActivity(snapshot),
      unavailable: snapshot.some((item) => item.unavailable),
      includesStudy: snapshot.some((item) => item.includesStudy),
      includesExam: snapshot.some((item) => item.includesExam),
    }),
    [snapshot, catalog],
  );
}
