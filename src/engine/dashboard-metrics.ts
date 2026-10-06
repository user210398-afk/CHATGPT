import type { CatalogExam, ExamProgressSummary } from './catalog-progress';
import { subjectGroupDefinition } from './subject-groups';

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

function meanOfBests(items: DashboardItem[]) {
  const scored = items.flatMap(({ progress }) =>
    progress.bestResultPercentage === null ? [] : [progress.bestResultPercentage],
  );
  return scored.length
    ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length)
    : null;
}

export function aggregateSubjects(items: DashboardItem[]) {
  const groups = new Map<string, DashboardItem[]>();
  for (const item of items) {
    const group = groups.get(item.exam.subject) ?? [];
    group.push(item);
    groups.set(item.exam.subject, group);
  }
  return [...groups]
    .map(([subject, group], index) => ({
      subject,
      index,
      ...aggregateGlobalMetrics(group),
      meanOfBests: meanOfBests(group),
    }))
    .sort((a, b) => collator.compare(a.subject, b.subject) || a.index - b.index);
}

export function aggregateSubjectGroups(items: DashboardItem[]) {
  const groups = new Map<
    string,
    {
      definition: ReturnType<typeof subjectGroupDefinition>;
      index: number;
      items: DashboardItem[];
    }
  >();
  for (const item of items) {
    const definition = subjectGroupDefinition(item.exam.subject);
    const existing = groups.get(definition.id);
    if (existing) existing.items.push(item);
    else groups.set(definition.id, { definition, index: groups.size, items: [item] });
  }
  return [...groups.values()]
    .map(({ definition, index, items: group }) => ({
      ...definition,
      subject: definition.title,
      index,
      ...aggregateGlobalMetrics(group),
      meanOfBests: meanOfBests(group),
    }))
    .sort(
      (a, b) =>
        a.order - b.order ||
        collator.compare(a.subject, b.subject) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : a.index - b.index),
    );
}

function rate(part: number, total: number) {
  return total === 0 ? null : Math.round((part / total) * 100);
}

export function advancedStatistics(items: DashboardItem[]) {
  const practiced = items.filter(
    ({ progress }) => progress.status === 'in-progress' || progress.attemptCount > 0,
  ).length;
  const scored = items.flatMap(({ progress }) =>
    progress.bestResultPercentage === null ? [] : [progress.bestResultPercentage],
  );
  const rankedSubjects = aggregateSubjectGroups(items).flatMap((group) =>
    group.meanOfBests === null
      ? []
      : [
          {
            id: group.id,
            subject: group.subject,
            meanOfBests: group.meanOfBests,
          },
        ],
  );
  let strongestSubject = rankedSubjects[0] ?? null;
  let lowestSubject = rankedSubjects[0] ?? null;
  for (const subject of rankedSubjects.slice(1)) {
    if (strongestSubject && subject.meanOfBests > strongestSubject.meanOfBests)
      strongestSubject = subject;
    if (lowestSubject && subject.meanOfBests < lowestSubject.meanOfBests)
      lowestSubject = subject;
  }
  return {
    available: items.length,
    practiced,
    practiceCoverage: rate(practiced, items.length),
    scoredExamCount: scored.length,
    meanOfBests: scored.length
      ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length)
      : null,
    strongestSubject,
    lowestSubject,
  };
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
