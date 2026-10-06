import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionClickArbiter, OPTION_CLICK_WINDOW_MS } from '../src/engine/option-click-arbiter';
import {
  scratchSchema,
  emptyScratch,
  parseScratch,
  readScratch,
  saveScratch,
  scratchStorageKey,
  MAX_SCRATCH_RAW_LENGTH,
} from '../src/engine/solver-scratch';
import { exam, questionId, scope, memory } from './phase8a-fixtures';
const q = exam.questions[0]!;
if (q.type !== 'multiple-choice') throw new Error('fixture');
const a = q.options[0]!.id,
  b = q.options[1]!.id;
afterEach(() => vi.useRealTimers());
describe('scratch isolated session state', () => {
  it('red team: valid academic ID constructor is never an inherited option list', () => {
    const inheritedExam = { ...exam, questions: [{ ...q, id: 'constructor' }] },
      store = memory();
    const read = readScratch(inheritedExam, scope, () => store);
    const next = saveScratch(inheritedExam, scope, read, 'constructor', a, true, {}, () => store);
    expect(next.value.questions.constructor).toEqual([a]);
  });
  it.each(['attempt', 'review-session'] as const)(
    'zero-write read, same scope reload, new %s scope isolated',
    (kind) => {
      const store = memory(),
        currentScope = { ...scope, kind };
      const read = readScratch(exam, currentScope, () => store);
      expect(store.writes).toEqual([]);
      const saved = saveScratch(exam, currentScope, read, questionId, a, true, {}, () => store);
      expect(readScratch(exam, currentScope, () => store)).toEqual(saved);
      expect(
        readScratch(exam, { ...currentScope, id: 'fresh' }, () => store).value.questions,
      ).toEqual({});
      expect(
        readScratch(
          exam,
          { ...currentScope, kind: kind === 'attempt' ? 'review-session' : 'attempt' },
          () => store,
        ).value.questions,
      ).toEqual({});
    },
  );
  it.each(['{bad', '[]', '{}', 'x'.repeat(MAX_SCRATCH_RAW_LENGTH + 1)])(
    'preserves incompatible raw %#',
    (raw) => {
      const store = memory();
      store.values.set(scratchStorageKey(exam, scope), raw);
      const read = readScratch(exam, scope, () => store);
      expect(read.blocked).toBe(true);
      expect(() => saveScratch(exam, scope, read, questionId, a, true, {}, () => store)).toThrow();
      expect(store.writes).toEqual([]);
      expect(store.values.get(scratchStorageKey(exam, scope))).toBe(raw);
    },
  );
  it.each([
    { scopeId: 'other' },
    { kind: 'review-session' },
    { examId: 'other' },
    { examRevision: 99 },
    { questions: { unknown: ['a'] } },
    { questions: { [questionId]: ['unknown'] } },
    { questions: { [questionId]: [a, a] } },
    { answers: {} },
    { storageVersion: 2 },
  ])('strict scope/academic refs/fields %#', (patch) => {
    expect(() =>
      parseScratch(exam, scope, JSON.stringify({ ...emptyScratch(exam, scope), ...patch })),
    ).toThrow();
  });
  it('selected cannot be eliminated; mutation prunes selected options across all questions', () => {
    const store = memory();
    const read = readScratch(exam, scope, () => store);
    expect(() =>
      saveScratch(exam, scope, read, questionId, a, true, { [questionId]: a }, () => store),
    ).toThrow(/Selecione outra/);
    const saved = saveScratch(exam, scope, read, questionId, a, true, {}, () => store);
    const next = saveScratch(
      exam,
      scope,
      saved,
      questionId,
      b,
      true,
      { [questionId]: a },
      () => store,
    );
    expect(next.value.questions[questionId]).toEqual([b]);
    expect(
      saveScratch(exam, scope, next, questionId, b, false, {}, () => store).value.questions,
    ).toEqual({});
  });
  it('schema rejects official domain contamination', () =>
    expect(scratchSchema.safeParse({ ...emptyScratch(exam, scope), current: {} }).success).toBe(
      false,
    ));
  it.each(['setItem', 'removeItem'] as const)(
    'failure %s does not touch official state',
    (method) => {
      const store = memory();
      store.values.set('official', 'unchanged');
      const read = readScratch(exam, scope, () => store);
      store.setItem = (key, raw) => {
        if (method === 'removeItem') store.values.set(key, raw);
        throw new Error('quota');
      };
      if (method === 'removeItem')
        store.removeItem = () => {
          throw new Error('blocked');
        };
      expect(() => saveScratch(exam, scope, read, questionId, a, true, {}, () => store)).toThrow();
      expect(store.values.get('official')).toBe('unchanged');
    },
  );
  it('concurrent session writer is preserved without claiming cross-tab synchronization', () => {
    const store = memory(),
      read = readScratch(exam, scope, () => store);
    store.values.set(scratchStorageKey(exam, scope), 'concurrent');
    expect(() => saveScratch(exam, scope, read, questionId, a, true, {}, () => store)).toThrow();
    expect(store.values.get(scratchStorageKey(exam, scope))).toBe('concurrent');
  });
});
describe('body click arbiter', () => {
  it('red team: a 450ms double click cancels without an intermediate answer', () => {
    vi.useFakeTimers();
    const arbiter = new OptionClickArbiter(),
      answer = vi.fn(),
      toggle = vi.fn();
    arbiter.click('scope:q:A', 1, answer, toggle);
    vi.advanceTimersByTime(450);
    arbiter.click('scope:q:A', 2, answer, toggle);
    vi.runAllTimers();
    expect(answer).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it('single answers once only after exact 600ms', () => {
    vi.useFakeTimers();
    const arbiter = new OptionClickArbiter(),
      answer = vi.fn(),
      toggle = vi.fn();
    arbiter.click('scope:q:A', 1, answer, toggle);
    vi.advanceTimersByTime(OPTION_CLICK_WINDOW_MS - 1);
    expect(answer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(answer).toHaveBeenCalledTimes(1);
  });
  it.each([2, 3, 4])('double/triple/higher detail=%i never answers or toggles twice', (detail) => {
    vi.useFakeTimers();
    const arbiter = new OptionClickArbiter(),
      answer = vi.fn(),
      toggle = vi.fn();
    arbiter.click('scope:q:A', 1, answer, toggle);
    arbiter.click('scope:q:A', 2, answer, toggle);
    arbiter.click('scope:q:A', detail, answer, toggle);
    vi.runAllTimers();
    expect(answer).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it('later double restores; no timer created for higher detail', () => {
    vi.useFakeTimers();
    const arbiter = new OptionClickArbiter(),
      answer = vi.fn(),
      toggle = vi.fn();
    arbiter.click('A', 2, answer, toggle);
    vi.advanceTimersByTime(601);
    arbiter.click('A', 1, answer, toggle);
    arbiter.click('A', 2, answer, toggle);
    vi.runAllTimers();
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(answer).not.toHaveBeenCalled();
  });
  it('A→B replaces pending A, never forms a double between options', () => {
    vi.useFakeTimers();
    const arbiter = new OptionClickArbiter(),
      a = vi.fn(),
      b = vi.fn(),
      toggle = vi.fn();
    arbiter.click('A', 1, a, toggle);
    arbiter.click('B', 1, b, toggle);
    vi.runAllTimers();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
  });
  it('pending A→double B cancels A and toggles B once', () => {
    vi.useFakeTimers();
    const arbiter = new OptionClickArbiter(),
      answer = vi.fn(),
      toggle = vi.fn();
    arbiter.click('A', 1, answer, toggle);
    arbiter.click('B', 1, answer, toggle);
    arbiter.click('B', 2, answer, toggle);
    vi.runAllTimers();
    expect(answer).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it.each(['cancel', 'dispose'] as const)('%s drops pending timer', (method) => {
    vi.useFakeTimers();
    const arbiter = new OptionClickArbiter(),
      answer = vi.fn();
    arbiter.click('A', 1, answer, vi.fn());
    arbiter[method]();
    vi.runAllTimers();
    expect(answer).not.toHaveBeenCalled();
  });
});
