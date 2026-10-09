import { storageFixtureJson } from './legacy-fixtures';
import { describe, expect, it, vi } from 'vitest';
import { readExamProgress, type CatalogExam } from '../src/engine/catalog-progress';
import { createAttempt, transition, type Attempt, type Result } from '../src/engine/exam-state';
import { historyStorageKey, storageKey, summary } from '../src/engine/persistence';
import { catalogExam, completedAttempt } from './catalog-fixtures';
import { poc } from './fixtures';
const read = (exam = catalogExam) => readExamProgress(exam).progress;
function saveCurrent(current: unknown) {
  localStorage.setItem(storageKey(catalogExam), storageFixtureJson({ storageVersion: 2, current }));
}
function saveHistory(history: unknown[]) {
  localStorage.setItem(
    historyStorageKey(catalogExam),
    storageFixtureJson({ storageVersion: 2, history }),
  );
}
const storedLocations = ['current v1', 'current v2', 'history v1', 'history v2'] as const;
type StoredLocation = (typeof storedLocations)[number];
function readStoredAttempt(location: StoredLocation, attempt: Attempt, exam = catalogExam) {
  const values = new Map<string, string>();
  if (location.endsWith('v1')) {
    values.set(
      storageKey(exam),
      storageFixtureJson({
        storageVersion: 1,
        current: location.startsWith('current')
          ? attempt
          : createAttempt(poc, '2026-10-03T10:00:00.000Z'),
        history: location.startsWith('history') ? [attempt] : [],
      }),
    );
  } else if (location.startsWith('current')) {
    values.set(storageKey(exam), storageFixtureJson({ storageVersion: 2, current: attempt }));
  } else {
    values.set(
      historyStorageKey(exam),
      storageFixtureJson({ storageVersion: 2, history: [summary(attempt)] }),
    );
  }
  const original = [...values];
  const setItem = vi.fn((key: string, value: string) => values.set(key, value));
  const { progress } = readExamProgress(exam, () => ({
    getItem: (key) => values.get(key) ?? null,
    setItem,
  }));
  expect(setItem).not.toHaveBeenCalled();
  expect([...values]).toEqual(original);
  return progress;
}
describe('leitura local de progresso do catálogo', () => {
  it('sem dados retorna não iniciada com valores seguros', () => {
    expect(read()).toEqual({
      status: 'not-started',
      answeredCount: 0,
      questionCount: 30,
      progressPercentage: 0,
      attemptCount: 0,
      lastResultPercentage: null,
      lastResultAt: null,
      bestResultPercentage: null,
      lastActivityAt: null,
    });
  });
  it('storage ausente não lança', () => {
    expect(
      readExamProgress(catalogExam, () => {
        throw new Error('unavailable');
      }),
    ).toMatchObject({
      unavailable: true,
      progress: { status: 'not-started' },
    });
  });
  it('current v2 aberto, até com zero respostas, está em andamento', () => {
    saveCurrent(createAttempt(poc, '2026-10-03T10:00:00.000Z'));
    expect(read()).toMatchObject({
      status: 'in-progress',
      answeredCount: 0,
      lastActivityAt: '2026-10-03T10:00:00.000Z',
    });
  });
  it('conta respostas não vazias e arredonda progresso sem usar JSONs acadêmicos', () => {
    saveCurrent({ ...createAttempt(poc), answers: { a: 'option-1', b: 'Texto', c: '   ', d: '' } });
    expect(read()).toMatchObject({ answeredCount: 2, progressPercentage: 7 });
  });
  it('limita a contagem defensivamente e trata denominador inválido', () => {
    saveCurrent({
      ...createAttempt(poc),
      answers: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(i), 'x'])),
    });
    expect(read()).toMatchObject({ answeredCount: 30, progressPercentage: 100 });
    expect(read({ ...catalogExam, questionCount: 0 }).progressPercentage).toBe(0);
  });
  it('current v2 concluído fornece resultado persistido e conclusão', () => {
    saveCurrent(completedAttempt());
    expect(read()).toMatchObject({
      status: 'completed',
      attemptCount: 1,
      lastResultPercentage: 5,
      bestResultPercentage: 5,
      lastActivityAt: '2026-10-03T11:00:00.000Z',
    });
  });
  it('current concluído não duplica history', () => {
    const current = completedAttempt();
    saveCurrent(current);
    saveHistory([summary(current)]);
    expect(read().attemptCount).toBe(1);
  });
  it('múltiplas tentativas únicas geram último e melhor resultado em ordem cronológica', () => {
    saveCurrent(createAttempt(poc, '2026-10-04T10:00:00.000Z'));
    saveHistory([
      summary(completedAttempt('best', 10)),
      summary(completedAttempt('latest', 2, '2026-10-03T12:00:00.000Z')),
      summary(completedAttempt('best', 10)),
    ]);
    expect(read()).toMatchObject({
      status: 'in-progress',
      attemptCount: 2,
      lastResultPercentage: 10,
      bestResultPercentage: 50,
      lastActivityAt: '2026-10-04T10:00:00.000Z',
    });
  });
  it('v1 continua legível sem migração, incluindo histórico e conclusão', () => {
    const current = completedAttempt();
    localStorage.setItem(
      storageKey(catalogExam),
      storageFixtureJson({
        storageVersion: 1,
        current,
        history: [current, completedAttempt('past', 5)],
      }),
    );
    expect(read()).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      bestResultPercentage: 25,
    });
    expect(JSON.parse(localStorage.getItem(storageKey(catalogExam))!).storageVersion).toBe(1);
  });
  it('v1 com histórico inválido ainda preserva a leitura do current', () => {
    localStorage.setItem(
      storageKey(catalogExam),
      storageFixtureJson({ storageVersion: 1, current: createAttempt(poc), history: 'corrupt' }),
    );
    expect(read().status).toBe('in-progress');
  });
  it('prova dissertativa concluída mantém percentage null', () => {
    const essay = { ...poc, questions: poc.questions.filter((q) => q.type === 'essay') };
    saveCurrent(
      transition(essay, createAttempt(essay, '2026-10-03T10:00:00.000Z'), {
        type: 'finish',
        now: '2026-10-03T11:00:00.000Z',
      }),
    );
    expect(
      read({ ...catalogExam, questionCount: 10, objectiveCount: 0, essayCount: 10 }),
    ).toMatchObject({
      status: 'completed',
      attemptCount: 1,
      lastResultPercentage: null,
      bestResultPercentage: null,
    });
  });
  it('nova tentativa após conclusão mantém histórico e retorna em andamento', () => {
    saveHistory([summary(completedAttempt())]);
    saveCurrent(createAttempt(poc));
    expect(read()).toMatchObject({
      status: 'in-progress',
      attemptCount: 1,
      lastResultPercentage: 5,
    });
  });
  it('provas e revisions diferentes são isoladas pelas chaves', () => {
    saveCurrent(completedAttempt());
    saveHistory([summary(completedAttempt())]);
    expect(read({ ...catalogExam, revision: 2 }).status).toBe('not-started');
    expect(read({ ...catalogExam, id: 'other' }).attemptCount).toBe(0);
    saveCurrent({ ...createAttempt(poc), examRevision: 2 });
    expect(read().status).toBe('not-started');
  });
  it.each(['{bad', '{}', '{"storageVersion":9}'])(
    'JSON/envelope corrompido %s não derruba nem sobrescreve',
    (raw) => {
      localStorage.setItem(storageKey(catalogExam), raw);
      expect(read().status).toBe('not-started');
      expect(localStorage.getItem(storageKey(catalogExam))).toBe(raw);
    },
  );
  it.each(['{bad', '{"storageVersion":2,"history":"bad"}'])(
    'histórico corrompido %s não derruba current',
    (raw) => {
      saveCurrent(completedAttempt());
      localStorage.setItem(historyStorageKey(catalogExam), raw);
      expect(read()).toMatchObject({ status: 'completed', attemptCount: 1 });
      expect(localStorage.getItem(historyStorageKey(catalogExam))).toBe(raw);
    },
  );
  it('ignora entradas inválidas e datas/resultados incompatíveis no histórico', () => {
    saveCurrent(createAttempt(poc));
    const valid = summary(completedAttempt());
    saveHistory([
      valid,
      {},
      { ...valid, id: 'bad-date', completedAt: '2020-01-01T00:00:00.000Z' },
      { ...valid, id: 'bad-result', result: { ...valid.result, objectiveTotal: 99 } },
    ]);
    expect(read().attemptCount).toBe(1);
  });
  it('F02: history v3 exige mode por entrada e aproveita sibling Study válido sem writes', () => {
    const { mode: _oldMode, ...missingMode } = summary(completedAttempt('invalid-v3', 1));
    const study = {
      ...summary(completedAttempt('valid-study-v3', 10, '2026-10-03T12:00:00.000Z')),
      mode: 'study' as const,
    };
    const raw = storageFixtureJson({ storageVersion: 3, history: [missingMode, study] });
    localStorage.setItem(historyStorageKey(catalogExam), raw);
    const getItem = vi.fn((key: string) => localStorage.getItem(key));
    const setItem = vi.fn();
    const removeItem = vi.fn();
    const output = readExamProgress(catalogExam, () => ({ getItem, setItem, removeItem }));
    expect(output).toMatchObject({
      includesExam: false,
      includesStudy: true,
      progress: {
        status: 'not-started',
        attemptCount: 1,
        lastResultPercentage: 50,
        bestResultPercentage: 50,
        lastResultAt: '2026-10-03T12:00:00.000Z',
      },
    });
    expect(getItem.mock.calls).toEqual([
      [storageKey(catalogExam)],
      [historyStorageKey(catalogExam)],
    ]);
    expect(localStorage.getItem(historyStorageKey(catalogExam))).toBe(raw);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
  it('F02: mode ausente é inválido em v3, mas continua normalizado em v2', () => {
    const { mode: _oldMode, ...legacy } = summary(completedAttempt('legacy-no-mode', 10));
    const v3 = storageFixtureJson({ storageVersion: 3, history: [legacy] });
    localStorage.setItem(historyStorageKey(catalogExam), v3);
    expect(readExamProgress(catalogExam)).toMatchObject({
      includesExam: false,
      includesStudy: false,
      progress: {
        status: 'not-started',
        attemptCount: 0,
        lastResultPercentage: null,
        lastResultAt: null,
      },
    });
    expect(localStorage.getItem(historyStorageKey(catalogExam))).toBe(v3);
    const v2 = storageFixtureJson({ storageVersion: 2, history: [legacy] });
    localStorage.setItem(historyStorageKey(catalogExam), v2);
    expect(readExamProgress(catalogExam)).toMatchObject({
      includesExam: true,
      includesStudy: false,
      progress: {
        status: 'not-started',
        attemptCount: 1,
        lastResultPercentage: 50,
      },
    });
    expect(localStorage.getItem(historyStorageKey(catalogExam))).toBe(v2);
  });
  it('F02: history v3 inválido não oculta current concluído independente', () => {
    const current = completedAttempt();
    saveCurrent(current);
    const { mode: _oldMode, ...invalid } = summary(completedAttempt('invalid-only-v3'));
    const raw = storageFixtureJson({ storageVersion: 3, history: [invalid] });
    localStorage.setItem(historyStorageKey(catalogExam), raw);
    expect(readExamProgress(catalogExam)).toMatchObject({
      includesExam: true,
      progress: {
        status: 'completed',
        attemptCount: 1,
        lastResultPercentage: 5,
        lastResultAt: current.completedAt,
      },
    });
    expect(localStorage.getItem(historyStorageKey(catalogExam))).toBe(raw);
  });
  it('sem current, aproveita histórico válido e sua atividade', () => {
    saveHistory([summary(completedAttempt())]);
    expect(read()).toMatchObject({
      status: 'not-started',
      attemptCount: 1,
      lastActivityAt: '2026-10-03T11:00:00.000Z',
    });
  });
  it('escolhe a atividade mais recente entre current e histórico', () => {
    saveCurrent(createAttempt(poc, '2026-10-03T10:00:00.000Z'));
    saveHistory([summary(completedAttempt())]);
    expect(read().lastActivityAt).toBe('2026-10-03T11:00:00.000Z');
  });
  it.each([
    { completedAt: '2026-10-03T11:00:00.000Z', result: null },
    { completedAt: null, result: completedAttempt().result },
    { currentIndex: 30 },
    { examId: 'other' },
    { completedAt: '2020-01-01T00:00:00.000Z', result: completedAttempt().result },
  ])('rejeita current estruturalmente incompatível %j', (patch) => {
    saveCurrent({ ...createAttempt(poc), ...patch });
    expect(read().status).toBe('not-started');
  });
  it('SecurityError no getter ou getItem não lança', () => {
    const denied = () => {
      throw new DOMException('Blocked', 'SecurityError');
    };
    expect(readExamProgress(catalogExam, denied).unavailable).toBe(true);
    expect(readExamProgress(catalogExam, () => ({ getItem: denied })).progress.status).toBe(
      'not-started',
    );
  });
  it('chaves antigas são byte por byte idênticas para Exam e metadados', () => {
    expect(storageKey(poc)).toBe(`chatgpt-exams:v1:${poc.id}:r1`);
    expect(storageKey(catalogExam)).toBe(storageKey(poc));
    expect(historyStorageKey(catalogExam)).toBe(`chatgpt-exams:v1:${poc.id}:r1:history`);
  });
  it('reader é read-only e lê apenas as duas chaves conhecidas', () => {
    const getItem = vi.fn().mockReturnValue(null),
      setItem = vi.fn();
    readExamProgress(catalogExam, () => ({ getItem, setItem }));
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem.mock.calls).toEqual([
      [storageKey(catalogExam)],
      [historyStorageKey(catalogExam)],
    ]);
  });
});

