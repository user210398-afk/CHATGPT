import { legacyAttempt, storageFixtureJson } from './legacy-fixtures';
import { describe, expect, it, vi } from 'vitest';
import {
  AttemptRepository,
  historyStorageKey,
  storageKey,
  includeCurrent,
  summary,
  HISTORY_LIMIT,
} from '../src/engine/persistence';
import { createAttempt, transition } from '../src/engine/exam-state';
import { poc, first, firstEssay } from './fixtures';
import { completedAttempt } from './catalog-fixtures';
const repository = () => new AttemptRepository(() => localStorage);
describe('persistência isolada e versionada', () => {
  it('restaura respostas, questão, marcação, início, resultado e histórico sem duplicar', () => {
    const repo = repository();
    let state = createAttempt(poc, '2026-10-03T10:00:00.000Z');
    state = transition(poc, state, { type: 'answer', questionId: first.id, value: 'option-2' });
    state = transition(poc, state, {
      type: 'answer',
      questionId: firstEssay.id,
      value: 'Resposta dissertativa',
    });
    state = transition(poc, state, { type: 'navigate', index: 20 });
    state = transition(poc, state, { type: 'flag', questionId: firstEssay.id });
    repo.save(poc, state, [], repo.read(poc).persistence);
    expect(repo.load(poc)).toMatchObject({ current: state, restored: true, warning: null });
    state = transition(poc, state, { type: 'finish', now: '2026-10-03T10:20:00.000Z' });
    const saved = repo.save(poc, state, [], repo.read(poc).persistence);
    repo.save(poc, state, saved.history, repo.read(poc).persistence);
    expect(repo.load(poc).history).toEqual([
      {
        id: state.id,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        result: state.result,
        mode: 'exam',
      },
    ]);
    const next = createAttempt(poc);
    repo.save(poc, next, saved.history, repo.read(poc).persistence);
    expect(repo.load(poc)).toMatchObject({
      current: next,
      history: [{ id: state.id, result: state.result }],
    });
  });
  it.each(['{bad', '{}', '{"storageVersion":0}'])(
    'sobrevive a estado corrompido/antigo: %s',
    (value) => {
      localStorage.setItem(storageKey(poc), value);
      expect(repository().load(poc)).toMatchObject({ restored: false, current: { answers: {} } });
      expect(repository().load(poc).warning).toBeTruthy();
      expect(localStorage.getItem(storageKey(poc))).toBe(value);
    },
  );
  it('rejeita referências, posições e resultados adulterados', () => {
    const repo = repository();
    const fresh = createAttempt(poc);
    for (const current of [
      { ...fresh, currentIndex: 99 },
      { ...fresh, answers: { [first.id]: 'option-99' } },
      { ...fresh, answers: { inexistente: 'abc' } },
      { ...fresh, flagged: ['inexistente'] },
      { ...fresh, examRevision: 2 },
    ]) {
      localStorage.setItem(
        storageKey(poc),
        storageFixtureJson({ storageVersion: 1, current, history: [] }),
      );
      expect(repo.load(poc).restored).toBe(false);
    }
    const finished = transition(poc, fresh, { type: 'finish', now: new Date().toISOString() });
    localStorage.setItem(
      storageKey(poc),
      storageFixtureJson({
        storageVersion: 1,
        current: { ...finished, result: { ...finished.result, correct: 999 } },
        history: [],
      }),
    );
    expect(repo.load(poc).restored).toBe(false);
  });
  it('isola provas, revisões e chaves do legado', () => {
    const repo = repository();
    localStorage.setItem('simulado_fisio_state', 'preservado');
    repo.save(poc, createAttempt(poc), [], repo.read(poc).persistence);
    expect(repo.load({ ...poc, id: 'outra-prova' }).restored).toBe(false);
    expect(repo.load({ ...poc, revision: 2 }).restored).toBe(false);
    expect(localStorage.getItem('simulado_fisio_state')).toBe('preservado');
  });
  it('continua em memória se armazenamento for bloqueado ou exceder quota', () => {
    const repo = new AttemptRepository(() => {
      throw new Error('SecurityError');
    });
    expect(repo.load(poc).warning).toBeTruthy();
    expect(repo.save(poc, createAttempt(poc), [], repo.read(poc).persistence).warning).toBeTruthy();
  });
  it('grava histórico compacto uma vez e não o regrava na navegação ou resposta', () => {
    const values = new Map<string, string>();
    const writes: string[] = [];
    const repo = new AttemptRepository(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        writes.push(key);
        values.set(key, value);
      },
    }));
    let current = createAttempt(poc, '2026-10-03T10:00:00.000Z');
    current = transition(poc, current, {
      type: 'answer',
      questionId: firstEssay.id,
      value: 'Texto longo',
    });
    current = transition(poc, current, { type: 'finish', now: '2026-10-03T10:10:00.000Z' });
    const saved = repo.save(poc, current, [], repo.read(poc).persistence);
    expect(writes).toEqual([storageKey(poc), historyStorageKey(poc)]);
    expect(values.get(historyStorageKey(poc))).not.toContain('Texto longo');
    expect(JSON.parse(values.get(historyStorageKey(poc))!).history[0]).toEqual({
      id: current.id,
      startedAt: current.startedAt,
      completedAt: current.completedAt,
      result: current.result,
      mode: 'exam',
    });
    repo.save(
      poc,
      transition(poc, current, { type: 'navigate', index: 1 }),
      saved.history,
      repo.read(poc).persistence,
    );
    expect(writes).toEqual([storageKey(poc), historyStorageKey(poc), storageKey(poc)]);
    expect(repo.load(poc).history).toHaveLength(1);
  });
  it('restaura envelope v1 e migra sem perder a tentativa ou histórico', () => {
    const current = createAttempt(poc, '2026-10-03T10:00:00.000Z');
    const completed = transition(poc, current, { type: 'finish', now: '2026-10-03T10:10:00.000Z' });
    localStorage.setItem(
      storageKey(poc),
      storageFixtureJson({ storageVersion: 1, current, history: [completed] }),
    );
    const repo = repository();
    const loaded = repo.load(poc);
    expect(loaded).toMatchObject({ restored: true, current, history: [{ id: completed.id }] });
    repo.save(poc, loaded.current, loaded.history, repo.read(poc).persistence);
    expect(JSON.parse(localStorage.getItem(storageKey(poc))!).storageVersion).toBe(3);
    expect(JSON.parse(localStorage.getItem(historyStorageKey(poc))!).history).toHaveLength(1);
    expect(repository().load(poc)).toMatchObject({
      restored: true,
      current,
      history: [{ id: completed.id }],
    });
  });
  it('preserva a tentativa quando o histórico separado está corrompido', () => {
    const repo = repository();
    const current = createAttempt(poc);
    repo.save(poc, current, [], repo.read(poc).persistence);
    localStorage.setItem(historyStorageKey(poc), '{corrompido');
    expect(repository().load(poc)).toMatchObject({
      restored: true,
      current,
      history: [],
      warning: expect.any(String),
    });
  });
  it('recupera conclusão ausente do histórico antes de iniciar outra tentativa', () => {
    const current = createAttempt(poc, '2026-10-03T10:00:00.000Z');
    const completed = transition(poc, current, { type: 'finish', now: '2026-10-03T10:10:00.000Z' });
    localStorage.setItem(
      storageKey(poc),
      storageFixtureJson({ storageVersion: 2, current: completed }),
    );
    localStorage.setItem(
      historyStorageKey(poc),
      storageFixtureJson({ storageVersion: 2, history: [] }),
    );
    const repo = repository();
    const loaded = repo.load(poc);
    expect(loaded.history.map((entry) => entry.id)).toEqual([completed.id]);
    repo.save(poc, createAttempt(poc), loaded.history, repo.read(poc).persistence);
    expect(JSON.parse(localStorage.getItem(historyStorageKey(poc))!).history[0].id).toBe(
      completed.id,
    );
  });
});

