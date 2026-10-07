import { describe, expect, it, vi } from 'vitest';
import {
  annotationsV1Schema,
  annotationsV2Schema,
  emptyAnnotations,
  mutateAnnotations,
  MAX_ANNOTATION_RAW_LENGTH,
} from '../src/engine/question-annotations';
import {
  annotationStorageKey,
  readAnnotations,
  saveAnnotationMutation,
} from '../src/engine/question-annotations-storage';
import { exam, questionId, memory, ids } from './phase8a-fixtures';
const key = annotationStorageKey(exam);
const legacy = () => ({
  storageVersion: 1,
  examId: exam.id,
  examRevision: exam.revision,
  questions: {
    [questionId]: [
      { id: 'old-yellow', start: 0, end: 2, color: 'yellow' },
      { id: 'old-green', start: 3, end: 5, color: 'green' },
      { id: 'old-blue', start: 6, end: 8, color: 'blue' },
    ],
    [exam.questions[1]!.id]: [{ id: 'other', start: 0, end: 2, color: 'blue' }],
  },
});
describe('explicit annotations v1 / v2 compatibility', () => {
  it('frozen v1 rejects red; v2 accepts red and both envelopes remain strict', () => {
    const value = legacy();
    expect(annotationsV1Schema.safeParse(value).success).toBe(true);
    value.questions[questionId]![0]!.color = 'red';
    expect(annotationsV1Schema.safeParse(value).success).toBe(false);
    expect(annotationsV2Schema.safeParse({ ...value, storageVersion: 2 }).success).toBe(true);
    expect(
      annotationsV2Schema.safeParse({ ...value, storageVersion: 2, foreign: true }).success,
    ).toBe(false);
  });
  it.each(['yellow', 'green', 'blue'])(
    'legacy %s read is byte-identical, no writes or IDs',
    (color) => {
      const value = legacy();
      value.questions[questionId] = [{ id: 'stable', start: 0, end: 2, color }];
      const raw = ` \n${JSON.stringify(value, null, 2)}  \n`;
      const store = memory();
      store.values.set(key, raw);
      const id = vi.spyOn(crypto, 'randomUUID');
      const snapshot = readAnnotations(exam, () => store);
      expect(snapshot.blocked).toBe(false);
      expect(snapshot.raw).toBe(raw);
      expect(snapshot.value.storageVersion).toBe(2);
      expect(snapshot.value.questions[questionId]).toEqual(value.questions[questionId]);
      expect(store.values.get(key)).toBe(raw);
      expect(store.writes).toEqual([]);
      expect(id).not.toHaveBeenCalled();
      id.mockRestore();
    },
  );
  it('first mutation compares original v1 raw and writes v2, preserving every untouched highlight and ID', () => {
    const store = memory(),
      value = legacy(),
      raw = JSON.stringify(value, null, 2);
    store.values.set(key, raw);
    const snapshot = readAnnotations(exam, () => store);
    const id = vi.fn(() => 'new-red');
    const saved = saveAnnotationMutation(
      exam,
      snapshot,
      questionId,
      { type: 'paint', start: 9, end: 12, color: 'red' },
      () => store,
      id,
    );
    expect(JSON.parse(saved.raw!).storageVersion).toBe(2);
    expect(saved.value.questions[questionId]!.slice(0, 3)).toEqual(value.questions[questionId]);
    expect(saved.value.questions[exam.questions[1]!.id]).toEqual(
      value.questions[exam.questions[1]!.id],
    );
    expect(id).toHaveBeenCalledTimes(1);
    expect(store.writes).toEqual([key]);
    expect(readAnnotations(exam, () => store).value).toEqual(saved.value);
  });
  it.each(['clear', 'remove'] as const)(
    'explicit %s on v1 evolves to v2 without generating IDs',
    (type) => {
      const store = memory();
      store.values.set(key, JSON.stringify(legacy()));
      const id = vi.fn(() => 'never');
      const saved = saveAnnotationMutation(
        exam,
        readAnnotations(exam, () => store),
        questionId,
        type === 'clear' ? { type } : { type, id: 'old-green' },
        () => store,
        id,
      );
      expect(saved.value.storageVersion).toBe(2);
      expect(id).not.toHaveBeenCalled();
      expect(saved.value.questions[exam.questions[1]!.id]).toEqual(
        legacy().questions[exam.questions[1]!.id],
      );
    },
  );
  it.each(['yellow', 'green', 'blue', 'red'] as const)('v2 %s reload is zero-write', (color) => {
    const store = memory();
    const value = mutateAnnotations(
      exam,
      emptyAnnotations(exam),
      questionId,
      { type: 'paint', start: 0, end: 8, color },
      ids(),
    );
    const raw = JSON.stringify(value);
    store.values.set(key, raw);
    expect(readAnnotations(exam, () => store).value).toEqual(value);
    expect(store.values.get(key)).toBe(raw);
    expect(store.writes).toEqual([]);
  });
  it.each([1, 2])(
    'corrupt v%i preserved with last-known-good, mutation blocked',
    (storageVersion) => {
      const store = memory();
      store.values.set(key, JSON.stringify(legacy()));
      const previous = readAnnotations(exam, () => store);
      const raw = JSON.stringify({
        ...legacy(),
        storageVersion,
        questions: { [questionId]: [{ id: 'bad', start: 0, end: 999, color: 'red' }] },
      });
      store.values.set(key, raw);
      const blocked = readAnnotations(exam, () => store, previous);
      expect(blocked.blocked).toBe(true);
      expect(blocked.value).toEqual(previous.value);
      expect(() =>
        saveAnnotationMutation(exam, blocked, questionId, { type: 'clear' }, () => store),
      ).toThrow();
      expect(store.values.get(key)).toBe(raw);
      expect(store.writes).toEqual([]);
    },
  );
  it.each([1, 2])(
    'oversized valid-looking v%i blocks before parsing and preserves raw',
    (storageVersion) => {
      const store = memory();
      const raw =
        JSON.stringify({ ...legacy(), storageVersion }) + ' '.repeat(MAX_ANNOTATION_RAW_LENGTH);
      store.values.set(key, raw);
      const snapshot = readAnnotations(exam, () => store);
      expect(snapshot.blocked).toBe(true);
      expect(() =>
        saveAnnotationMutation(exam, snapshot, questionId, { type: 'clear' }, () => store),
      ).toThrow();
      expect(store.values.get(key)).toBe(raw);
      expect(store.writes).toEqual([]);
    },
  );
  it('stale v1 migration aborts before IDs/write and preserves concurrent v2', () => {
    const store = memory();
    store.values.set(key, JSON.stringify(legacy()));
    const snapshot = readAnnotations(exam, () => store);
    const concurrent = JSON.stringify({ ...legacy(), storageVersion: 2 });
    store.values.set(key, concurrent);
    const id = vi.fn(() => 'never');
    expect(() =>
      saveAnnotationMutation(
        exam,
        snapshot,
        questionId,
        { type: 'paint', start: 9, end: 12, color: 'red' },
        () => store,
        id,
      ),
    ).toThrow(/mudaram/);
    expect(store.values.get(key)).toBe(concurrent);
    expect(store.writes).toEqual([]);
    expect(id).not.toHaveBeenCalled();
  });
  it('red over yellow, yellow over red, partial red erase/split preserves algebra and reload', () => {
    const id = ids();
    let value = mutateAnnotations(
      exam,
      emptyAnnotations(exam),
      questionId,
      { type: 'paint', start: 0, end: 12, color: 'yellow' },
      id,
    );
    value = mutateAnnotations(
      exam,
      value,
      questionId,
      { type: 'paint', start: 2, end: 10, color: 'red' },
      id,
    );
    value = mutateAnnotations(
      exam,
      value,
      questionId,
      { type: 'paint', start: 4, end: 5, color: 'yellow' },
      id,
    );
    value = mutateAnnotations(exam, value, questionId, { type: 'erase', start: 7, end: 8 }, id);
    expect(
      value.questions[questionId]!.map(({ start, end, color }) => [start, end, color]),
    ).toEqual([
      [0, 2, 'yellow'],
      [2, 4, 'red'],
      [4, 5, 'yellow'],
      [5, 7, 'red'],
      [8, 10, 'red'],
      [10, 12, 'yellow'],
    ]);
    const store = memory();
    store.values.set(key, JSON.stringify(value));
    expect(readAnnotations(exam, () => store).value).toEqual(value);
    expect(store.writes).toEqual([]);
  });
});