describe.each(storedLocations)('consistência de resultado em %s', (location) => {
  const cases: { name: string; patch: Partial<Result>; accepted: boolean }[] = [
    {
      name: '0/20 com percentage 100',
      patch: { correct: 0, objectiveAnswered: 0, unanswered: 20, percentage: 100 },
      accepted: false,
    },
    { name: '10/20 com percentage 50', patch: { percentage: 50 }, accepted: true },
    { name: '10/20 com percentage 49', patch: { percentage: 49 }, accepted: false },
    { name: 'percentage fracionário divergente', patch: { percentage: 50.5 }, accepted: false },
    { name: 'objectiveAnswered divergente', patch: { objectiveAnswered: 9 }, accepted: false },
    { name: 'soma diferente de objectiveTotal', patch: { unanswered: 9 }, accepted: false },
    { name: 'essayAnswered maior que essayTotal', patch: { essayAnswered: 11 }, accepted: false },
    {
      name: 'objectiveTotal divergente do índice',
      patch: { objectiveTotal: 21, unanswered: 11, percentage: 48 },
      accepted: false,
    },
    { name: 'essayTotal divergente do índice', patch: { essayTotal: 11 }, accepted: false },
  ];
  it.each(cases)('$name: aceito=$accepted', ({ patch, accepted }) => {
    const attempt = completedAttempt('result-check', 10);
    attempt.result = { ...attempt.result!, ...patch };
    const progress = readStoredAttempt(location, attempt);
    expect(progress).toMatchObject({
      status: location.startsWith('current')
        ? accepted
          ? 'completed'
          : 'not-started'
        : location === 'history v1'
          ? 'in-progress'
          : 'not-started',
      attemptCount: accepted ? 1 : 0,
      lastResultPercentage: accepted ? 50 : null,
      bestResultPercentage: accepted ? 50 : null,
    });
    if (!accepted && location.startsWith('current')) {
      expect(progress).toMatchObject({
        answeredCount: 0,
        progressPercentage: 0,
        lastActivityAt: null,
      });
    }
  });
  it.each([null, 0])('somente dissertativa com percentage %s', (percentage) => {
    const essay = { ...poc, questions: poc.questions.filter((q) => q.type === 'essay') };
    const exam: CatalogExam = {
      ...catalogExam,
      questionCount: 10,
      objectiveCount: 0,
      essayCount: 10,
    };
    const attempt = transition(essay, createAttempt(essay, '2026-10-03T10:00:00.000Z'), {
      type: 'finish',
      now: '2026-10-03T11:00:00.000Z',
    });
    attempt.result = { ...attempt.result!, percentage };
    expect(readStoredAttempt(location, attempt, exam)).toMatchObject({
      status: location.startsWith('current')
        ? percentage === null
          ? 'completed'
          : 'not-started'
        : location === 'history v1'
          ? 'in-progress'
          : 'not-started',
      attemptCount: percentage === null ? 1 : 0,
      lastResultPercentage: null,
      bestResultPercentage: null,
    });
  });
});

