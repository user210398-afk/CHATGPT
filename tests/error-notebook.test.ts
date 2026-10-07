import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readErrorNotebook,
  notebookCategories,
  notebookCounts,
  compareNotebookItems,
  filterNotebookItems,
  defaultNotebookFilters,
  aggregateNotebookExam,
  type QuestionPerformance,
} from '../src/engine/error-notebook';
import {
  captureNotebookRaws,
  parseNotebookKey,
  readNotebookSources,
  NOTEBOOK_MAX_RAW_LENGTH,
  NOTEBOOK_MAX_KEYS,
} from '../src/engine/error-notebook-storage';
import { storageKey, historyStorageKey, summary } from '../src/engine/persistence';
import {
  reviewStorageKey,
  ReviewRepository,
  completedReviewAttemptSchema,
  sameAttemptAcademic,
} from '../src/engine/review-history';
import { createAttempt, calculateResult, isCompatibleAttempt } from '../src/engine/exam-state';
import { prepareHistoryReset, confirmHistoryReset } from '../src/engine/history-reset';
import { exportBackup } from '../src/engine/backup';
import { storageFixtureJson } from './legacy-fixtures';
import {
  notebookExam as exam,
  notebookCatalog as catalog,
  notebookAttempt as attempt,
  notebookMemory as memory,
} from './error-notebook-fixtures';

const archive = (attempts: ReturnType<typeof attempt>[]) =>
  JSON.stringify({ storageVersion: 1, attempts });
const current = (value = attempt('incorrect')) =>
  JSON.stringify({ storageVersion: 3, current: value });
