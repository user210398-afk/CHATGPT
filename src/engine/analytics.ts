import {
  compareAnalyticsAttempts,
  compareCodeUnits,
  type AnalyticsAttempt,
} from './analytics-reader';

export type AnalyticsFilters = {
  period: 'all' | 7 | 30 | 90;
  subject: string;
  mode: 'all' | 'exam' | 'study';
};
export const defaultAnalyticsFilters: AnalyticsFilters = {
  period: 'all',
  subject: '',
  mode: 'all',
};
export const DAY = 86_400_000;
export type ScoredAttempt = AnalyticsAttempt & { percentage: number };
export const isScored = (attempt: AnalyticsAttempt): attempt is ScoredAttempt =>
  attempt.percentage !== null;
export const mean = (values: number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export function filterAnalytics(
  attempts: AnalyticsAttempt[],
  filters: AnalyticsFilters,
  now: number,
) {
  return attempts
    .filter(
      (attempt) =>
        (!filters.subject || attempt.subject === filters.subject) &&
        (filters.mode === 'all' || attempt.mode === filters.mode) &&
        (filters.period === 'all' ||
          (Date.parse(attempt.completedAt) >= now - filters.period * DAY &&
            Date.parse(attempt.completedAt) <= now)),
    )
    .sort(compareAnalyticsAttempts);
}
export function performanceSeries(attempts: AnalyticsAttempt[]) {
  const scored = attempts.filter(isScored).sort(compareAnalyticsAttempts);
  return scored.map((attempt, index) => ({
    attempt,
    movingAverage:
      index < 2 ? null : mean(scored.slice(index - 2, index + 1).map((item) => item.percentage)),
  }));
}
export type SubjectStatistic = {
  subject: string;
  count: number;
  scoredCount: number;
  average: number | null;
};
export function subjectStatistics(attempts: AnalyticsAttempt[]): SubjectStatistic[] {
  const groups = new Map<string, { count: number; sum: number; scoredCount: number }>();
  for (const attempt of attempts) {
    const group = groups.get(attempt.subject) ?? { count: 0, sum: 0, scoredCount: 0 };
    group.count++;
    if (isScored(attempt)) {
      group.scoredCount++;
      group.sum += attempt.percentage;
    }
    groups.set(attempt.subject, group);
  }
  return [...groups]
    .map(([subject, group]) => ({
      subject,
      count: group.count,
      scoredCount: group.scoredCount,
      average: group.scoredCount ? group.sum / group.scoredCount : null,
    }))
    .sort((a, b) => compareCodeUnits(a.subject, b.subject));
}
export type ActivityBucket = {
  start: number;
  end: number;
  label: string;
  exam: number;
  study: number;
};
const dayLabel = (date: number) =>
  new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
export function activityBuckets(
  attempts: AnalyticsAttempt[],
  period: AnalyticsFilters['period'],
  now: number,
): ActivityBucket[] {
  if (period === 'all') {
    const buckets = new Map<number, ActivityBucket>();
    for (const attempt of attempts) {
      const date = new Date(attempt.completedAt),
        start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
      const bucket = buckets.get(start) ?? {
        start,
        end: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
        label: new Date(start).toLocaleDateString('pt-BR', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        exam: 0,
        study: 0,
      };
      bucket[attempt.mode]++;
      buckets.set(start, bucket);
    }
    return [...buckets.values()].sort((a, b) => a.start - b.start);
  }
  const start = now - period * DAY,
    size = (period === 7 ? 1 : 7) * DAY;
  const buckets: ActivityBucket[] = [];
  for (let date = start; date < now; date += size) {
    const end = Math.min(now, date + size);
    buckets.push({
      start: date,
      end,
      label: period === 7 ? dayLabel(date) : `${dayLabel(date)}–${dayLabel(end)}`,
      exam: 0,
      study: 0,
    });
  }
  for (const attempt of attempts) {
    const date = Date.parse(attempt.completedAt);
    if (date < start || date > now) continue;
    const index = Math.min(buckets.length - 1, Math.floor((date - start) / size));
    buckets[index]![attempt.mode]++;
  }
  return buckets;
}
export type PerformanceInsight = {
  kind: 'neutral' | 'positive' | 'attention';
  title: string;
  description: string;
};
const displayMean = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
export function performanceInsights(attempts: AnalyticsAttempt[]): PerformanceInsight[] {
  const scored = attempts.filter(isScored).sort(compareAnalyticsAttempts);
  const insights: PerformanceInsight[] = [];
  if (scored.length < 6)
    insights.push({
      kind: 'neutral',
      title: 'Dados insuficientes para avaliar tendência',
      description: `${scored.length} resultados pontuados neste recorte. São necessários pelo menos 6 para comparar dois grupos de 3.`,
    });
  else {
    const recentTotal = scored.slice(-3).reduce((sum, item) => sum + item.percentage, 0);
    const previousTotal = scored.slice(-6, -3).reduce((sum, item) => sum + item.percentage, 0);
    const recent = recentTotal / 3;
    const previous = previousTotal / 3;
    // Subtract totals before dividing: exact ±8 thresholds must survive thirds.
    const delta = (recentTotal - previousTotal) / 3;
    insights.push({
      kind: delta >= 8 ? 'positive' : delta <= -8 ? 'attention' : 'neutral',
      title:
        delta >= 8
          ? 'Tendência positiva'
          : delta <= -8
            ? 'Ponto de atenção na tendência'
            : 'Desempenho recente estável',
      description: `Os 3 resultados mais recentes têm média de ${displayMean(recent)}%, frente a ${displayMean(previous)}% nos 3 anteriores (${delta >= 0 ? '+' : ''}${displayMean(delta)} pontos percentuais). Comparação descritiva entre grupos recentes, sem previsão futura.`,
    });
  }
  const eligible = subjectStatistics(attempts).filter((item) => item.scoredCount >= 3);
  const average = mean(scored.map((item) => item.percentage));
  const strongest = [...eligible].sort(
    (a, b) => b.average! - a.average! || compareCodeUnits(a.subject, b.subject),
  );
  if (strongest.length >= 2) {
    const item = strongest[0]!;
    insights.push({
      kind: 'positive',
      title: 'Maior média no período',
      description: `${item.subject}: ${displayMean(item.average!)}%. Amostra de ${item.scoredCount} tentativas. Comparação entre disciplinas com ao menos 3 resultados pontuados.`,
    });
  }
  const attention = eligible
    .filter((item) => item.average! < 70 || (average !== null && average - item.average! >= 8))
    .sort((a, b) => a.average! - b.average! || compareCodeUnits(a.subject, b.subject))[0];
  insights.push(
    attention
      ? {
          kind: 'attention',
          title: 'Ponto de atenção por disciplina',
          description: `${attention.subject}: ${displayMean(attention.average!)}%. Amostra de ${attention.scoredCount} tentativas. Média abaixo de 70% ou ao menos 8 pontos percentuais abaixo da média filtrada.`,
        }
      : {
          kind: 'neutral',
          title: 'Sem um ponto de atenção claro neste recorte.',
          description: eligible.length
            ? 'As disciplinas elegíveis não atingiram os critérios de atenção.'
            : 'Cada disciplina precisa de pelo menos 3 resultados pontuados para esta leitura.',
        },
  );
  return insights;
}
export function analyzePerformance(
  attempts: AnalyticsAttempt[],
  filters: AnalyticsFilters,
  now: number,
) {
  const filtered = filterAnalytics(attempts, filters, now);
  return {
    attempts: filtered,
    average: mean(filtered.filter(isScored).map((item) => item.percentage)),
    scoredCount: filtered.filter(isScored).length,
    series: performanceSeries(filtered),
    subjects: subjectStatistics(filtered),
    buckets: activityBuckets(filtered, filters.period, now),
    insights: performanceInsights(filtered),
  };
}
