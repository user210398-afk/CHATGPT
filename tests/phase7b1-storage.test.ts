import { memory, finished } from './phase7b1-fixtures';
import { describe, expect, it, vi } from 'vitest';
import { createAttempt, transition } from '../src/engine/exam-state';
import {
  AttemptRepository,
  storageKey,
  historyStorageKey,
  summary,
  currentV2EnvelopeSchema,
  historyV2EnvelopeSchema,
  previousEnvelopeSchema,
} from '../src/engine/persistence';
import {
  ReviewRepository,
  reviewStorageKey,
  reviewEnvelopeSchema,
  readReviewSummary,
  sameAttemptAcademic,
} from '../src/engine/review-history';
import {
  defaultUiPreferences,
  readUiPreferences,
  saveUiPreferences,
  uiPreferencesKey,
  uiPreferencesV1Schema,
} from '../src/engine/ui-preferences';
import { storageFixtureJson } from './legacy-fixtures';
import { poc, first, firstEssay } from './fixtures';
import { catalogExam } from './catalog-fixtures';
const now = '2026-10-03T10:00:00.000Z',
  end = '2026-10-03T11:00:00.000Z';
describe('frozen contracts and in-memory-only normalization', () => {
  it.each([1, 2, 3])('reads current v%i without writes, saves v3 on action', (storageVersion) => {
    const current = finished();
    const raw = storageFixtureJson(
      storageVersion === 1
        ? { storageVersion, current, history: [current] }
        : { storageVersion, current },
    );
    const history = storageFixtureJson({ storageVersion: 2, history: [summary(current)] });
    const store = memory([
      [storageKey(poc), raw],
      [historyStorageKey(poc), history],
    ]);
    const repo = new AttemptRepository(() => store),
      read = repo.load(poc);
    expect(read).toMatchObject({ restored: true, current, history: [summary(current)] });
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.values.get(storageKey(poc))).toBe(raw);
    const action = transition(poc, read.current, { type: 'navigate', index: 1 });
    repo.save(poc, action, read.history);
    expect(JSON.parse(store.values.get(storageKey(poc))!).storageVersion).toBe(3);
  });
  it('v1/v2 frozen schemas reject v3 fields', () => {
    const current = finished();
    expect(currentV2EnvelopeSchema.safeParse({ storageVersion: 2, current }).success).toBe(false);
    expect(
      previousEnvelopeSchema.safeParse({ storageVersion: 1, current, history: [] }).success,
    ).toBe(false);
    expect(
      historyV2EnvelopeSchema.safeParse({ storageVersion: 2, history: [summary(current)] }).success,
    ).toBe(false);
  });
  it('repository read does not even create an attempt before the mode choice', () => {
    const store = memory(),
      uuid = vi.spyOn(crypto, 'randomUUID');
    expect(new AttemptRepository(() => store).read(poc).current).toBeNull();
    expect(uuid).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
    uuid.mockRestore();
  });
  it('v1 preferences normalize to v2/ask without writes and explicit save preserves fields', () => {
    const { attemptModePreference: _mode, ...preferences } = defaultUiPreferences;
    const legacy = {
      ...preferences,
      storageVersion: 1,
      theme: 'dark',
      contrast: 'high',
      density: 'compact',
      textSize: 'large',
      reduceMotion: true,
      enhancedFocus: true,
      setupPrompt: 'dismissed',
    };
    expect(uiPreferencesV1Schema.safeParse(legacy).success).toBe(true);
    const raw = JSON.stringify(legacy),
      store = memory([[uiPreferencesKey, raw]]);
    const read = readUiPreferences(() => store);
    expect(read.preferences).toEqual({
      ...legacy,
      storageVersion: 2,
      attemptModePreference: 'ask',
    });
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.values.get(uiPreferencesKey)).toBe(raw);
    expect(
      saveUiPreferences({ ...read.preferences, attemptModePreference: 'study' }, () => store),
    ).toBeNull();
    expect(readUiPreferences(() => store).preferences).toEqual({
      ...read.preferences,
      attemptModePreference: 'study',
    });
  });
});
describe('review capture, retention, collisions and safe flags', () => {
  it.each(['exam', 'study'] as const)(
    'captures %s once, restores and preserves academic fields on flag/reload',
    (mode) => {
      const current = finished(mode),
        store = memory([[storageKey(poc), JSON.stringify({ storageVersion: 3, current })]]);
      const repo = new ReviewRepository(() => store);
      repo.capture(poc, current);
      repo.capture(poc, current);
      expect(store.setItem).toHaveBeenCalledTimes(1);
      const before = repo.load(poc, current.id);
      expect(before).toEqual(current);
      const marked = repo.toggleFlag(poc, before, firstEssay.id);
      expect(marked.flagged).toEqual([firstEssay.id]);
      expect(sameAttemptAcademic(marked, before)).toBe(true);
      expect(marked.answers).toEqual(before.answers);
      expect(marked.confirmedQuestionIds).toEqual(before.confirmedQuestionIds);
      expect(marked.result).toEqual(before.result);
      expect(repo.load(poc, current.id)).toEqual(marked);
      const storedCurrent = JSON.parse(store.values.get(storageKey(poc))!).current;
      const archived = JSON.parse(store.values.get(reviewStorageKey(poc))!).attempts[0];
      expect(storedCurrent).toEqual(archived);
      const unmarked = repo.toggleFlag(poc, marked, firstEssay.id);
      expect(unmarked.flagged).toEqual([]);
      expect(repo.load(poc, current.id)).toEqual(unmarked);
    },
  );
  it('legacy concluded current is visible without capture writes; explicit flag captures and migrates', () => {
    const current = finished(),
      raw = storageFixtureJson({ storageVersion: 1, current, history: [] });
    const store = memory([[storageKey(poc), raw]]),
      repo = new ReviewRepository(() => store);
    expect(readReviewSummary(catalogExam, () => store).attempts).toEqual([current]);
    expect(repo.load(poc, current.id)).toEqual(current);
    expect(store.setItem).not.toHaveBeenCalled();
    repo.toggleFlag(poc, current, first.id);
    expect(JSON.parse(store.values.get(storageKey(poc))!).storageVersion).toBe(3);
    expect(JSON.parse(store.values.get(reviewStorageKey(poc))!).attempts).toHaveLength(1);
  });
  it('historical flags change only archive; current and compact history stay byte-identical', () => {
    const old = finished(),
      current = createAttempt(poc, end, 'new', 'study');
    const historyRaw = JSON.stringify({ storageVersion: 3, history: [summary(old)] });
    const store = memory([
        [storageKey(poc), JSON.stringify({ storageVersion: 3, current })],
        [historyStorageKey(poc), historyRaw],
      ]),
      repo = new ReviewRepository(() => store);
    repo.capture(poc, old);
    store.setItem.mockClear();
    const before = store.values.get(storageKey(poc));
    let changed = repo.toggleFlag(poc, repo.load(poc, old.id), first.id);
    expect(store.setItem.mock.calls.map(([key]) => key)).toEqual([reviewStorageKey(poc)]);
    expect(repo.load(poc, old.id).flagged).toEqual([first.id]);
    changed = repo.toggleFlag(poc, changed, first.id);
    expect(changed.flagged).toEqual([]);
    expect(store.values.get(storageKey(poc))).toBe(before);
    expect(store.values.get(historyStorageKey(poc))).toBe(historyRaw);
  });
  it('retains 20 latest, sorting out-of-order completions before retention', () => {
    const store = memory(),
      repo = new ReviewRepository(() => store);
    for (let i = 20; i >= 0; i--)
      repo.capture(poc, {
        ...finished('exam', `a-${i}`),
        completedAt: `2026-10-04T10:${String(i).padStart(2, '0')}:00.000Z`,
      });
    const archived = reviewEnvelopeSchema.parse(
      JSON.parse(store.values.get(reviewStorageKey(poc))!),
    ).attempts;
    expect(archived).toHaveLength(20);
    expect(archived[0]!.id).toBe('a-20');
    expect(archived.at(-1)!.id).toBe('a-1');
  });
  it('restart capture checks the current even when the archived snapshot is already identical', () => {
    const current = finished(),
      store = memory([[storageKey(poc), JSON.stringify({ storageVersion: 3, current })]]),
      repo = new ReviewRepository(() => store);
    repo.capture(poc, current);
    store.setItem.mockClear();
    store.values.set(
      storageKey(poc),
      JSON.stringify({ storageVersion: 3, current: createAttempt(poc, end, 'another-tab') }),
    );
    const before = [...store.values];
    expect(() => repo.capture(poc, current, true)).toThrow('Tentativa atual mudou');
    expect([...store.values]).toEqual(before);
    expect(store.setItem).not.toHaveBeenCalled();
    store.values.set(
      storageKey(poc),
      JSON.stringify({ storageVersion: 3, current: { ...current, flagged: [first.id] } }),
    );
    expect(() => repo.capture(poc, current)).toThrow('Tentativa atual mudou');
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('keeps an older completed current visible with 20 newer snapshots and blocks loss on restart/flag', () => {
    const current = finished(),
      archive = Array.from({ length: 20 }, (_, i) => ({
        ...finished('exam', `newer-${i}`),
        completedAt: `2026-10-04T10:${String(i).padStart(2, '0')}:00.000Z`,
      }));
    const store = memory([
        [storageKey(poc), JSON.stringify({ storageVersion: 3, current })],
        [reviewStorageKey(poc), JSON.stringify({ storageVersion: 1, attempts: archive })],
      ]),
      repo = new ReviewRepository(() => store);
    const before = [...store.values];
    expect(readReviewSummary(catalogExam, () => store).attempts).toHaveLength(21);
    expect(repo.load(poc, current.id)).toEqual(current);
    expect(() => repo.capture(poc, current, true)).toThrow('limite de revisão');
    expect(() => repo.toggleFlag(poc, current, first.id)).toThrow('limite de revisão');
    expect([...store.values]).toEqual(before);
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it.each(['open', 'result', 'invalid', 'duplicate', 'unknown-version', 'unknown-key'] as const)(
    'rejects invalid capture/archive %s without repair',
    (kind) => {
      const store = memory(),
        repo = new ReviewRepository(() => store),
        current = finished();
      if (kind === 'open') expect(() => repo.capture(poc, createAttempt(poc, now))).toThrow();
      else if (kind === 'result')
        expect(() => repo.capture(poc, { ...current, result: null })).toThrow();
      else {
        const raw = JSON.stringify(
          kind === 'invalid'
            ? { storageVersion: 1, attempts: [{ ...current, answers: { absent: 'answer' } }] }
            : kind === 'duplicate'
              ? { storageVersion: 1, attempts: [current, current] }
              : kind === 'unknown-version'
                ? { storageVersion: 99, attempts: [] }
                : { storageVersion: 1, attempts: [], unexpected: true },
        );
        store.values.set(reviewStorageKey(poc), raw);
        expect(() => repo.capture(poc, current)).toThrow();
        expect(store.values.get(reviewStorageKey(poc))).toBe(raw);
      }
      expect(store.setItem).not.toHaveBeenCalled();
    },
  );
  it('flag-only divergence is reconciled; academic collision refuses to overwrite', () => {
    const current = finished(),
      store = memory([[storageKey(poc), JSON.stringify({ storageVersion: 3, current })]]),
      repo = new ReviewRepository(() => store);
    repo.capture(poc, current);
    store.values.set(
      reviewStorageKey(poc),
      JSON.stringify({ storageVersion: 1, attempts: [{ ...current, flagged: [firstEssay.id] }] }),
    );
    const next = repo.toggleFlag(poc, current, first.id);
    expect(JSON.parse(store.values.get(reviewStorageKey(poc))!).attempts[0].flagged).toEqual(
      next.flagged,
    );
    const other = transition(poc, createAttempt(poc, now, current.id, 'exam'), {
      type: 'finish',
      now: end,
    });
    store.values.set(
      reviewStorageKey(poc),
      JSON.stringify({ storageVersion: 1, attempts: [other] }),
    );
    store.setItem.mockClear();
    expect(() => repo.toggleFlag(poc, next, first.id)).toThrow('Conflito real');
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it.each([1, 2])('flag write %i failure restores current and review raw bytes', (failure) => {
    const current = finished(),
      store = memory([[storageKey(poc), JSON.stringify({ storageVersion: 3, current })]]),
      repo = new ReviewRepository(() => store);
    repo.capture(poc, current);
    const before = [...store.values];
    let writes = 0;
    store.setItem.mockImplementation((key, value) => {
      store.values.set(key, value);
      if (++writes === failure) throw new Error('quota');
    });
    expect(() => repo.toggleFlag(poc, current, first.id)).toThrow('foram restauradas');
    expect([...store.values]).toEqual(before);
  });
  it('missing archive second-write failure removes newly created key and preserves legacy bytes', () => {
    const current = finished(),
      raw = storageFixtureJson({ storageVersion: 2, current });
    const store = memory([[storageKey(poc), raw]]),
      repo = new ReviewRepository(() => store);
    store.setItem.mockImplementation((key, value) => {
      if (key === reviewStorageKey(poc)) throw new Error('quota');
      store.values.set(key, value);
    });
    expect(() => repo.toggleFlag(poc, current, first.id)).toThrow('foram restauradas');
    expect([...store.values]).toEqual([[storageKey(poc), raw]]);
  });
  it('stale UI flags abort; concurrency during writes rolls back without overwriting foreign data', () => {
    const current = finished(),
      store = memory([[storageKey(poc), JSON.stringify({ storageVersion: 3, current })]]),
      repo = new ReviewRepository(() => store);
    repo.capture(poc, current);
    const marked = repo.toggleFlag(poc, current, first.id);
    store.setItem.mockClear();
    expect(() => repo.toggleFlag(poc, current, first.id)).toThrow('concorrência');
    expect(store.setItem).not.toHaveBeenCalled();
    const beforeCurrent = store.values.get(storageKey(poc));
    store.setItem.mockImplementation((key, value) => {
      store.values.set(key, value);
      if (key === storageKey(poc) && value !== beforeCurrent)
        store.values.set(reviewStorageKey(poc), 'foreign-change');
    });
    expect(() => repo.toggleFlag(poc, marked, first.id)).toThrow();
    expect(store.values.get(storageKey(poc))).toBe(beforeCurrent);
    expect(store.values.get(reviewStorageKey(poc))).toBe('foreign-change');
  });
  it('rollback failure is reported explicitly', () => {
    const current = finished(),
      raw = JSON.stringify({ storageVersion: 3, current }),
      store = memory([[storageKey(poc), raw]]),
      repo = new ReviewRepository(() => store);
    repo.capture(poc, current);
    store.setItem.mockImplementation((key, value) => {
      if (key === reviewStorageKey(poc) || value === raw) throw new Error('blocked');
      store.values.set(key, value);
    });
    expect(() => repo.toggleFlag(poc, current, first.id)).toThrow('rollback ficou incompleto');
  });
});