async function read(
  store = memory(),
  loader: (id: string, signal?: AbortSignal) => Promise<typeof exam> = vi.fn(async () => exam),
  inputCatalog = catalog,
) {
  const before = [...store.values];
  const result = await readErrorNotebook(inputCatalog, () => store, loader);
  expect(store.setItem).not.toHaveBeenCalled();
  expect(store.removeItem).not.toHaveBeenCalled();
  expect([...store.values]).toEqual(before);
  return result;
}
describe('read-only official sources and outcomes', () => {
  it('zero history: zero loads, zero writes and no UUID', async () => {
    const loader = vi.fn(async () => exam),
      uuid = vi.spyOn(crypto, 'randomUUID');
    const result = await read(memory(), loader);
    expect(result).toMatchObject({
      items: [],
      hasHistory: false,
      attemptCount: 0,
      coverage: 'complete',
    });
    expect(loader).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    uuid.mockRestore();
  });
  it.each([
    [
      ['incorrect'],
      { wrongCount: 1, correctCount: 0, answeredCount: 1, lastOutcome: 'incorrect' },
      { pending: true, recurring: false, 'never-correct': true, overcome: false },
    ],
    [
      ['incorrect', 'correct'],
      { wrongCount: 1, correctCount: 1, answeredCount: 2, lastOutcome: 'correct' },
      { pending: false, recurring: false, 'never-correct': false, overcome: true },
    ],
    [
      ['correct', 'incorrect'],
      { wrongCount: 1, correctCount: 1, answeredCount: 2, lastOutcome: 'incorrect' },
      { pending: true, recurring: false, 'never-correct': false, overcome: false },
    ],
    [
      ['incorrect', 'incorrect'],
      { wrongCount: 2, correctCount: 0, answeredCount: 2, lastOutcome: 'incorrect' },
      { pending: true, recurring: true, 'never-correct': true, overcome: false },
    ],
    [
      ['incorrect', 'incorrect', 'correct'],
      { wrongCount: 2, correctCount: 1, answeredCount: 3, lastOutcome: 'correct' },
      { pending: false, recurring: true, 'never-correct': false, overcome: true },
    ],
    [
      ['incorrect', 'correct', 'unanswered'],
      { wrongCount: 1, correctCount: 1, answeredCount: 2, lastOutcome: 'correct' },
      { pending: false, recurring: false, 'never-correct': false, overcome: true },
    ],
  ] as const)(
    'aggregates %j, preserving overlapping categories',
    async (outcomes, expected, tags) => {
      const snapshots = outcomes.map((outcome, index) => attempt(outcome, `a-${index}`, index + 1));
      const result = await read(memory([[reviewStorageKey(exam), archive(snapshots)]]));
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject(expected);
      const item = result.items[0]!;
      expect(item.answeredCount).toBe(item.correctCount + item.wrongCount);
      expect(notebookCategories(item)).toEqual(tags);
      expect(item.lastAnsweredAttemptId).toBe(
        snapshots[outcomes.length - (outcomes.at(-1) === 'unanswered' ? 2 : 1)]!.id,
      );
      expect(item.firstWrongAttemptCompletedAt).toBe(
        snapshots.find((a) => a.result!.incorrect > 0)!.completedAt,
      );
      expect(notebookCounts(result.items).pending + notebookCounts(result.items).overcome).toBe(1);
    },
  );
  it.each(['exam', 'study'] as const)(
    'valid completed %s enters; flags do not alter outcomes',
    async (mode) => {
      const value = attempt('incorrect', 'a', 1, mode);
      const result = await read(
        memory([[storageKey(exam), current({ ...value, flagged: [exam.questions[0]!.id] })]]),
      );
      expect(result.items[0]).toMatchObject({ wrongCount: 1, answeredCount: 1 });
      expect(result.items[0]!.outcomes[0]!.mode).toBe(mode);
    },
  );
  it('essay and unanswered never produce an outcome', async () => {
    const value = attempt('unanswered');
    value.answers[exam.questions[2]!.id] = 'Minha resposta';
    value.result = calculateResult(exam, value);
    const result = await read(memory([[storageKey(exam), current(value)]]));
    expect(result).toMatchObject({
      items: [],
      attemptCount: 1,
      hasHistory: true,
      coverage: 'complete',
    });
  });
  it('unfinished Study drafts never load an Exam or become outcomes', async () => {
    const draft = createAttempt(exam, '2026-10-01T10:00:00.000Z', 'draft', 'study');
    draft.answers = attempt('incorrect').answers;
    const loader = vi.fn(async () => exam);
    const result = await read(memory([[storageKey(exam), current(draft)]]), loader);
    expect(result.items).toEqual([]);
    expect(result.hasHistory).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });
  it('a new draft does not hide the independent concluded archive', async () => {
    const result = await read(
      memory([
        [storageKey(exam), current(createAttempt(exam))],
        [reviewStorageKey(exam), archive([attempt('incorrect')])],
      ]),
    );
    expect(result.items[0]!.wrongCount).toBe(1);
  });
  it.each(['annotations', 'solver-scratch', 'review-session', 'unknown', 'review:extra'])(
    'ignores %s, even with executable-looking payloads',
    async (suffix) => {
      const loader = vi.fn(async () => exam),
        store = memory([
          [`${storageKey(exam)}:${suffix}`, '<script>globalThis.compromised=true</script>'],
        ]);
      expect((await read(store, loader)).items).toEqual([]);
      expect(loader).not.toHaveBeenCalled();
    },
  );
  it.each([1, 2, 3])('reads current v%i without migration', async (storageVersion) => {
    const value = attempt('incorrect');
    const raw = storageFixtureJson(
      storageVersion === 1
        ? { storageVersion, current: value, history: [] }
        : { storageVersion, current: value },
    );
    expect((await read(memory([[storageKey(exam), raw]]))).items[0]!.wrongCount).toBe(1);
  });
  it('v1 embedded history contributes even when ReviewRepository cannot access it', async () => {
    const old = attempt('incorrect', 'embedded'),
      draft = createAttempt(exam);
    const store = memory([
      [storageKey(exam), storageFixtureJson({ storageVersion: 1, current: draft, history: [old] })],
    ]);
    expect((await read(store)).items[0]!.wrongCount).toBe(1);
    expect(() => new ReviewRepository(() => store).load(exam, old.id)).toThrow();
  });
  it('deduplicates equal current/archive/embedded by academic fields, ignoring flags/index', async () => {
    const value = attempt('incorrect');
    const store = memory([
      [
        storageKey(exam),
        storageFixtureJson({ storageVersion: 1, current: value, history: [value] }),
      ],
      [
        reviewStorageKey(exam),
        archive([{ ...value, flagged: [exam.questions[1]!.id], currentIndex: 1 }]),
      ],
    ]);
    const result = await read(store);
    expect(result.items[0]!.wrongCount).toBe(1);
    expect(result.attemptCount).toBe(1);
    expect(result.warnings).toEqual([]);
  });
  it('academic collisions exclude the ID across all copies and preserve independent Attempts', async () => {
    const value = attempt('incorrect', 'same');
    const result = await read(
      memory([
        [storageKey(exam), current(value)],
        [
          reviewStorageKey(exam),
          archive([attempt('correct', 'same'), attempt('incorrect', 'independent', 2)]),
        ],
      ]),
    );
    expect(result.attemptCount).toBe(1);
    expect(result.items[0]!.outcomes.map((o) => o.attemptId)).toEqual(['independent']);
    expect(result.warnings.some((w) => w.kind === 'conflict')).toBe(true);
  });
  it.each(['duplicate-flags', 'unknown-flag', 'index-out-of-range'] as const)(
    'pre-staging P2: invalid current %s cannot hide an academically equal valid archive',
    async (kind) => {
      const valid = attempt('incorrect', 'same'),
        invalid = {
          ...valid,
          flagged:
            kind === 'duplicate-flags'
              ? [exam.questions[0]!.id, exam.questions[0]!.id]
              : kind === 'unknown-flag'
                ? ['unknown-question']
                : [],
          currentIndex: kind === 'index-out-of-range' ? exam.questions.length : 0,
        };
      expect(completedReviewAttemptSchema.safeParse(invalid).success).toBe(true);
      expect(isCompatibleAttempt(exam, invalid)).toBe(false);
      expect(isCompatibleAttempt(exam, valid)).toBe(true);
      expect(sameAttemptAcademic(invalid, valid)).toBe(true);
      const result = await read(
        memory([
          [storageKey(exam), current(invalid)],
          [reviewStorageKey(exam), archive([valid])],
          [historyStorageKey(exam), JSON.stringify({ storageVersion: 3, history: [summary(valid)] })],
        ]),
      );
      expect(result.attemptCount).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        wrongCount: 1,
        correctCount: 0,
        answeredCount: 1,
        lastOutcome: 'incorrect',
      });
      expect(result.items[0]!.outcomes.map((outcome) => outcome.attemptId)).toEqual(['same']);
      expect(result.coverage).toBe('partial');
      expect(result.warnings.some((warning) => warning.kind === 'invalid-source')).toBe(true);
      expect(result.warnings.some((warning) => warning.kind === 'conflict')).toBe(false);
    },
  );
  it.each(['valid-divergence', 'invalid-answer', 'invalid-result'] as const)(
    'pre-staging P2: %s still excludes the entire same-ID academic conflict',
    async (kind) => {
      const valid = attempt('incorrect', 'same'),
        divergent = attempt('correct', 'same');
      if (kind === 'invalid-answer') divergent.answers[exam.questions[0]!.id] = 'invalid-option';
      if (kind === 'invalid-result') divergent.result!.correct++;
      expect(completedReviewAttemptSchema.safeParse(divergent).success).toBe(true);
      expect(isCompatibleAttempt(exam, divergent)).toBe(kind === 'valid-divergence');
      expect(sameAttemptAcademic(divergent, valid)).toBe(false);
      const result = await read(
        memory([
          [storageKey(exam), current(divergent)],
          [reviewStorageKey(exam), archive([valid])],
        ]),
      );
      expect(result.attemptCount).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.coverage).toBe('partial');
      expect(result.warnings.some((warning) => warning.kind === 'conflict')).toBe(true);
    },
  );
  it('pre-staging P2: no compatible same-ID representation means exclusion without conflict', async () => {
    const value = attempt('incorrect', 'same');
    const result = await read(
      memory([
        [storageKey(exam), current({ ...value, flagged: ['unknown-question'] })],
        [reviewStorageKey(exam), archive([{ ...value, currentIndex: exam.questions.length }])],
      ]),
    );
    expect(result.attemptCount).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.coverage).toBe('partial');
    expect(result.warnings.some((warning) => warning.kind === 'invalid-source')).toBe(true);
    expect(result.warnings.some((warning) => warning.kind === 'conflict')).toBe(false);
  });
  it('pre-staging P2: a conflicting summary still excludes the selected compatible archive', async () => {
    const value = attempt('incorrect', 'same');
    const result = await read(
      memory([
        [storageKey(exam), current({ ...value, currentIndex: exam.questions.length })],
        [reviewStorageKey(exam), archive([value])],
        [
          historyStorageKey(exam),
          JSON.stringify({ storageVersion: 3, history: [summary(attempt('correct', 'same'))] }),
        ],
      ]),
    );
    expect(result.attemptCount).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.coverage).toBe('partial');
    expect(result.warnings.some((warning) => warning.kind === 'invalid-source')).toBe(true);
    expect(result.warnings.some((warning) => warning.kind === 'conflict')).toBe(true);
  });
  it.each([2, 3])(
    'history v%i summaries alone never identify questions or fetch Exams',
    async (storageVersion) => {
      const loader = vi.fn(async () => exam),
        value = attempt('incorrect');
      const result = await read(
        memory([
          [
            historyStorageKey(exam),
            storageFixtureJson({ storageVersion, history: [summary(value)] }),
          ],
        ]),
        loader,
      );
      expect(result).toMatchObject({ items: [], hasHistory: true, coverage: 'partial' });
      expect(loader).not.toHaveBeenCalled();
    },
  );
  it('a consistent summary is coverage, not another outcome; missing summaries warn', async () => {
    const value = attempt('incorrect');
    const result = await read(
      memory([
        [storageKey(exam), current(value)],
        [
          historyStorageKey(exam),
          JSON.stringify({
            storageVersion: 3,
            history: [summary(value), summary(attempt('incorrect', 'retained-summary', 2))],
          }),
        ],
      ]),
    );
    expect(result.items[0]!.wrongCount).toBe(1);
    expect(result.coverage).toBe('partial');
  });
  it.each(['result', 'mode', 'startedAt', 'completedAt'] as const)(
    'summary %s conflict excludes detailed Attempt',
    async (field) => {
      const value = attempt('incorrect'),
        entry = summary(value);
      if (field === 'result') entry.result = attempt('correct').result!;
      else if (field === 'mode') entry.mode = 'study';
      else
        entry[field] =
          field === 'startedAt' ? '2026-10-01T09:00:00.000Z' : '2026-10-01T12:00:00.000Z';
      const result = await read(
        memory([
          [storageKey(exam), current(value)],
          [historyStorageKey(exam), JSON.stringify({ storageVersion: 3, history: [entry] })],
        ]),
      );
      expect(result.items).toEqual([]);
      expect(result.warnings.some((w) => w.kind === 'conflict')).toBe(true);
    },
  );
  it('a structurally valid but inconsistent summary Result still excludes a conflicting same-ID detail', async () => {
    const value = attempt('incorrect'),
      entry = summary(value);
    entry.result = { ...entry.result, incorrect: entry.result.incorrect + 1 };
    const result = await read(
      memory([
        [storageKey(exam), current(value)],
        [historyStorageKey(exam), JSON.stringify({ storageVersion: 3, history: [entry] })],
      ]),
    );
    expect(result.attemptCount).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.warnings.some((warning) => warning.kind === 'conflict')).toBe(true);
    expect(result.coverage).toBe('partial');
  });
});