describe('degradação segura e flagged único', () => {
  it.each([1, 2])(
    'current v%s concluído inconsistente preserva apenas o histórico válido',
    (version) => {
      const current = completedAttempt('invalid-current', 0);
      current.result = { ...current.result!, percentage: 100 };
      const past = completedAttempt('valid-past', 10);
      localStorage.setItem(
        storageKey(catalogExam),
        storageFixtureJson(
          version === 1
            ? { storageVersion: 1, current, history: [past] }
            : { storageVersion: 2, current },
        ),
      );
      if (version === 2) saveHistory([summary(past)]);
      const before = localStorage.getItem(storageKey(catalogExam));
      expect(read()).toMatchObject({
        status: 'not-started',
        answeredCount: 0,
        progressPercentage: 0,
        attemptCount: 1,
        lastResultPercentage: 50,
        bestResultPercentage: 50,
        lastActivityAt: past.completedAt,
      });
      expect(localStorage.getItem(storageKey(catalogExam))).toBe(before);
    },
  );
  describe.each(['current v1', 'current v2'] as const)('%s', (location) => {
    const question = poc.questions.find((q) => q.type === 'multiple-choice')!;
    const cases = [
      { name: 'vazio', flagged: [], answered: false, accepted: true },
      {
        name: 'IDs únicos',
        flagged: poc.questions.slice(0, 2).map((q) => q.id),
        answered: false,
        accepted: true,
      },
      { name: 'duplicado', flagged: [question.id, question.id], answered: false, accepted: false },
      {
        name: 'duplicado com resposta válida',
        flagged: [question.id, question.id],
        answered: true,
        accepted: false,
      },
    ];
    it.each(cases)('flagged $name: aceito=$accepted', ({ flagged, answered, accepted }) => {
      let attempt = createAttempt(poc, '2026-10-03T10:00:00.000Z');
      if (answered)
        attempt = transition(poc, attempt, {
          type: 'answer',
          questionId: question.id,
          value: question.correctAnswer,
        });
      attempt.flagged = flagged;
      expect(readStoredAttempt(location, attempt)).toMatchObject({
        status: accepted ? 'in-progress' : 'not-started',
        answeredCount: 0,
        progressPercentage: 0,
        attemptCount: 0,
        lastResultPercentage: null,
        bestResultPercentage: null,
        lastActivityAt: accepted ? attempt.startedAt : null,
      });
    });
  });
  it('history v1 com flagged duplicado não fornece conclusão', () => {
    const attempt = completedAttempt();
    attempt.flagged = [poc.questions[0]!.id, poc.questions[0]!.id];
    expect(readStoredAttempt('history v1', attempt)).toMatchObject({
      status: 'in-progress',
      attemptCount: 0,
      lastResultPercentage: null,
      bestResultPercentage: null,
    });
  });
});
