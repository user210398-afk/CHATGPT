import { describe, expect, it, vi } from 'vitest';
import type { Catalog } from '../schema/catalog';
import type { Attempt, Result } from '../src/engine/exam-state';
import { createAttempt } from '../src/engine/exam-state';
import {
  storageKey,
  historyStorageKey,
  currentEnvelopeSchema,
  summary,
  type HistoryEntry,
} from '../src/engine/persistence';
import { readAnalytics, type AnalyticsAttempt } from '../src/engine/analytics-reader';
import {
  DAY,
  activityBuckets,
  analyzePerformance,
  defaultAnalyticsFilters,
  filterAnalytics,
  performanceInsights,
  performanceSeries,
  subjectStatistics,
} from '../src/engine/analytics';
import { catalogExam, completedAttempt } from './catalog-fixtures';
import { poc } from './fixtures';
const now = Date.parse('2026-10-07T12:00:00.000Z');
const exam = {
  ...catalogExam,
  id: 'analytics-a',
  subject: 'Anatomia',
  objectiveCount: 100,
  essayCount: 0,
  questionCount: 100,
};
const second = { ...exam, id: 'analytics-b', subject: 'Bioquímica' };
const essay = {
  ...exam,
  id: 'analytics-essay',
  subject: 'Ética',
  objectiveCount: 0,
  essayCount: 10,
  questionCount: 10,
};
const catalog: Catalog = { schemaVersion: 1, exams: [exam, second, essay] };
function result(percentage: number | null): Result {
  return percentage === null
    ? {
        objectiveTotal: 0,
        objectiveAnswered: 0,
        correct: 0,
        incorrect: 0,
        unanswered: 0,
        percentage: null,
        essayTotal: 10,
        essayAnswered: 1,
      }
    : {
        objectiveTotal: 100,
        objectiveAnswered: 100,
        correct: percentage,
        incorrect: 100 - percentage,
        unanswered: 0,
        percentage,
        essayTotal: 0,
        essayAnswered: 0,
      };
}
function entry(
  id = 'one',
  score: number | null = 80,
  mode: 'exam' | 'study' = 'exam',
  at = now,
): HistoryEntry {
  return {
    id,
    mode,
    startedAt: new Date(at - 1000).toISOString(),
    completedAt: new Date(at).toISOString(),
    result: result(score),
  };
}
function current(item = entry(), target = exam): Attempt {
  return {
    ...createAttempt(poc, item.startedAt, item.id, item.mode),
    examId: target.id,
    examRevision: target.revision,
    completedAt: item.completedAt,
    result: item.result,
  };
}
function store(values: [string, unknown][]) {
  const raws = new Map(
    values.map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
  );
  const adapter = {
    getItem: vi.fn((key: string) => raws.get(key) ?? null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  const read = () => readAnalytics(catalog, () => adapter);
  return { raws, adapter, read };
}
function attempt(
  id: string,
  score: number | null = 80,
  subject = 'Anatomia',
  at = now,
  mode: 'exam' | 'study' = 'exam',
): AnalyticsAttempt {
  return {
    attemptId: id,
    examId: subject,
    examRevision: 1,
    examTitle: `Prova ${id}`,
    subject,
    completedAt: new Date(at).toISOString(),
    mode,
    percentage: score,
    correct: score ?? 0,
    incorrect: score === null ? 0 : 100 - score,
    unanswered: 0,
    objectiveTotal: score === null ? 0 : 100,
  };
}
function legacy(value: Attempt) {
  const { mode: _mode, confirmedQuestionIds: _confirmed, ...old } = value;
  return old;
}
describe('reader oficial read-only', () => {
  it('zero histórico, fontes estritamente limitadas às chaves atuais e zero writes', () => {
    const fixture = store([]);
    expect(fixture.read()).toEqual({ attempts: [], coverage: 'complete', warnings: [] });
    expect(fixture.adapter.getItem.mock.calls.map(([key]) => key)).toEqual(
      catalog.exams.flatMap((item) => [storageKey(item), historyStorageKey(item)]),
    );
    expect(fixture.adapter.setItem).not.toHaveBeenCalled();
    expect(fixture.adapter.removeItem).not.toHaveBeenCalled();
  });
  it('current concluído real usa Result oficial sem buscar prova ou gabarito', () => {
    const official = completedAttempt();
    const snapshot = readAnalytics({ schemaVersion: 1, exams: [catalogExam] }, () => ({
      getItem: (key) =>
        key === storageKey(poc) ? JSON.stringify({ storageVersion: 3, current: official }) : null,
    }));
    expect(snapshot.attempts[0]?.percentage).toBe(official.result!.percentage);
    expect(snapshot.coverage).toBe('complete');
  });
  it('current em andamento não contribui e não é tratado como corrupção', () => {
    const ongoing = { ...current(), completedAt: null, result: null };
    expect(
      store([[storageKey(exam), { storageVersion: 3, current: ongoing }]]).read(),
    ).toMatchObject({ attempts: [], coverage: 'complete' });
  });
  it.each([2, 3])('history v%i sozinho e misto suporta modos congelados', (version) => {
    const value = entry('one', 80, version === 3 ? 'study' : 'exam');
    const { mode: _mode, ...old } = value;
    const output = store([
      [
        historyStorageKey(exam),
        { storageVersion: version, history: [version === 2 ? old : value] },
      ],
    ]).read();
    expect(output.attempts).toHaveLength(1);
    expect(output.attempts[0]?.mode).toBe(version === 3 ? 'study' : 'exam');
  });
  it('v3 não aceita history sem modo; preserva um sibling válido', () => {
    const { mode: _mode, ...invalid } = entry('invalid');
    expect(
      store([[historyStorageKey(exam), { storageVersion: 3, history: [invalid, entry()] }]]).read(),
    ).toMatchObject({
      coverage: 'partial',
      attempts: [expect.objectContaining({ attemptId: 'one' })],
    });
  });
  it('embedded v1 normaliza apenas em memória e deduplica current e summary', () => {
    const one = current(),
      two = current(entry('two', 90));
    const fixture = store([
      [
        storageKey(exam),
        { storageVersion: 1, current: legacy(one), history: [legacy(one), legacy(two)] },
      ],
      [historyStorageKey(exam), { storageVersion: 3, history: [summary(one)] }],
    ]);
    const before = [...fixture.raws];
    expect(fixture.read()).toMatchObject({
      coverage: 'complete',
      attempts: [
        expect.objectContaining({ attemptId: 'one' }),
        expect.objectContaining({ attemptId: 'two' }),
      ],
    });
    expect([...fixture.raws]).toEqual(before);
    expect(fixture.adapter.setItem).not.toHaveBeenCalled();
  });
  it('current v2 lê contrato legacy sem adicionar modo ao storage', () => {
    const output = store([
      [storageKey(exam), { storageVersion: 2, current: legacy(current()) }],
    ]).read();
    expect(output.attempts[0]?.mode).toBe('exam');
    expect(output.coverage).toBe('complete');
  });
  it('current inválido não oculta embedded v1 válido', () => {
    const fixture = store([
      [storageKey(exam), { storageVersion: 1, current: {}, history: [legacy(current())] }],
    ]);
    expect(fixture.read()).toMatchObject({
      coverage: 'partial',
      attempts: [expect.objectContaining({ attemptId: 'one' })],
    });
  });
  it('conflict same-ID different Result exclui todas as cópias e mantém independentes', () => {
    const output = store([
      [storageKey(exam), { storageVersion: 3, current: current() }],
      [historyStorageKey(exam), { storageVersion: 3, history: [entry('one', 90), entry('safe')] }],
    ]).read();
    expect(output.coverage).toBe('partial');
    expect(output.attempts.map((item) => item.attemptId)).toEqual(['safe']);
    expect(output.warnings.join(' ')).toContain('conflitante');
  });
  it.each(['currentIndex', 'Study confirmation'])(
    'metadado incompatível %s com conteúdo equivalente mantém history válido',
    (metadata) => {
      const item = entry('one', 80, metadata === 'currentIndex' ? 'exam' : 'study');
      const incompatible = {
        ...current(item),
        ...(metadata === 'currentIndex'
          ? { currentIndex: exam.questionCount }
          : { confirmedQuestionIds: ['unanswered'] }),
      };
      const fixture = store([
        [storageKey(exam), { storageVersion: 3, current: incompatible }],
        [historyStorageKey(exam), { storageVersion: 3, history: [item] }],
      ]);
      const before = [...fixture.raws];
      expect(
        currentEnvelopeSchema.safeParse({ storageVersion: 3, current: incompatible }).success,
      ).toBe(true);
      const output = fixture.read();
      expect(output).toMatchObject({
        coverage: 'partial',
        attempts: [expect.objectContaining({ attemptId: 'one', percentage: 80, mode: item.mode })],
      });
      expect(output.warnings.join(' ')).not.toContain('conflitante');
      expect([...fixture.raws]).toEqual(before);
      expect(fixture.adapter.setItem).not.toHaveBeenCalled();
      expect(fixture.adapter.removeItem).not.toHaveBeenCalled();
    },
  );
  it('P2: current v3 schema-válido com índice incompatível e Result 90 conflita com history 80', () => {
    const incompatible = { ...current(entry('one', 90)), currentIndex: exam.questionCount };
    expect(
      currentEnvelopeSchema.safeParse({ storageVersion: 3, current: incompatible }).success,
    ).toBe(true);
    const output = store([
      [storageKey(exam), { storageVersion: 3, current: incompatible }],
      [historyStorageKey(exam), { storageVersion: 3, history: [entry('one', 80), entry('safe')] }],
    ]).read();
    expect(output.coverage).toBe('partial');
    expect(output.attempts.map((item) => item.attemptId)).toEqual(['safe']);
    expect(output.warnings.join(' ')).toContain('conflitante');
  });
  it.each([false, true])(
    'sem representação compatível exclui a identidade (cópia v1: %s)',
    (copy) => {
      const incompatible = { ...current(), currentIndex: exam.questionCount };
      const envelope = copy
        ? { storageVersion: 1, current: legacy(incompatible), history: [legacy(incompatible)] }
        : { storageVersion: 3, current: incompatible };
      const output = store([[storageKey(exam), envelope]]).read();
      expect(output).toMatchObject({ coverage: 'partial', attempts: [] });
      expect(output.warnings.join(' ')).not.toContain('conflitante');
    },
  );
  it.each([80, 90])(
    'ordem das fontes detalhadas não altera fallback/conflito (Result incompatível: %i)',
    (score) => {
      const valid = current(entry('one', 80));
      const incompatible = { ...current(entry('one', score)), currentIndex: exam.questionCount };
      const outputs = [
        [incompatible, valid],
        [valid, incompatible],
      ].map(([first, last]) =>
        store([
          [
            storageKey(exam),
            { storageVersion: 1, current: legacy(first!), history: [legacy(last!)] },
          ],
          [historyStorageKey(exam), { storageVersion: 3, history: [summary(valid)] }],
        ]).read(),
      );
      expect(outputs[0]).toEqual(outputs[1]);
      expect(outputs[0]).toMatchObject({
        coverage: 'partial',
        attempts:
          score === 80 ? [expect.objectContaining({ attemptId: 'one', percentage: 80 })] : [],
      });
      expect(outputs[0]!.warnings.join(' ').includes('conflitante')).toBe(score !== 80);
    },
  );
  it.each([false, true])(
    'respostas divergentes da cópia incompatível são evidência em ambas as ordens (%s)',
    (invalidFirst) => {
      const valid = current();
      const incompatible = {
        ...valid,
        currentIndex: exam.questionCount,
        answers: { q: 'different' },
      };
      const [first, last] = invalidFirst ? [incompatible, valid] : [valid, incompatible];
      const output = store([
        [
          storageKey(exam),
          { storageVersion: 1, current: legacy(first!), history: [legacy(last!)] },
        ],
      ]).read();
      expect(output).toMatchObject({ coverage: 'partial', attempts: [] });
      expect(output.warnings.join(' ')).toContain('conflitante');
    },
  );
  it('identidade incorreta não é confundida com a identidade válida do history', () => {
    const wrongIdentity = { ...current(entry('one', 90)), examId: second.id };
    const output = store([
      [storageKey(exam), { storageVersion: 3, current: wrongIdentity }],
      [historyStorageKey(exam), { storageVersion: 3, history: [entry('one', 80)] }],
    ]).read();
    expect(output).toMatchObject({
      coverage: 'partial',
      attempts: [expect.objectContaining({ examId: exam.id, attemptId: 'one', percentage: 80 })],
    });
    expect(output.warnings.join(' ')).not.toContain('conflitante');
  });
  it('diferenças de modo e tempo também são conflitos de identidade', () => {
    for (const changed of [entry('one', 80, 'study'), entry('one', 80, 'exam', now - DAY)]) {
      expect(
        store([
          [storageKey(exam), { storageVersion: 3, current: current() }],
          [historyStorageKey(exam), { storageVersion: 3, history: [changed] }],
        ]).read(),
      ).toMatchObject({ coverage: 'partial', attempts: [] });
    }
  });
  it('duas cópias detalhadas com respostas acadêmicas diferentes conflitam mesmo com Result igual', () => {
    const one = current();
    const other = { ...one, answers: { q: 'different' } };
    expect(
      store([
        [storageKey(exam), { storageVersion: 1, current: legacy(one), history: [legacy(other)] }],
      ]).read(),
    ).toMatchObject({ coverage: 'partial', attempts: [] });
  });
  it('flags e ordem das propriedades não causam conflito acadêmico', () => {
    const one = current();
    const other = { ...one, flagged: ['q'] };
    expect(
      store([
        [storageKey(exam), { storageVersion: 1, current: legacy(one), history: [legacy(other)] }],
      ]).read(),
    ).toMatchObject({
      coverage: 'complete',
      attempts: [expect.objectContaining({ attemptId: 'one' })],
    });
  });
  it.each(['{invalid', { storageVersion: 9 }, { storageVersion: 3, current: {} }])(
    'fonte inválida %j mantém history independente',
    (invalid) => {
      expect(
        store([
          [storageKey(exam), invalid],
          [historyStorageKey(exam), { storageVersion: 3, history: [entry()] }],
        ]).read(),
      ).toMatchObject({
        coverage: 'partial',
        attempts: [expect.objectContaining({ attemptId: 'one' })],
      });
    },
  );
  it('JSON inválido em history mantém current válido', () => {
    expect(
      store([
        [storageKey(exam), { storageVersion: 3, current: current() }],
        [historyStorageKey(exam), '{bad'],
      ]).read(),
    ).toMatchObject({
      coverage: 'partial',
      attempts: [expect.objectContaining({ attemptId: 'one' })],
    });
  });
  it.each(['examId', 'examRevision'])('identidade %s errada exclui current', (field) => {
    const invalid = { ...current(), [field]: field === 'examId' ? 'wrong' : 2 };
    expect(
      store([[storageKey(exam), { storageVersion: 3, current: invalid }]]).read(),
    ).toMatchObject({ coverage: 'partial', attempts: [] });
  });
  it('revisões antigas não são lidas ou projetadas', () => {
    const fixture = store([
      [historyStorageKey({ ...exam, revision: 2 }), { storageVersion: 3, history: [entry()] }],
    ]);
    expect(fixture.read()).toMatchObject({ coverage: 'complete', attempts: [] });
  });
  it.each([
    { percentage: 79 },
    { objectiveTotal: 101 },
    { incorrect: 0 },
    { objectiveAnswered: 99 },
    { unanswered: 1 },
    { essayAnswered: 1 },
  ])('Result inconsistente %j não vira resultado', (change) => {
    const invalid = { ...entry(), result: { ...result(80), ...change } };
    expect(
      store([[historyStorageKey(exam), { storageVersion: 3, history: [invalid] }]]).read(),
    ).toMatchObject({ coverage: 'partial', attempts: [] });
  });
  it('Result inconsistente estruturado também exclui cópia válida conflitante', () => {
    const invalid = { ...entry(), result: { ...result(80), percentage: 79 } };
    expect(
      store([
        [storageKey(exam), { storageVersion: 3, current: current() }],
        [historyStorageKey(exam), { storageVersion: 3, history: [invalid] }],
      ]).read(),
    ).toMatchObject({ coverage: 'partial', attempts: [] });
  });
  it.each([false, true])(
    'Result inconsistente estruturado no current continua evidência (índice incompatível: %s)',
    (invalidIndex) => {
      const inconsistent = {
        ...current(),
        result: { ...result(80), percentage: 79 },
        ...(invalidIndex ? { currentIndex: exam.questionCount } : {}),
      };
      expect(
        currentEnvelopeSchema.safeParse({ storageVersion: 3, current: inconsistent }).success,
      ).toBe(true);
      const output = store([
        [storageKey(exam), { storageVersion: 3, current: inconsistent }],
        [historyStorageKey(exam), { storageVersion: 3, history: [entry('one', 80)] }],
      ]).read();
      expect(output).toMatchObject({ coverage: 'partial', attempts: [] });
      expect(output.warnings.join(' ')).toContain('conflitante');
    },
  );
  it.each(['invalid', '2026-10-07T11:00:00.000Z'])(
    'timestamp inválido ou anterior ao início excluído: %s',
    (completedAt) => {
      expect(
        store([
          [historyStorageKey(exam), { storageVersion: 3, history: [{ ...entry(), completedAt }] }],
        ]).read(),
      ).toMatchObject({ coverage: 'partial', attempts: [] });
    },
  );
  it('getter do storage lançando torna toda análise indisponível', () => {
    expect(
      readAnalytics(catalog, () => {
        throw new Error('blocked');
      }),
    ).toMatchObject({ coverage: 'unavailable', attempts: [] });
  });
  it('getItem lançando depois de fonte válida não expõe análise incompleta como disponível', () => {
    expect(
      readAnalytics(catalog, () => ({
        getItem: (key) => {
          if (key === storageKey(exam))
            return JSON.stringify({ storageVersion: 3, current: current() });
          throw new Error('blocked');
        },
      })),
    ).toMatchObject({ coverage: 'unavailable', attempts: [] });
  });
  it('essay-only null mantém volume e não vira 0%', () => {
    const output = store([
      [historyStorageKey(essay), { storageVersion: 3, history: [entry('essay', null, 'study')] }],
    ]).read();
    expect(output.coverage).toBe('complete');
    expect(output.attempts[0]?.percentage).toBeNull();
  });
  it('ordem temporal e empates por code units são determinísticos entre Exams', () => {
    const output = store([
      [historyStorageKey(second), { storageVersion: 3, history: [entry('a')] }],
      [
        historyStorageKey(exam),
        {
          storageVersion: 3,
          history: [entry('z'), entry('a'), entry('earlier', 70, 'exam', now - DAY)],
        },
      ],
    ]).read();
    expect(output.attempts.map((item) => [item.examId, item.attemptId])).toEqual([
      [exam.id, 'earlier'],
      [exam.id, 'a'],
      [exam.id, 'z'],
      [second.id, 'a'],
    ]);
  });
  it('centenas de Attempts com IDs iguais entre Exams mantêm identidades separadas', () => {
    const many: Catalog = {
      schemaVersion: 1,
      exams: Array.from({ length: 19 }, (_, i) => ({ ...exam, id: `exam-${i}` })),
    };
    const values = new Map(
      many.exams.map((item) => [
        historyStorageKey(item),
        JSON.stringify({
          storageVersion: 3,
          history: Array.from({ length: 20 }, (_, i) => entry(String(i))),
        }),
      ]),
    );
    expect(
      readAnalytics(many, () => ({ getItem: (key) => values.get(key) ?? null })).attempts,
    ).toHaveLength(380);
  });
});
describe('matemática pura e filtros combináveis', () => {
  it('zero e único resultado: null não vira 0', () => {
    expect(analyzePerformance([], defaultAnalyticsFilters, now)).toMatchObject({
      average: null,
      scoredCount: 0,
      series: [],
      buckets: [],
    });
    expect(performanceSeries([attempt('one')])).toMatchObject([{ movingAverage: null }]);
  });
  it('subject, mode e período combinam sem mutar entrada', () => {
    const input = [
      attempt('a', 80),
      attempt('b', 90, 'Bioquímica'),
      attempt('c', 70, 'Anatomia', now, 'study'),
    ];
    const before = JSON.stringify(input);
    expect(
      filterAnalytics(input, { period: 7, subject: 'Anatomia', mode: 'study' }, now).map(
        (item) => item.attemptId,
      ),
    ).toEqual(['c']);
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each([7, 30, 90] as const)(
    'rolling %i dias inclui limites exatos e exclui passado/futuro',
    (period) => {
      const values = [
        attempt('boundary', 80, 'A', now - period * DAY),
        attempt('before', 80, 'A', now - period * DAY - 1),
        attempt('now'),
        attempt('future', 80, 'A', now + 1),
      ];
      expect(
        filterAnalytics(values, { ...defaultAnalyticsFilters, period }, now).map(
          (item) => item.attemptId,
        ),
      ).toEqual(['boundary', 'now']);
    },
  );
  it('todo período mantém história antiga', () => {
    expect(
      filterAnalytics([attempt('old', 80, 'A', now - 1000 * DAY)], defaultAnalyticsFilters, now),
    ).toHaveLength(1);
  });
  it('moving average de 3 ignora null e ordena resultados cronologicamente', () => {
    const series = performanceSeries([
      attempt('d', 100, 'A', now),
      attempt('a', 40, 'A', now - 3 * DAY),
      attempt('essay', null),
      attempt('b', 70, 'A', now - 2 * DAY),
      attempt('c', 100, 'A', now - DAY),
    ]);
    expect(series.map((item) => item.movingAverage)).toEqual([null, null, 70, 90]);
  });
  it('média aritmética dá peso 1 por Attempt, exclui null, preserva disciplina sem nota', () => {
    expect(
      subjectStatistics([
        attempt('a', 10),
        { ...attempt('b', 90), objectiveTotal: 10 },
        attempt('c', null),
        attempt('d', null, 'Ética'),
      ]),
    ).toEqual([
      { subject: 'Anatomia', count: 3, scoredCount: 2, average: 50 },
      { subject: 'Ética', count: 1, scoredCount: 0, average: null },
    ]);
  });
  it('buckets diários vazios, limites e ambos os modos incluindo null', () => {
    const buckets = activityBuckets(
      [
        attempt('a', null, 'A', now - 7 * DAY, 'study'),
        attempt('b', 80, 'A', now - 6 * DAY),
        attempt('c', 90),
      ],
      7,
      now,
    );
    expect(buckets).toHaveLength(7);
    expect(buckets[0]?.study).toBe(1);
    expect(buckets[1]?.exam).toBe(1);
    expect(buckets[6]?.exam).toBe(1);
    expect(buckets.reduce((sum, bucket) => sum + bucket.exam + bucket.study, 0)).toBe(3);
  });
  it.each([
    [30, 5],
    [90, 13],
  ] as const)('buckets semanais %i incluem vazios e intervalo parcial final', (period, count) => {
    const buckets = activityBuckets([], period, now);
    expect(buckets).toHaveLength(count);
    expect(buckets[0]?.start).toBe(now - period * DAY);
    expect(buckets.at(-1)?.end).toBe(now);
    expect(buckets.every((bucket) => bucket.exam === 0 && bucket.study === 0)).toBe(true);
  });
  it('monthly agrupa UTC e mostra somente meses com atividade', () => {
    const buckets = activityBuckets(
      [
        attempt('a', null, 'A', Date.parse('2020-01-01T00:00:00Z'), 'study'),
        attempt('b', 90),
        attempt('c', 70),
      ],
      'all',
      now,
    );
    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.study).toBe(1);
    expect(buckets[1]?.exam).toBe(2);
  });
  it('muitos resultados preservam todos os pontos e null contribui só para atividade', () => {
    const input = Array.from({ length: 400 }, (_, i) =>
      attempt(String(i), i % 2 ? null : 80, 'A', now - i * 1000),
    );
    const output = analyzePerformance(input, defaultAnalyticsFilters, now);
    expect(output.series).toHaveLength(200);
    expect(output.average).toBe(80);
    expect(output.attempts).toHaveLength(400);
    expect(output.buckets[0]!.exam).toBe(400);
  });
});
describe('insights descritivos determinísticos', () => {
  it('limiares exatos ±8 com médias fracionárias não sofrem arredondamento binário', () => {
    const scores = [56, 57, 57, 64, 65, 65];
    const input = scores.map((score, i) => attempt(String(i), score, 'A', now - (6 - i) * DAY));
    expect(performanceInsights(input)[0]?.title).toBe('Tendência positiva');
    const reversed = [...scores]
      .reverse()
      .map((score, i) => attempt(String(i), score, 'A', now - (6 - i) * DAY));
    expect(performanceInsights(reversed)[0]?.title).toBe('Ponto de atenção na tendência');
  });
  it('menos de 6 resultados pontuados não avalia tendência', () => {
    expect(performanceInsights([attempt('a'), attempt('b', null)])[0]?.title).toBe(
      'Dados insuficientes para avaliar tendência',
    );
  });
  it.each([
    [8, 'Tendência positiva'],
    [-8, 'Ponto de atenção na tendência'],
    [7, 'Desempenho recente estável'],
    [-7, 'Desempenho recente estável'],
  ])('limiar delta %i: %s', (delta, title) => {
    const input = Array.from({ length: 6 }, (_, i) =>
      attempt(String(i), i < 3 ? 80 : 80 + Number(delta), 'A', now - (6 - i) * DAY),
    );
    const insight = performanceInsights(input)[0]!;
    expect(insight.title).toBe(title);
    expect(insight.description).toContain('sem previsão futura');
  });
  it('amostra mínima 3 e duas disciplinas elegíveis para maior média', () => {
    const input = [
      attempt('a', 90),
      attempt('b', 90),
      attempt('c', 90),
      attempt('d', 80, 'Bioquímica'),
      attempt('e', 80, 'Bioquímica'),
    ];
    expect(performanceInsights(input).some((item) => item.title === 'Maior média no período')).toBe(
      false,
    );
    expect(
      performanceInsights([...input, attempt('f', 80, 'Bioquímica')]).find(
        (item) => item.title === 'Maior média no período',
      )?.description,
    ).toContain('Anatomia');
  });
  it('empate de disciplina por code units determinístico', () => {
    const input = ['Z', 'A'].flatMap((subject) =>
      Array.from({ length: 3 }, (_, i) => attempt(subject + i, 90, subject)),
    );
    expect(
      performanceInsights(input).find((item) => item.title === 'Maior média no período')
        ?.description,
    ).toMatch(/^A:/);
  });
  it.each([69, 76])('atenção média abaixo de 70 ou delta global >=8: %i', (score) => {
    const input = [score, score, score].map((value, i) => attempt('a' + i, value));
    input.push(...[100, 100, 100].map((value, i) => attempt('b' + i, value, 'B')));
    expect(performanceInsights(input).at(-1)?.title).toBe('Ponto de atenção por disciplina');
  });
  it('não cria falsa atenção com média 70, diferença <8 ou amostra <3', () => {
    expect(
      performanceInsights(Array.from({ length: 3 }, (_, i) => attempt(String(i), 70))).at(-1)
        ?.title,
    ).toBe('Sem um ponto de atenção claro neste recorte.');
    expect(performanceInsights([attempt('a', 0), attempt('b', 0)]).at(-1)?.title).toBe(
      'Sem um ponto de atenção claro neste recorte.',
    );
  });
});