describe('RT-P1: consumer snapshots and independent integrity', () => {
  const currentKey = storageKey(poc),
    historyKey = historyStorageKey(poc);
  const initial = () => createAttempt(poc, '2026-10-03T10:00:00.000Z', 'shared');
  const rawCurrent = (current: ReturnType<typeof initial>) =>
    JSON.stringify({ storageVersion: 3, current });
  const rawHistory = (history: unknown[]) => JSON.stringify({ storageVersion: 3, history });
  function memory(entries: [string, string][] = []) {
    const values = new Map(entries);
    return {
      values,
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    };
  }
  it.each(['answer', 'navigate', 'finish'] as const)(
    'rejects stale %s with winner bytes intact',
    (kind) => {
      const store = memory([
        [currentKey, rawCurrent(initial())],
        [historyKey, rawHistory([])],
      ]);
      const A = new AttemptRepository(() => store),
        B = new AttemptRepository(() => store);
      const a = A.read(poc),
        b = B.read(poc);
      const changed = transition(poc, a.current!, {
        type: 'answer',
        questionId: first.id,
        value: 'option-1',
      });
      A.save(poc, changed, a.history, a.persistence);
      const winner = new Map(store.values),
        writes = store.setItem.mock.calls.length;
      const stale = transition(
        poc,
        b.current!,
        kind === 'answer'
          ? { type: 'answer', questionId: poc.questions[1]!.id, value: 'option-1' }
          : kind === 'navigate'
            ? { type: 'navigate', index: 1 }
            : { type: 'finish', now: '2026-10-03T11:00:00.000Z' },
      );
      const rejected = B.save(poc, stale, b.history, b.persistence);
      expect(store.values).toEqual(winner);
      expect(store.setItem).toHaveBeenCalledTimes(writes);
      expect(rejected.status).toBe('conflict');
      expect(rejected.persistence).toBe(b.persistence);
      expect(B.save(poc, stale, b.history, b.persistence).status).toBe('conflict');
    },
  );
  it('reads 20 histories independently of corrupt current and blocks fresh replacement', () => {
    const histories = Array.from({ length: 20 }, (_, i) =>
      summary(completedAttempt(`history-${i}`)),
    );
    const store = memory([
      [currentKey, '{corrupt-current'],
      [historyKey, rawHistory(histories)],
    ]);
    const repo = new AttemptRepository(() => store),
      read = repo.read(poc);
    expect(read.history.map((h) => h.id).sort()).toEqual(histories.map((h) => h.id).sort());
    expect(read.persistence.current.status).toBe('corrupt');
    expect(read.persistence.history.status).toBe('valid');
    for (const current of [
      initial(),
      transition(poc, initial(), { type: 'finish', now: '2026-10-03T11:00:00.000Z' }),
    ])
      expect(repo.save(poc, current, read.history, read.persistence).status).toBe('blocked');
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('salvages a valid sibling for reading without allowing a partial history rewrite', () => {
    const valid = summary(completedAttempt('valid'));
    const mixed = ` ${rawHistory([valid, { ...valid, id: 'invalid', mode: 'future' }])}\n`;
    const store = memory([
      [currentKey, rawCurrent(initial())],
      [historyKey, mixed],
    ]);
    const repo = new AttemptRepository(() => store),
      read = repo.read(poc);
    expect(read.history).toEqual([valid]);
    expect(read.persistence.history.integrity).toBe('partial');
    const answer = transition(poc, read.current!, {
      type: 'answer',
      questionId: first.id,
      value: 'option-1',
    });
    const saved = repo.save(poc, answer, read.history, read.persistence);
    expect(saved.status).toBe('saved');
    expect(store.values.get(historyKey)).toBe(mixed);
    const before = new Map(store.values);
    expect(
      repo.save(
        poc,
        transition(poc, answer, { type: 'finish', now: '2026-10-03T11:00:00.000Z' }),
        saved.history,
        saved.persistence,
      ).status,
    ).toBe('blocked');
    expect(store.values).toEqual(before);
  });
  it('keeps two singleton consumers isolated across other reads and own successful saves', () => {
    const store = memory([[currentKey, ` ${rawCurrent(initial())}\n`]]);
    const repo = new AttemptRepository(() => store),
      a = repo.read(poc),
      b = repo.read(poc);
    const original = b.persistence.current.raw;
    let current = transition(poc, a.current!, {
      type: 'answer',
      questionId: first.id,
      value: 'option-1',
    });
    let saved = repo.save(poc, current, a.history, a.persistence);
    expect(saved.status).toBe('saved');
    current = transition(poc, current, {
      type: 'answer',
      questionId: poc.questions[1]!.id,
      value: 'option-2',
    });
    saved = repo.save(poc, current, saved.history, saved.persistence);
    expect(saved.status).toBe('saved');
    const thirdRead = repo.read(poc),
      winner = new Map(store.values);
    expect(b.persistence.current.raw).toBe(original);
    expect(
      repo.save(
        poc,
        transition(poc, b.current!, { type: 'navigate', index: 2 }),
        b.history,
        b.persistence,
      ).status,
    ).toBe('conflict');
    expect(store.values).toEqual(winner);
    const navigated = transition(poc, thirdRead.current!, { type: 'navigate', index: 3 });
    expect(repo.save(poc, navigated, thirdRead.history, thirdRead.persistence).status).toBe(
      'saved',
    );
    expect(JSON.parse(store.values.get(currentKey)!).current.answers).toEqual(current.answers);
  });
  it('requires a real consumer token and rejects invalid input without writes', () => {
    const store = memory(),
      repo = new AttemptRepository(() => store),
      read = repo.read(poc);
    // @ts-expect-error Save requires the consumer token even for a missing current.
    expect(repo.save(poc, initial(), [])).toMatchObject({ status: 'invalid', aborted: true });
    expect(repo.save(poc, initial(), [], { ...read.persistence }).status).toBe('invalid');
    expect(repo.save(poc, initial(), [], {} as typeof read.persistence).status).toBe('invalid');
    expect(repo.save(poc, { ...initial(), examRevision: 999 }, [], read.persistence).status).toBe(
      'invalid',
    );
    expect(repo.save(poc, initial(), [summary(completedAttempt())], read.persistence).status).toBe(
      'invalid',
    );
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('rejects concurrent completions and permits an explicit read before a later legitimate start', () => {
    const store = memory([[currentKey, rawCurrent(initial())]]),
      repo = new AttemptRepository(() => store);
    const a = repo.read(poc),
      b = repo.read(poc);
    const finish = (id: string) =>
      transition(poc, { ...initial(), id }, { type: 'finish', now: '2026-10-03T12:00:00.000Z' });
    const saved = repo.save(poc, finish('A'), a.history, a.persistence);
    expect(saved.status).toBe('saved');
    const winner = new Map(store.values);
    expect(repo.save(poc, finish('B'), b.history, b.persistence).status).toBe('conflict');
    expect(store.values).toEqual(winner);
    const freshRead = repo.read(poc);
    expect(
      repo.save(poc, createAttempt(poc), freshRead.history, freshRead.persistence).status,
    ).toBe('saved');
    expect(
      JSON.parse(store.values.get(historyKey)!).history.map((h: { id: string }) => h.id),
    ).toEqual(['A']);
  });
  it.each(['recent', 'older'] as const)(
    'starts with missing current and retains the correct 20 histories for %s completion',
    (kind) => {
      const histories = Array.from({ length: 20 }, (_, i) =>
        summary(
          completedAttempt(`h-${i}`, 1, `2026-10-04T10:${String(i).padStart(2, '0')}:00.000Z`),
        ),
      );
      const store = memory([[historyKey, rawHistory(histories)]]),
        repo = new AttemptRepository(() => store),
        read = repo.read(poc);
      expect(read.persistence.current).toMatchObject({ status: 'missing', raw: null });
      const current = initial(),
        started = repo.save(poc, current, read.history, read.persistence);
      expect(started.status).toBe('saved');
      expect(store.values.get(historyKey)).toBe(rawHistory(histories));
      const done = transition(poc, current, {
        type: 'finish',
        now: kind === 'recent' ? '2026-10-05T10:00:00.000Z' : '2026-10-03T11:00:00.000Z',
      });
      const saved = repo.save(poc, done, started.history, started.persistence);
      expect(saved.status).toBe('saved');
      expect(saved.history).toHaveLength(20);
      const ids = saved.history.map((h) => h.id);
      expect(ids).toEqual(
        kind === 'recent'
          ? [
              'shared',
              ...histories
                .slice(1)
                .reverse()
                .map((h) => h.id),
            ]
          : [...histories].reverse().map((h) => h.id),
      );
      expect(repo.read(poc).current).toEqual(done);
    },
  );
  it.each([
    ['corrupt', '{bad'],
    ['corrupt', JSON.stringify({ storageVersion: 3, current: {} })],
    ['incompatible', JSON.stringify({ storageVersion: 99, current: initial() })],
    ['incompatible', rawCurrent({ ...initial(), examId: 'other-exam' })],
  ] as const)('classifies %s current independently and preserves its bytes', (status, raw) => {
    const histories = [summary(completedAttempt('independent'))];
    const store = memory([
        [currentKey, raw],
        [historyKey, rawHistory(histories)],
      ]),
      repo = new AttemptRepository(() => store);
    const read = repo.read(poc),
      before = new Map(store.values);
    expect(read.persistence.current.status).toBe(status);
    expect(read.history).toEqual(histories);
    expect(repo.save(poc, initial(), read.history, read.persistence).status).toBe('blocked');
    expect(store.values).toEqual(before);
  });
  it.each(['current', 'history', 'factory'] as const)(
    'keeps unavailable %s distinct from missing and blocks official persistence',
    (failed) => {
      const store = memory([
        [currentKey, rawCurrent(initial())],
        [historyKey, rawHistory([summary(completedAttempt())])],
      ]);
      store.getItem.mockImplementation((key) => {
        if (key === (failed === 'current' ? currentKey : historyKey))
          throw new Error('SecurityError');
        return store.values.get(key) ?? null;
      });
      const repo = new AttemptRepository(() => {
        if (failed === 'factory') throw new Error('SecurityError');
        return store;
      });
      const read = repo.read(poc),
        target = failed === 'current' ? read.persistence.current : read.persistence.history;
      expect(target).toMatchObject({ status: 'unavailable', raw: undefined });
      if (failed === 'current') expect(read.history).toHaveLength(1);
      if (failed === 'history') expect(read.current).toEqual(initial());
      if (failed === 'factory') expect(read.persistence.current.status).toBe('unavailable');
      expect(repo.save(poc, initial(), read.history, read.persistence).status).toBe('blocked');
      expect(store.setItem).not.toHaveBeenCalled();
    },
  );
  it.each(['partial', 'unknown-version', 'unknown-field', 'metadata', 'v3-missing-mode'] as const)(
    'preserves %s history bytes through permitted current-only mutation or block',
    (kind) => {
      const valid = summary(completedAttempt('valid')),
        { mode: _mode, ...v2 } = valid;
      const raw =
        kind === 'unknown-version'
          ? JSON.stringify({ storageVersion: 99, history: [valid] })
          : kind === 'unknown-field'
            ? JSON.stringify({ storageVersion: 3, history: [valid], future: true })
            : rawHistory([
                valid,
                kind === 'metadata'
                  ? { ...valid, id: 'bad', result: { ...valid.result, correct: 999 } }
                  : kind === 'v3-missing-mode'
                    ? { ...v2, id: 'bad' }
                    : { id: 'bad' },
              ]);
      const formatted = `\n ${raw} \n`,
        store = memory([
          [currentKey, rawCurrent(initial())],
          [historyKey, formatted],
        ]);
      const repo = new AttemptRepository(() => store),
        read = repo.read(poc);
      expect(read.persistence.history.status).toBe(
        kind === 'unknown-version' || kind === 'metadata' ? 'incompatible' : 'corrupt',
      );
      expect(read.history.map((h) => h.id)).toEqual(kind === 'unknown-version' ? [] : ['valid']);
      const next = transition(poc, read.current!, { type: 'navigate', index: 1 });
      const saved = repo.save(poc, next, read.history, read.persistence);
      expect(saved.status).toBe('saved');
      expect(store.values.get(historyKey)).toBe(formatted);
      const before = new Map(store.values);
      expect(
        repo.save(
          poc,
          transition(poc, next, { type: 'finish', now: '2026-10-03T12:00:00.000Z' }),
          saved.history,
          saved.persistence,
        ).status,
      ).toBe('blocked');
      expect(store.values).toEqual(before);
      store.values.set(historyKey, 'foreign');
      expect(repo.save(poc, next, saved.history, saved.persistence).status).toBe('conflict');
    },
  );
  it('preserves completed current and partial history when a new start requires consolidation', () => {
    const done = completedAttempt('done');
    const mixed = rawHistory([summary(completedAttempt('valid')), { id: 'unknown' }]);
    const store = memory([
        [currentKey, rawCurrent(done)],
        [historyKey, mixed],
      ]),
      repo = new AttemptRepository(() => store);
    const read = repo.read(poc),
      before = new Map(store.values);
    expect(repo.save(poc, initial(), read.history, read.persistence).status).toBe('blocked');
    expect(store.values).toEqual(before);
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it.each(['current-invalid', 'embedded-partial'] as const)(
    'reads legacy v1 regions independently with %s',
    (kind) => {
      const done = completedAttempt('embedded');
      const raw = ` ${JSON.stringify({
        storageVersion: 1,
        current:
          kind === 'current-invalid'
            ? { ...legacyAttempt(initial()), examId: 'other' }
            : legacyAttempt(initial()),
        history: [legacyAttempt(done), ...(kind === 'embedded-partial' ? [{ id: 'unknown' }] : [])],
      })}\n`;
      const store = memory([[currentKey, raw]]),
        repo = new AttemptRepository(() => store),
        read = repo.read(poc);
      expect(read.history).toEqual([summary(done)]);
      expect(read.current).toEqual(kind === 'current-invalid' ? null : initial());
      const before = new Map(store.values);
      expect(repo.save(poc, read.current ?? initial(), read.history, read.persistence).status).toBe(
        'blocked',
      );
      expect(store.values).toEqual(before);
    },
  );
  it('migrates v2 history without mode only after an explicit guarded completion', () => {
    const old = summary(completedAttempt('old')),
      { mode: _mode, ...legacy } = old;
    const raw = JSON.stringify({ storageVersion: 2, history: [legacy] });
    const store = memory([[historyKey, raw]]),
      repo = new AttemptRepository(() => store),
      read = repo.read(poc);
    expect(read.persistence.history.status).toBe('valid');
    expect(read.history).toEqual([old]);
    expect(store.setItem).not.toHaveBeenCalled();
    const done = transition(poc, initial(), { type: 'finish', now: '2026-10-04T12:00:00.000Z' });
    expect(repo.save(poc, done, read.history, read.persistence).status).toBe('saved');
    expect(JSON.parse(store.values.get(historyKey)!).storageVersion).toBe(3);
  });
  it.each(['current', 'history', 'mutate-then-throw', 'read', 'factory'] as const)(
    'reports %s failure without advancing token, then retries only its own unchanged snapshot',
    (failure) => {
      const legacy = storageFixtureJson({
        storageVersion: 1,
        current: initial(),
        history: [completedAttempt('legacy')],
      });
      const store = memory([[currentKey, legacy]]);
      let unavailable = false;
      const repo = new AttemptRepository(() => {
        if (unavailable) throw new Error('SecurityError');
        return store;
      });
      const read = repo.read(poc),
        before = new Map(store.values);
      const original = (key: string, value: string) => {
        store.values.set(key, value);
      };
      if (failure === 'read')
        store.getItem.mockImplementationOnce(() => {
          throw new Error('SecurityError');
        });
      else if (failure === 'factory') unavailable = true;
      else
        store.setItem.mockImplementation((key, value) => {
          if (
            (failure === 'history' && key === historyKey) ||
            (failure !== 'history' && key === currentKey && value !== legacy)
          ) {
            if (failure === 'mutate-then-throw') store.values.set(key, value);
            throw new Error('QuotaExceededError');
          }
          original(key, value);
        });
      const saved = repo.save(poc, read.current!, read.history, read.persistence);
      expect(saved.status).toBe('storage-error');
      expect(saved.persistence).toBe(read.persistence);
      expect(store.values).toEqual(before);
      unavailable = false;
      store.setItem.mockImplementation(original);
      expect(repo.save(poc, read.current!, read.history, read.persistence).status).toBe('saved');
      expect(
        JSON.parse(store.values.get(historyKey)!).history.map((h: { id: string }) => h.id),
      ).toEqual(['legacy']);
    },
  );
  it.each(['foreign', 'rollback-write-fails', 'missing-remove'] as const)(
    'reports incomplete rollback (%s) and blocks reuse of the uncertain token',
    (kind) => {
      const store = memory(kind === 'missing-remove' ? [] : [[currentKey, rawCurrent(initial())]]);
      const adapter =
        kind === 'missing-remove' ? { getItem: store.getItem, setItem: store.setItem } : store;
      const repo = new AttemptRepository(() => adapter),
        read = repo.read(poc);
      const before = store.values.get(currentKey);
      store.setItem.mockImplementation((key, value) => {
        if (key === historyKey) {
          if (kind === 'foreign') store.values.set(currentKey, 'foreign-winner');
          throw new Error('quota');
        }
        if (kind === 'rollback-write-fails' && value === before) throw new Error('rollback failed');
        store.values.set(key, value);
      });
      const done = transition(poc, initial(), { type: 'finish', now: '2026-10-03T12:00:00.000Z' });
      const saved = repo.save(poc, done, read.history, read.persistence);
      expect(saved).toMatchObject({ status: 'storage-error', rollbackComplete: false });
      expect(saved.persistence).toBe(read.persistence);
      if (kind === 'foreign') expect(store.values.get(currentKey)).toBe('foreign-winner');
      const after = new Map(store.values);
      expect(repo.save(poc, done, read.history, read.persistence).status).toBe('blocked');
      expect(store.values).toEqual(after);
    },
  );
  it('acknowledges removal of known valid empty history without a false permanent conflict', () => {
    const store = memory([
      [currentKey, rawCurrent(initial())],
      [historyKey, rawHistory([])],
    ]);
    const repo = new AttemptRepository(() => store),
      read = repo.read(poc);
    store.values.delete(historyKey);
    const next = transition(poc, read.current!, {
      type: 'answer',
      questionId: first.id,
      value: 'option-1',
    });
    const saved = repo.save(poc, next, read.history, read.persistence);
    expect(saved.status).toBe('saved');
    expect(saved.history).toEqual([]);
    expect(saved.persistence.history).toMatchObject({ status: 'missing', raw: null });
    expect(store.values.has(historyKey)).toBe(false);
  });
  it.each(['access', 'observed-conflict'] as const)(
    'classifies %s during transaction checks without adopting foreign data',
    (kind) => {
      const store = memory([[currentKey, rawCurrent(initial())]]),
        repo = new AttemptRepository(() => store),
        read = repo.read(poc);
      const before = new Map(store.values);
      let historyReads = 0;
      store.getItem.mockImplementation((key) => {
        if (key === historyKey) {
          historyReads++;
          if (kind === 'access' && historyReads === 4) throw new Error('SecurityError');
          if (kind === 'observed-conflict' && historyReads === 3)
            store.values.set(historyKey, 'foreign-history');
        }
        return store.values.get(key) ?? null;
      });
      const next = transition(poc, read.current!, {
        type: 'answer',
        questionId: first.id,
        value: 'option-1',
      });
      const saved = repo.save(poc, next, read.history, read.persistence);
      expect(saved.status).toBe(kind === 'access' ? 'storage-error' : 'conflict');
      expect(saved.persistence).toBe(read.persistence);
      expect(store.values.get(currentKey)).toBe(before.get(currentKey));
      if (kind === 'access') {
        expect(saved.rollbackComplete).toBe(true);
        expect(store.values).toEqual(before);
        expect(repo.save(poc, next, read.history, read.persistence).status).toBe('saved');
      } else expect(store.values.get(historyKey)).toBe('foreign-history');
    },
  );
});

describe('F1: retenção cronológica compartilhada', () => {
  const recent = () =>
    Array.from({ length: HISTORY_LIMIT }, (_, i) =>
      summary(
        completedAttempt(
          `recent-${i}`,
          i === 0 ? 20 : 0,
          `2026-10-04T10:${String(i).padStart(2, '0')}:00.000Z`,
        ),
      ),
    );
  it('current antigo não desloca nenhuma das 20 conclusões posteriores, incluindo 100%', () => {
    const current = completedAttempt('old', 0),
      history = recent();
    const before = structuredClone({ current, history });
    const result = includeCurrent(current, history);
    expect(result).toEqual([...history].reverse());
    expect(result).toHaveLength(HISTORY_LIMIT);
    expect(result.some((entry) => entry.result.percentage === 100)).toBe(true);
    expect({ current, history }).toEqual(before);
  });
  it('current dentro dos 20 mais recentes aparece uma vez com precedência de conteúdo', () => {
    const current = completedAttempt('recent-10', 10, '2026-10-04T10:10:00.000Z');
    const result = includeCurrent(current, recent());
    expect(result).toHaveLength(HISTORY_LIMIT);
    expect(result.filter((entry) => entry.id === current.id)).toEqual([summary(current)]);
  });
  it('current mais recente vai para o topo e remove somente a conclusão mais antiga', () => {
    const current = completedAttempt('latest', 10, '2026-10-04T11:00:00.000Z');
    const result = includeCurrent(current, recent());
    expect(result[0]).toEqual(summary(current));
    expect(result.map((entry) => entry.id)).toEqual([
      'latest',
      ...recent()
        .slice(1)
        .reverse()
        .map((entry) => entry.id),
    ]);
  });
  it('current e history semanticamente iguais são deduplicados, incluindo outras duplicatas', () => {
    const current = completedAttempt('same', 10);
    const item = summary(current);
    expect(includeCurrent(current, [item, structuredClone(item)])).toEqual([item]);
  });
  it('empates preservam explicitamente current e depois a ordem original dos IDs únicos', () => {
    const current = completedAttempt('current', 1);
    const history = ['b', 'a', 'b'].map((id) => summary(completedAttempt(id, 1)));
    expect(includeCurrent(current, history).map((entry) => entry.id)).toEqual([
      'current',
      'b',
      'a',
    ]);
  });
  it('current aberto normaliza history fora de ordem sem mutação ou prioridade artificial', () => {
    const history = recent();
    const shuffled = [history[5]!, ...history.slice(0, 5), ...history.slice(6), history[5]!];
    const before = structuredClone(shuffled);
    expect(includeCurrent(createAttempt(poc), shuffled)).toEqual([...history].reverse());
    expect(shuffled).toEqual(before);
  });
});
