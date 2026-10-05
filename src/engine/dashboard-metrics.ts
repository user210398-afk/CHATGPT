import type { CatalogExam, ExamProgressSummary } from './catalog-progress';
const collator = new Intl.Collator('pt-BR');
export type DashboardItem = { exam: CatalogExam; progress: ExamProgressSummary };
export function aggregateGlobalMetrics(items: DashboardItem[]) {
  const metrics = {
    available: items.length,
    completed: 0,
    inProgress: 0,
    notStarted: 0,
    attempts: 0,
    best: null as number | null,
    last: null as number | null,
    lastResultAt: null as string | null,
    lastActivityAt: null as string | null,
  };
  for (const { progress: p } of items) {
    if (p.status === 'completed') metrics.completed++;
    else if (p.status === 'in-progress') metrics.inProgress++;
    else metrics.notStarted++;
    metrics.attempts += p.attemptCount;
    if (p.bestResultPercentage !== null)
      metrics.best =
        metrics.best === null
          ? p.bestResultPercentage
          : Math.max(metrics.best, p.bestResultPercentage);
    // Strict > keeps the catalog order as the explicit tiebreaker.
    if (
      p.lastResultAt &&
      p.lastResultPercentage !== null &&
      (!metrics.lastResultAt || Date.parse(p.lastResultAt) > Date.parse(metrics.lastResultAt))
    ) {
      metrics.lastResultAt = p.lastResultAt;
      metrics.last = p.lastResultPercentage;
    }
    if (
      p.lastActivityAt &&
      (!metrics.lastActivityAt || Date.parse(p.lastActivityAt) > Date.parse(metrics.lastActivityAt))
    )
      metrics.lastActivityAt = p.lastActivityAt;
  }
  return metrics;
}
export function aggregateSubjects(items: DashboardItem[]) {
  const groups = new Map<string, DashboardItem[]>();
  for (const item of items) {
    const group = groups.get(item.exam.subject) ?? [];
    group.push(item);
    groups.set(item.exam.subject, group);
  }
  return [...groups]
    .map(([subject, group], index) => {
      const scored = group.flatMap(({ progress }) =>
        progress.bestResultPercentage === null ? [] : [progress.bestResultPercentage],
      );
      return {
        subject,
        index,
        ...aggregateGlobalMetrics(group),
        meanOfBests: scored.length
          ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length)
          : null,
      };
    })
    .sort((a, b) => collator.compare(a.subject, b.subject) || a.index - b.index);
}
export function recentActivity(items: DashboardItem[], limit = 6) {
  return items
    .map((item, index) => ({ ...item, index }))
    .filter(({ progress }) => progress.lastActivityAt !== null)
    .sort(
      (a, b) =>
        Date.parse(b.progress.lastActivityAt!) - Date.parse(a.progress.lastActivityAt!) ||
        a.index - b.index,
    )
    .slice(0, limit);
}