describe('red-team: integrity, identity, bounded loads and concurrency', () => {
  it.each([
    'json',
    'envelope',
    'examId',
    'revision',
    'questionId',
    'answer',
    'result',
    'study',
    'date',
    'duplicate-flags',
  ])('rejects corrupted current %s without hiding a good archive', async (kind) => {
    const bad = attempt('incorrect', 'bad');
    if (kind === 'examId') bad.examId = 'foreign';
    if (kind === 'revision') bad.examRevision++;
    if (kind === 'questionId') bad.answers.unknown = 'option-1';
    if (kind === 'answer') bad.answers[exam.questions[0]!.id] = 'invalid-option';
    if (kind === 'result') bad.result!.correct++;
    if (kind === 'study') bad.mode = 'study';
    if (kind === 'date') bad.completedAt = '2020-01-01T00:00:00.000Z';
    if (kind === 'duplicate-flags') bad.flagged = [exam.questions[0]!.id, exam.questions[0]!.id];
    const raw =
      kind === 'json'
        ? '{invalid'
        : kind === 'envelope'
          ? JSON.stringify({ storageVersion: 3, current: bad, unexpected: true })
          : current(bad);
    const result = await read(
      memory([
        [storageKey(exam), raw],
        [reviewStorageKey(exam), archive([attempt('incorrect', 'good')])],
      ]),
    );
    expect(result.attemptCount).toBe(1);
    expect(result.items[0]!.outcomes.map((o) => o.attemptId)).toEqual(['good']);
    expect(result.coverage).toBe('partial');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it.each(['json', 'duplicate-identical', 'duplicate-conflict', 'invalid-snapshot'])(
    'invalid review envelope %s excludes the entire source',
    async (kind) => {
      const value = attempt('incorrect', 'bad');
      const raw =
        kind === 'json'
          ? '{broken'
          : kind === 'invalid-snapshot'
            ? archive([value, { ...value, id: 'bad-2', completedAt: null }])
            : archive([
                value,
                kind === 'duplicate-identical' ? value : attempt('correct', value.id),
              ]);
      const result = await read(
        memory([
          [reviewStorageKey(exam), raw],
          [storageKey(exam), current(attempt('incorrect', 'independent'))],
        ]),
      );
      expect(result.attemptCount).toBe(1);
      expect(result.coverage).toBe('partial');
    },
  );
  it('invalid v1 embedded entry excludes the complete current envelope', async () => {
    const result = await read(
      memory([
        [
          storageKey(exam),
          storageFixtureJson({
            storageVersion: 1,
            current: attempt('incorrect'),
            history: [{ ...attempt('incorrect', 'old'), completedAt: null, result: null }],
          }),
        ],
      ]),
    );
    expect(result.items).toEqual([]);
    expect(result.hasHistory).toBe(true);
    expect(result.coverage).toBe('partial');
  });
  it('repeated question/Attempt IDs across Exams remain independent', async () => {
    const other = { ...exam, id: 'other-exam', subject: 'Outra matéria' };
    const loader = vi.fn(async (id: string) => (id === exam.id ? exam : other));
    const result = await read(
      memory([
        [storageKey(exam), current(attempt('incorrect', 'same'))],
        [storageKey(other), current(attempt('incorrect', 'same', 1, 'exam', other))],
      ]),
      loader,
      { ...catalog, exams: [...catalog.exams, { ...catalog.exams[0]!, id: other.id }] },
    );
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.examId)).toEqual([exam.id, other.id].sort());
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('old revisions and removed exams are historical only; identity is validated against keys', async () => {
    const older = { ...exam, revision: exam.revision + 1 },
      removed = { ...exam, id: 'removed-exam' };
    const loader = vi.fn(async () => exam),
      store = memory([
        [storageKey(older), current(attempt('incorrect', 'old', 1, 'exam', older))],
        [storageKey(removed), current(attempt('incorrect', 'removed', 1, 'exam', removed))],
      ]);
    const result = await read(store, loader);
    expect(result.items).toEqual([]);
    expect(result.historical).toHaveLength(2);
    expect(result.coverage).toBe('partial');
    expect(loader).not.toHaveBeenCalled();
    store.values.set(storageKey(older), current(attempt('incorrect')));
    expect((await read(store, loader)).historical).toEqual([
      { id: removed.id, revision: removed.revision },
    ]);
  });
  it.each([
    'chatgpt-exams:v1:exam:r0',
    'chatgpt-exams:v1:exam:r01',
    'chatgpt-exams:v1:exam:r1:annotations',
    'chatgpt-exams:v1:exam:r1:review-session',
    'prefix:chatgpt-exams:v1:exam:r1',
    'chatgpt-exams:v1:../exam:r1',
    'chatgpt-exams:v1:exam:r9007199254740992',
    'chatgpt-exams:v1:exam:r1:history:extra',
  ])('strict namespace ignores %s', (key) => expect(parseNotebookKey(key)).toBeNull());
  it('accepts only official exact key families', () => {
    expect(parseNotebookKey(storageKey(exam))).toEqual({
      id: exam.id,
      revision: exam.revision,
      source: 'current',
    });
    expect(parseNotebookKey(reviewStorageKey(exam))!.source).toBe('review');
    expect(parseNotebookKey(historyStorageKey(exam))!.source).toBe('history');
  });
  it('storage accessor/getItem/enumeration throws -> unavailable, never zero errors', async () => {
    for (const storage of [
      () => {
        throw new Error('blocked');
      },
      () => ({
        getItem() {
          throw new Error('blocked');
        },
      }),
      () => ({
        getItem: () => null,
        length: 1,
        key() {
          throw new Error('blocked');
        },
      }),
    ]) {
      const result = await readErrorNotebook(catalog, storage);
      expect(result.coverage).toBe('unavailable');
      expect(result.error).toBeTruthy();
    }
  });
  it('raw/key limits warn rather than silently truncate', async () => {
    expect(
      (await read(memory([[storageKey(exam), ' '.repeat(NOTEBOOK_MAX_RAW_LENGTH + 1)]]))).coverage,
    ).toBe('partial');
    const result = await readErrorNotebook(catalog, () => ({
      getItem: () => null,
      key: () => null,
      length: NOTEBOOK_MAX_KEYS + 1,
    }));
    expect(result.coverage).toBe('unavailable');
  });
  it.each(['current', 'review', 'history', 'historical-new-key'] as const)(
    'retries once on %s raw changes during async load',
    async (source) => {
      const value = attempt('incorrect', 'first'),
        store = memory([[storageKey(exam), current(value)]]);
      const loader = vi.fn(async () => {
        if (source === 'current')
          store.values.set(storageKey(exam), current(attempt('correct', 'second', 2)));
        if (source === 'review')
          store.values.set(reviewStorageKey(exam), archive([attempt('correct', 'second', 2)]));
        if (source === 'history')
          store.values.set(
            historyStorageKey(exam),
            JSON.stringify({
              storageVersion: 3,
              history: [summary(attempt('incorrect', 'summary-only'))],
            }),
          );
        if (source === 'historical-new-key') {
          const older = { ...exam, revision: exam.revision + 1 };
          store.values.set(
            storageKey(older),
            current(attempt('incorrect', 'old', 1, 'exam', older)),
          );
        }
        return exam;
      });
      const result = await readErrorNotebook(catalog, () => store, loader);
      expect(result.coverage).not.toBe('unavailable');
      expect(loader).toHaveBeenCalledTimes(1);
      if (source === 'current') expect(result.items).toEqual([]);
      if (source === 'review') expect(result.items[0]!.lastOutcome).toBe('correct');
      if (source === 'history') expect(result.coverage).toBe('partial');
      if (source === 'historical-new-key') expect(result.historical).toHaveLength(1);
      expect(store.setItem).not.toHaveBeenCalled();
      expect(store.removeItem).not.toHaveBeenCalled();
    },
  );
  it('second change is unavailable, with bounded reads and no loop', async () => {
    const store = memory([[storageKey(exam), current()]]);
    let reads = 0;
    store.getItem.mockImplementation((key) =>
      key === storageKey(exam) ? current(attempt('incorrect', `read-${++reads}`)) : null,
    );
    const loader = vi.fn(async () => exam),
      result = await readErrorNotebook(catalog, () => store, loader);
    expect(result.coverage).toBe('unavailable');
    expect(result.error).toContain('mudaram novamente');
    expect(reads).toBe(4);
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it('at most two concurrent loads; one per candidate; summaries and drafts do not fetch', async () => {
    const exams = Array.from({ length: 5 }, (_, index) => ({ ...exam, id: `exam-${index}` }));
    const input = { ...catalog, exams: exams.map((e) => ({ ...catalog.exams[0]!, id: e.id })) };
    const store = memory(
      exams
        .slice(0, 3)
        .map((e) => [storageKey(e), current(attempt('incorrect', 'a', 1, 'exam', e))]),
    );
    store.values.set(storageKey(exams[3]!), current(createAttempt(exams[3]!)));
    store.values.set(
      historyStorageKey(exams[4]!),
      JSON.stringify({
        storageVersion: 3,
        history: [summary(attempt('incorrect', 'a', 1, 'exam', exams[4]!))],
      }),
    );
    let active = 0,
      max = 0;
    const pending: (() => void)[] = [];
    const loader = vi.fn(async (id: string) => {
      active++;
      max = Math.max(max, active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active--;
      return exams.find((e) => e.id === id)!;
    });
    const promise = readErrorNotebook(input, () => store, loader);
    expect(loader).toHaveBeenCalledTimes(2);
    pending.shift()!();
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
    pending.splice(0).forEach((resolve) => resolve());
    expect((await promise).items).toHaveLength(3);
    expect(max).toBe(2);
    expect(loader.mock.calls.map(([id]) => id)).toEqual(['exam-0', 'exam-1', 'exam-2']);
  });
  it('fetch failure preserves storage and warns', async () => {
    const result = await read(
      memory([[storageKey(exam), current()]]),
      vi.fn(async () => {
        throw new Error('HTTP 404');
      }),
    );
    expect(result.items).toEqual([]);
    expect(result.warnings[0]!.kind).toBe('load');
    expect(result.hasHistory).toBe(true);
  });
  it('loader revision mismatch is never corrected against current data', async () => {
    const result = await read(
      memory([[storageKey(exam), current()]]),
      vi.fn(async () => ({ ...exam, revision: exam.revision + 1 })),
    );
    expect(result.items).toEqual([]);
    expect(result.warnings[0]!.kind).toBe('load');
  });
  it('AbortSignal stops queue and prevents publishing even if the fetcher ignores it', async () => {
    const controller = new AbortController();
    let resolve!: (value: typeof exam) => void;
    const loader = vi.fn(
      () =>
        new Promise<typeof exam>((done) => {
          resolve = done;
        }),
    );
    const promise = readErrorNotebook(
      catalog,
      () => memory([[storageKey(exam), current()]]),
      loader,
      controller.signal,
    );
    controller.abort();
    resolve(exam);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it('timestamps tie by code units (not locale), independent of source order', async () => {
    const values = [attempt('incorrect', 'a'), attempt('correct', 'Z')];
    const left = await read(memory([[reviewStorageKey(exam), archive(values)]])),
      right = await read(memory([[reviewStorageKey(exam), archive([...values].reverse())]]));
    expect(left.items).toEqual(right.items);
    expect(left.items[0]).toMatchObject({
      chronologyTie: true,
      lastAnsweredAttemptId: 'a',
      lastOutcome: 'incorrect',
    });
  });
  it('pre-staging P3: an older tie does not make a unique latest outcome ambiguous', async () => {
    const values = [
      attempt('incorrect', 'a'),
      attempt('correct', 'Z'),
      attempt('correct', 'latest', 5),
    ];
    const left = await read(memory([[reviewStorageKey(exam), archive(values)]])),
      right = await read(memory([[reviewStorageKey(exam), archive([...values].reverse())]]));
    expect(left.items).toEqual(right.items);
    expect(left.items[0]).toMatchObject({
      chronologyTie: false,
      lastAnsweredAttemptId: 'latest',
      lastOutcome: 'correct',
      wrongCount: 1,
      answeredCount: 3,
    });
    expect(notebookCategories(left.items[0]!)).toMatchObject({ overcome: true, pending: false });
  });
  it('pre-staging P3: divergent latest ties remain deterministic when current/archive swap', async () => {
    const wrong = attempt('incorrect', 'a', 5),
      correct = attempt('correct', 'Z', 5);
    const left = await read(
      memory([
        [storageKey(exam), current(wrong)],
        [reviewStorageKey(exam), archive([correct])],
      ]),
    );
    const right = await read(
      memory([
        [storageKey(exam), current(correct)],
        [reviewStorageKey(exam), archive([wrong])],
      ]),
    );
    expect(left.items).toEqual(right.items);
    expect(left.items[0]).toMatchObject({
      chronologyTie: true,
      lastAnsweredAttemptId: 'a',
      lastOutcome: 'incorrect',
    });
    expect(left.items[0]!.outcomes.map((outcome) => outcome.attemptId)).toEqual(['Z', 'a']);
  });
  it('pre-staging P3: equal latest outcomes do not make the last outcome or categories ambiguous', async () => {
    const result = await read(
      memory([
        [reviewStorageKey(exam), archive([attempt('incorrect', 'a'), attempt('incorrect', 'Z')])],
      ]),
    );
    expect(result.items[0]).toMatchObject({
      chronologyTie: false,
      lastAnsweredAttemptId: 'a',
      lastOutcome: 'incorrect',
      wrongCount: 2,
      answeredCount: 2,
    });
  });
});

describe('deterministic filters, comparator and domain preservation', () => {
  const sources = (outcomes: Parameters<typeof attempt>[0][]) => ({
    identity: exam,
    detailed: outcomes.map((o, i) => attempt(o, `a-${i}`, i + 1)),
    summaries: [],
    warnings: [],
    hasHistory: true,
  });
  const item = () => aggregateNotebookExam(exam, sources(['incorrect'])).items[0]!;
  it.each([
    'pending',
    'never-correct',
    'wrongCount',
    'lastWrong',
    'examId',
    'revision',
    'questionId',
  ] as const)('default comparator respects %s', (rule) => {
    const a = item(),
      b = { ...item() };
    if (rule === 'pending') b.lastOutcome = 'correct';
    if (rule === 'never-correct') b.correctCount = 1;
    if (rule === 'wrongCount') a.wrongCount = 2;
    if (rule === 'lastWrong') a.lastWrongAttemptCompletedAt = '2026-10-02T11:00:00.000Z';
    if (rule === 'examId') b.examId = 'zzz';
    if (rule === 'revision') b.examRevision++;
    if (rule === 'questionId') b.questionId = 'zzz';
    expect(compareNotebookItems(a, b)).toBeLessThan(0);
    expect(compareNotebookItems(b, a)).toBeGreaterThan(0);
    expect(compareNotebookItems(a, a)).toBe(0);
  });
  it('filters all categories, real subject and exam conjunctively without writes', () => {
    const items = [
      item(),
      {
        ...aggregateNotebookExam(exam, sources(['incorrect', 'incorrect', 'correct'])).items[0]!,
        examId: 'other',
        subject: 'Other',
      },
    ];
    for (const [category, length] of [
      ['all', 2],
      ['pending', 1],
      ['recurring', 1],
      ['never-correct', 1],
      ['overcome', 1],
    ] as const)
      expect(filterNotebookItems(items, { ...defaultNotebookFilters, category })).toHaveLength(
        length,
      );
    expect(
      filterNotebookItems(items, {
        ...defaultNotebookFilters,
        subject: exam.subject,
        examId: exam.id,
      }),
    ).toEqual([items[0]]);
    expect(
      filterNotebookItems(items, {
        ...defaultNotebookFilters,
        category: 'recurring',
        subject: exam.subject,
      }),
    ).toEqual([]);
  });
  it('retains the union of 20 archive + 20 embedded + current without silent 20 cap', async () => {
    const embedded = Array.from({ length: 20 }, (_, i) => attempt('incorrect', `embedded-${i}`));
    const detailed = Array.from({ length: 20 }, (_, i) => attempt('correct', `archive-${i}`, 2));
    const store = memory([
      [
        storageKey(exam),
        storageFixtureJson({
          storageVersion: 1,
          current: attempt('incorrect', 'current'),
          history: embedded,
        }),
      ],
      [reviewStorageKey(exam), archive(detailed)],
    ]);
    const result = await read(store);
    expect(result.attemptCount).toBe(41);
    expect(result.items[0]).toMatchObject({ wrongCount: 21, correctCount: 20, answeredCount: 41 });
  });
  it('existing ZERAR naturally clears the view; personal raw remains and cannot create errors', async () => {
    const store = memory([
      [storageKey(exam), current()],
      [reviewStorageKey(exam), archive([attempt('incorrect')])],
      [`${storageKey(exam)}:annotations`, '{personal}'],
    ]);
    expect((await read(store)).items).toHaveLength(1);
    confirmHistoryReset(prepareHistoryReset(catalog, store), 'ZERAR', store);
    store.removeItem.mockClear();
    const result = await read(store);
    expect(result.items).toEqual([]);
    expect(result.hasHistory).toBe(false);
    expect(store.values.size).toBe(1);
  });
  it('backup remains v3 without notebook fields/keys; derived read changes no export', async () => {
    const store = memory([[storageKey(exam), current()]]);
    const before = await exportBackup(catalog, store, async () => exam);
    await read(store);
    const after = await exportBackup(catalog, store, async () => exam);
    expect(after.exams).toEqual(before.exams);
    expect(after.version).toBe(3);
    expect(JSON.stringify(after)).not.toMatch(/notebook|QuestionPerformance|wrongCount/);
  });
  it('all protected academic/official domains match the required baseline', async () => {
    expect(
      (
        await promisify(execFile)('git', [
          'diff',
          '--name-only',
          'b09634a87042e18ebf2c31ad598c6ad5e13103d7',
          '--',
          'data/exams/',
          'simulados/',
          'schema/',
          'src/engine/exam-state.ts',
          'src/engine/persistence.ts',
          'src/engine/review-history.ts',
          'src/engine/review-session.ts',
          'src/engine/review-session-storage.ts',
          'src/engine/backup.ts',
          'src/engine/history-reset.ts',
          'src/app/DashboardPage.tsx',
          'src/app/useDashboardState.ts',
          // Analytics v1 explicitly authorizes only these two dashboard UI paths.
          // Keep the baseline and every academic/official domain assertion intact.
          ':(exclude)src/app/DashboardPage.tsx',
          ':(exclude)src/app/useDashboardState.ts',
          '.github/workflows/',
          'package.json',
          'package-lock.json',
          'vite.config.ts',
        ])
      ).stdout.trim(),
    ).toBe('');
    const exams = readdirSync('data/exams')
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(`data/exams/${f}`, 'utf8')));
    const questions = exams.flatMap((e) => e.questions);
    expect([
      exams.length,
      questions.length,
      questions.filter((q) => q.type === 'multiple-choice').length,
      questions.filter((q) => q.type === 'essay').length,
    ]).toEqual([19, 522, 492, 30]);
  });
  it('source reader prefers current metadata then archive then embedded, without persisting', () => {
    const value = attempt('incorrect'),
      marked = { ...value, flagged: [exam.questions[0]!.id] };
    const store = memory([
      [
        storageKey(exam),
        storageFixtureJson({ storageVersion: 1, current: createAttempt(exam), history: [value] }),
      ],
      [reviewStorageKey(exam), archive([marked])],
    ]);
    const source = readNotebookSources(exam, captureNotebookRaws(catalog, store));
    expect(source.detailed[0]!.flagged).toEqual(marked.flagged);
  });
  it('sorting is total across identities even with every priority field tied', () => {
    const a = item();
    const items: QuestionPerformance[] = ['z', 'Z', 'a'].map((questionId) => ({
      ...a,
      questionId,
    }));
    expect(items.sort(compareNotebookItems).map((i) => i.questionId)).toEqual(['Z', 'a', 'z']);
  });
});
