import { describe, expect, it, vi } from 'vitest';
import { richTag } from '../schema/exam';
import type { RichText } from '../src/types/exam';
import { projectStatement, validBoundary } from '../src/engine/statement-projection';
import {
  annotationsSchema,
  emptyAnnotations,
  validateAnnotations,
  mutateAnnotations,
  MAX_HIGHLIGHTS_PER_QUESTION,
  MAX_HIGHLIGHTS_PER_EXAM,
  MAX_ANNOTATION_RAW_LENGTH,
} from '../src/engine/question-annotations';
import {
  annotationStorageKey,
  parseAnnotationsRaw,
  readAnnotations,
  saveAnnotationMutation,
} from '../src/engine/question-annotations-storage';
import { exam, questionId, statement, memory, ids } from './phase8a-fixtures';
const paint = (start: number, end: number, color: 'yellow' | 'blue' | 'green' = 'yellow') => ({
  type: 'paint' as const,
  start,
  end,
  color,
});
const highlighted = () =>
  mutateAnnotations(exam, emptyAnnotations(exam), questionId, paint(0, 8), ids());
describe('canonical statement projection', () => {
  it('exact DFS leaves, repetition, blocks, br and deterministic UTF-16 offsets', () => {
    const result = projectStatement(statement);
    expect(result.text).toBe('Igual á Igual 😀 e\u0301𐐀 fim');
    expect(result.length).toBe(result.text.length);
    expect(result.leaves.map((l) => [l.path, l.start, l.end])).toEqual([
      ['0', 0, 8],
      ['1.0', 8, 16],
      ['3.0', 16, 19],
      ['4.0', 19, 21],
      ['5.0', 21, 25],
    ]);
    expect(projectStatement(statement)).toEqual(result);
  });
  it.each(richTag.options)('structure %s contributes zero offsets', (tag) => {
    const content: RichText = [
      { type: 'text', text: 'a' },
      { type: 'element', tag, children: tag === 'br' ? [] : [{ type: 'text', text: 'á😀' }] },
      { type: 'text', text: 'b' },
    ];
    expect(projectStatement(content).text).toBe(tag === 'br' ? 'ab' : 'aá😀b');
  });
  it.each(['á', '😀', '𐐀', 'e\u0301', 'ASCII á 😀 e\u0301 𐐀'])(
    'preserves exact Unicode without normalization: %s',
    (text) => {
      expect(projectStatement([{ type: 'text', text }]).text).toBe(text);
      expect(projectStatement([{ type: 'text', text }]).length).toBe(text.length);
    },
  );
  it('rejects both surrogate cuts, including a pair across leaves; allows combining boundary', () => {
    const projection = projectStatement(statement);
    expect(validBoundary(projection, 15)).toBe(false);
    expect(validBoundary(projection, 20)).toBe(false);
    expect(validBoundary(projection, 18)).toBe(true);
    expect(
      validBoundary(
        projectStatement([
          { type: 'text', text: '\ud83d' },
          { type: 'text', text: '\ude00' },
        ]),
        1,
      ),
    ).toBe(false);
  });
});
describe('strict annotations and mutation algebra', () => {
  it('red team: valid academic ID constructor cannot inherit Object.prototype ranges', () => {
    const inheritedExam = { ...exam, questions: [{ ...exam.questions[0]!, id: 'constructor' }] };
    const value = mutateAnnotations(
      inheritedExam,
      emptyAnnotations(inheritedExam),
      'constructor',
      paint(0, 2),
    );
    expect(value.questions.constructor).toHaveLength(1);
  });
  it.each(['storageVersion', 'examId', 'examRevision', 'questions'])(
    'rejects missing %s',
    (field) => {
      const input: Record<string, unknown> = { ...emptyAnnotations(exam) };
      delete input[field];
      expect(annotationsSchema.safeParse(input).success).toBe(false);
    },
  );
  it('rejects unknown envelope/highlight fields', () => {
    expect(annotationsSchema.safeParse({ ...emptyAnnotations(exam), answers: {} }).success).toBe(
      false,
    );
    expect(() =>
      validateAnnotations(exam, {
        ...highlighted(),
        questions: {
          [questionId]: [{ id: 'id', start: 0, end: 1, color: 'yellow', attemptId: 'foreign' }],
        },
      }),
    ).toThrow();
  });
  it.each([
    { examId: 'unknown' },
    { examRevision: 2 },
    { storageVersion: 2 },
    { questions: { unknown: [] } },
    { questions: { [questionId]: [{ id: 'id', start: -1, end: 2, color: 'yellow' }] } },
    { questions: { [questionId]: [{ id: 'id', start: 2, end: 2, color: 'yellow' }] } },
    { questions: { [questionId]: [{ id: 'id', start: 0, end: 99, color: 'yellow' }] } },
    { questions: { [questionId]: [{ id: 'id', start: 14, end: 15, color: 'yellow' }] } },
    { questions: { [questionId]: [{ id: '', start: 0, end: 1, color: 'yellow' }] } },
    { questions: { [questionId]: [{ id: 'id', start: 0.5, end: 1, color: 'yellow' }] } },
    { questions: { [questionId]: [{ id: 'id', start: 0, end: 1, color: 'red' }] } },
  ])('rejects incompatible envelope %#', (patch) =>
    expect(() => validateAnnotations(exam, { ...emptyAnnotations(exam), ...patch })).toThrow(),
  );
  it('IDs unique across questions, sorted nonoverlap', () => {
    const h = { id: 'same', start: 0, end: 2, color: 'yellow' };
    for (const questions of [
      { [questionId]: [h, h] },
      { [questionId]: [h, { ...h, id: 'other', start: 1 }] },
      {
        [questionId]: [
          { ...h, start: 2, end: 3 },
          { ...h, id: 'other' },
        ],
      },
      { [questionId]: [h], [exam.questions[1]!.id]: [h] },
    ])
      expect(() => validateAnnotations(exam, { ...emptyAnnotations(exam), questions })).toThrow();
  });
  it.each([
    [0, 3],
    [6, 10],
    [3, 5],
    [0, 10],
    [8, 10],
  ])('new color wins only in [%i,%i)', (start, end) => {
    const next = mutateAnnotations(
      exam,
      highlighted(),
      questionId,
      paint(start, end, 'green'),
      () => crypto.randomUUID(),
    );
    const expected = Array.from({ length: 10 }, (_, i) =>
      i >= start && i < end ? 'green' : i < 8 ? 'yellow' : null,
    );
    expect(
      expected.map(
        (_, i) => next.questions[questionId]?.find((h) => h.start <= i && h.end > i)?.color ?? null,
      ),
    ).toEqual(expected);
    expect(validateAnnotations(exam, next)).toEqual(next);
  });
  it.each([
    [0, 3],
    [6, 10],
    [3, 5],
    [0, 10],
  ])('eraser cuts [%i,%i)', (start, end) => {
    const next = mutateAnnotations(exam, highlighted(), questionId, { type: 'erase', start, end });
    for (let i = 0; i < 10; i++)
      expect(next.questions[questionId]?.some((h) => h.start <= i && h.end > i) ?? false).toBe(
        i < 8 && !(i >= start && i < end),
      );
  });
  it('crosses multiple highlights, deterministic split IDs; read never creates IDs', () => {
    const id = ids();
    let value = mutateAnnotations(exam, emptyAnnotations(exam), questionId, paint(0, 4), id);
    value = mutateAnnotations(exam, value, questionId, paint(6, 10, 'blue'), id);
    value = mutateAnnotations(exam, value, questionId, paint(2, 8, 'green'), id);
    expect(value.questions[questionId]).toEqual([
      { id: 'h-3', start: 0, end: 2, color: 'yellow' },
      { id: 'h-5', start: 2, end: 8, color: 'green' },
      { id: 'h-4', start: 8, end: 10, color: 'blue' },
    ]);
    const factory = vi.fn(() => 'bad');
    mutateAnnotations(exam, value, questionId, { type: 'remove', id: 'h-5' }, factory);
    mutateAnnotations(exam, value, questionId, { type: 'clear' }, factory);
    expect(factory).not.toHaveBeenCalled();
    expect(() => mutateAnnotations(exam, value, questionId, paint(1, 3), () => 'h-3')).toThrow();
  });
  it('remove/clear affect only target question', () => {
    const other = exam.questions[1]!.id;
    const value = mutateAnnotations(exam, highlighted(), other, paint(0, 2));
    const next = mutateAnnotations(exam, value, questionId, { type: 'remove', id: 'h-1' });
    expect(next.questions[questionId]).toBeUndefined();
    expect(next.questions[other]).toEqual(value.questions[other]);
    expect(mutateAnnotations(exam, value, questionId, { type: 'clear' })).toEqual(next);
  });
  it('explicit limits bound per-question, per-exam, raw length', () => {
    expect([
      MAX_HIGHLIGHTS_PER_QUESTION,
      MAX_HIGHLIGHTS_PER_EXAM,
      MAX_ANNOTATION_RAW_LENGTH,
    ]).toEqual([200, 4000, 1_000_000]);
    const longExam = {
      ...exam,
      questions: Array.from({ length: 21 }, (_, index) => ({
        ...exam.questions[0]!,
        id: `question-${index}`,
        statement: [{ type: 'text' as const, text: 'x'.repeat(400) }],
      })),
    };
    const ranges = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${prefix}-${i}`,
        start: i,
        end: i + 1,
        color: 'yellow' as const,
      }));
    expect(() =>
      validateAnnotations(longExam, {
        ...emptyAnnotations(longExam),
        questions: { 'question-0': ranges(201, 'h') },
      }),
    ).toThrow();
    expect(() =>
      validateAnnotations(longExam, {
        ...emptyAnnotations(longExam),
        questions: Object.fromEntries(longExam.questions.map((q) => [q.id, ranges(200, q.id)])),
      }),
    ).toThrow();
  });
});
describe('annotation storage defensive writes', () => {
  it('missing and valid reads are zero-write, share revision and isolate new revision', () => {
    const store = memory();
    const read = readAnnotations(exam, () => store);
    expect(store.writes).toEqual([]);
    expect(read.blocked).toBe(false);
    const saved = saveAnnotationMutation(exam, read, questionId, paint(0, 2), () => store, ids());
    expect(readAnnotations({ ...exam }, () => store).value).toEqual(saved.value);
    expect(readAnnotations({ ...exam, revision: 2 }, () => store).value.questions).toEqual({});
    expect(store.writes).toEqual([annotationStorageKey(exam)]);
  });
  it.each([
    '{bad',
    '{}',
    '[]',
    JSON.stringify({ ...emptyAnnotations(exam), storageVersion: 2 }),
    'x'.repeat(MAX_ANNOTATION_RAW_LENGTH + 1),
  ])('bad/oversized raw preserved %#', (raw) => {
    const store = memory();
    store.values.set(annotationStorageKey(exam), raw);
    const snapshot = readAnnotations(exam, () => store);
    expect(snapshot.blocked).toBe(true);
    expect(snapshot.warning).toBeTruthy();
    expect(() =>
      saveAnnotationMutation(exam, snapshot, questionId, paint(0, 2), () => store),
    ).toThrow();
    expect(store.values.get(annotationStorageKey(exam))).toBe(raw);
    expect(store.writes).toEqual([]);
  });
  it('stale writer preserves concurrent raw, blocked corrupt event retains last-known-good', () => {
    const store = memory(),
      snapshot = readAnnotations(exam, () => store);
    const saved = saveAnnotationMutation(exam, snapshot, questionId, paint(0, 2), () => store);
    expect(() =>
      saveAnnotationMutation(exam, snapshot, questionId, paint(3, 5), () => store),
    ).toThrow(/mudaram/);
    expect(store.values.get(annotationStorageKey(exam))).toBe(saved.raw);
    store.values.set(annotationStorageKey(exam), '{bad');
    const corrupt = readAnnotations(exam, () => store, saved);
    expect(corrupt.value).toEqual(saved.value);
    expect(corrupt.blocked).toBe(true);
    expect(store.values.get(annotationStorageKey(exam))).toBe('{bad');
  });
  it('write failure rollback never replaces a concurrent writer', () => {
    const store = memory(),
      snapshot = readAnnotations(exam, () => store);
    const concurrent = JSON.stringify(highlighted());
    store.setItem = (key) => {
      store.values.set(key, concurrent);
      throw new Error('quota');
    };
    expect(() =>
      saveAnnotationMutation(exam, snapshot, questionId, paint(3, 4), () => store),
    ).toThrow();
    expect(store.values.get(annotationStorageKey(exam))).toBe(concurrent);
  });
  it('blocked read access and invalid raw parse never write', () => {
    expect(
      readAnnotations(exam, () => {
        throw new Error('blocked');
      }).blocked,
    ).toBe(true);
    expect(() => parseAnnotationsRaw(exam, '{bad')).toThrow();
  });
});
