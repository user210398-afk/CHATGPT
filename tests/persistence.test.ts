import { describe, expect, it } from 'vitest';
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
    repo.save(poc, state, []);
    expect(repo.load(poc)).toMatchObject({ current: state, restored: true, warning: null });
    state = transition(poc, state, { type: 'finish', now: '2026-10-03T10:20:00.000Z' });
    const saved = repo.save(poc, state, []);
    repo.save(poc, state, saved.history);
    expect(repo.load(poc).history).toEqual([
      {
        id: state.id,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        result: state.result,
      },
    ]);
    const next = createAttempt(poc);
    repo.save(poc, next, saved.history);
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
        JSON.stringify({ storageVersion: 1, current, history: [] }),
      );
      expect(repo.load(poc).restored).toBe(false);
    }
    const finished = transition(poc, fresh, { type: 'finish', now: new Date().toISOString() });
    localStorage.setItem(
      storageKey(poc),
      JSON.stringify({
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
    repo.save(poc, createAttempt(poc), []);
    expect(repo.load({ ...poc, id: 'outra-prova' }).restored).toBe(false);
    expect(repo.load({ ...poc, revision: 2 }).restored).toBe(false);
    expect(localStorage.getItem('simulado_fisio_state')).toBe('preservado');
  });
  it('continua em memória se armazenamento for bloqueado ou exceder quota', () => {
    const repo = new AttemptRepository(() => {
      throw new Error('SecurityError');
    });
    expect(repo.load(poc).warning).toBeTruthy();
    expect(repo.save(poc, createAttempt(poc), []).warning).toBeTruthy();
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
    const saved = repo.save(poc, current, []);
    expect(writes).toEqual([storageKey(poc), historyStorageKey(poc)]);
    expect(values.get(historyStorageKey(poc))).not.toContain('Texto longo');
    expect(JSON.parse(values.get(historyStorageKey(poc))!).history[0]).toEqual({
      id: current.id,
      startedAt: current.startedAt,
      completedAt: current.completedAt,
      result: current.result,
    });
    repo.save(poc, transition(poc, current, { type: 'navigate', index: 1 }), saved.history);
    expect(writes).toEqual([storageKey(poc), historyStorageKey(poc), storageKey(poc)]);
    expect(repo.load(poc).history).toHaveLength(1);
  });
  it('restaura envelope v1 e migra sem perder a tentativa ou histórico', () => {
    const current = createAttempt(poc, '2026-10-03T10:00:00.000Z');
    const completed = transition(poc, current, { type: 'finish', now: '2026-10-03T10:10:00.000Z' });
    localStorage.setItem(
      storageKey(poc),
      JSON.stringify({ storageVersion: 1, current, history: [completed] }),
    );
    const repo = repository();
    const loaded = repo.load(poc);
    expect(loaded).toMatchObject({ restored: true, current, history: [{ id: completed.id }] });
    repo.save(poc, loaded.current, loaded.history);
    expect(JSON.parse(localStorage.getItem(storageKey(poc))!).storageVersion).toBe(2);
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
    repo.save(poc, current, []);
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
      JSON.stringify({ storageVersion: 2, current: completed }),
    );
    localStorage.setItem(
      historyStorageKey(poc),
      JSON.stringify({ storageVersion: 2, history: [] }),
    );
    const repo = repository();
    const loaded = repo.load(poc);
    expect(loaded.history.map((entry) => entry.id)).toEqual([completed.id]);
    repo.save(poc, createAttempt(poc), loaded.history);
    expect(JSON.parse(localStorage.getItem(historyStorageKey(poc))!).history[0].id).toBe(
      completed.id,
    );
  });
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
