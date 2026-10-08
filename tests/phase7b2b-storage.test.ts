import { describe, expect, it, vi } from 'vitest';
import {
  ReviewSessionRepository,
  readReviewSessionSummary,
  reviewSessionStorageKey,
} from '../src/engine/review-session-storage';
import { transitionReviewSession } from '../src/engine/review-session';
import { ReviewRepository, reviewStorageKey } from '../src/engine/review-history';
import {
  storageKey,
  historyStorageKey,
  summary,
  AttemptRepository,
} from '../src/engine/persistence';
import { readExamProgress } from '../src/engine/catalog-progress';
import {
  aggregateGlobalMetrics,
  aggregateSubjects,
  recentActivity,
} from '../src/engine/dashboard-metrics';
import { confirmHistoryReset, prepareHistoryReset } from '../src/engine/history-reset';
import { catalogPreferencesKey } from '../src/engine/catalog-preferences';
import {
  uiPreferencesKey,
  defaultUiPreferences,
  legacyThemeKey,
} from '../src/engine/ui-preferences';
import { createAttempt, transition } from '../src/engine/exam-state';
import {
  all,
  end,
  memory,
  objective,
  session,
  source,
  tiny,
  tinyCatalog,
} from './phase7b2b-fixtures';
import { legacyAttempt } from './legacy-fixtures';
import { readExamCatalog } from '../scripts/catalog';
const currentRaw = (current = source()) => JSON.stringify({ storageVersion: 3, current });
function seeded() {
  return memory([[storageKey(tiny), currentRaw()]]);
}
function saved() {
  return JSON.stringify({ storageVersion: 1, session: session() });
}
describe('review session separate persistence', () => {
  it.each(['exam', 'study'] as const)(
    'red team: entire %s lifecycle mutates only source flags, including a Study source',
    (mode) => {
      const original = {
        ...source(),
        mode: 'study' as const,
        confirmedQuestionIds: Object.keys(source().answers),
        currentIndex: 2,
      };
      const store = memory([[storageKey(tiny), currentRaw(original)]]);
      const official = new ReviewRepository(() => store),
        repo = new ReviewSessionRepository(() => store);
      let started = repo.start(tiny, original, all, mode, null);
      let state = started.session;
      for (const q of tiny.questions) {
        const value = q.type === 'essay' ? 'entirely new response' : q.correctAnswer;
        state = transitionReviewSession(tiny, state, { type: 'answer', questionId: q.id, value });
        if (mode === 'study')
          state = transitionReviewSession(tiny, state, {
            type: 'confirm-answer',
            questionId: q.id,
          });
        started.raw = repo.save(tiny, state, started.raw);
      }
      expect(store.values.get(storageKey(tiny))).toBe(currentRaw(original));
      const marked = official.toggleFlag(tiny, original, tiny.questions[2]!.id);
      const { flagged: _before, ...before } = original,
        { flagged: _after, ...after } = marked;
      expect(after).toEqual(before);
      const restored = official.toggleFlag(tiny, marked, tiny.questions[2]!.id);
      expect(restored).toEqual(original);
      repo.save(
        tiny,
        transitionReviewSession(tiny, state, { type: 'finish', now: new Date().toISOString() }),
        started.raw,
      );
      expect(JSON.parse(store.values.get(storageKey(tiny))!)).toEqual({
        storageVersion: 3,
        current: original,
      });
      expect(JSON.parse(store.values.get(reviewStorageKey(tiny))!).attempts[0]).toEqual(original);
    },
  );
  it.each([1, 2])(
    'red team: source flags preserve legacy v%s academic fields and embedded history',
    (version) => {
      const original = source(),
        historical = source('legacy-history');
      const envelope = {
        storageVersion: version,
        current: legacyAttempt(original),
        ...(version === 1 ? { history: [legacyAttempt(historical)] } : {}),
      };
      const store = memory([[storageKey(tiny), JSON.stringify(envelope)]]);
      const before = readExamProgress(tinyCatalog.exams[0]!, () => store).progress;
      const repo = new ReviewRepository(() => store);
      const marked = repo.toggleFlag(tiny, repo.load(tiny, original.id), objective.id);
      expect(JSON.parse(store.values.get(storageKey(tiny))!)).toEqual({
        ...(version === 1 ? envelope : { storageVersion: 3, current: marked }),
        ...(version === 1 ? { current: { ...envelope.current, flagged: marked.flagged } } : {}),
      });
      expect(readExamProgress(tinyCatalog.exams[0]!, () => store).progress).toEqual(before);
      const restored = repo.toggleFlag(tiny, marked, objective.id);
      expect(restored).toEqual({ ...original, flagged: [...marked.flagged, objective.id] });
      expect(JSON.parse(store.values.get(storageKey(tiny))!)).toEqual({
        ...(version === 1 ? envelope : { storageVersion: 3, current: restored }),
        ...(version === 1 ? { current: { ...envelope.current, flagged: restored.flagged } } : {}),
      });
    },
  );
  it('read, summary and restore never write and use exact key', () => {
    const store = memory([[reviewSessionStorageKey(tiny), saved()]]),
      repo = new ReviewSessionRepository(() => store);
    expect(reviewSessionStorageKey(tiny)).toBe(`chatgpt-exams:v1:${tiny.id}:r1:review-session`);
    expect(repo.read(tiny).session).toEqual(session());
    expect(readReviewSessionSummary(tinyCatalog.exams[0]!, () => store).session).toEqual(session());
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.removeItem).not.toHaveBeenCalled();
  });
  it('start writes only session, save and completed restore preserve domain', () => {
    const store = seeded(),
      repo = new ReviewSessionRepository(() => store);
    const started = repo.start(tiny, source(), all, 'exam', null);
    expect(store.setItem.mock.calls.map(([key]) => key)).toEqual([reviewSessionStorageKey(tiny)]);
    const done = transitionReviewSession(tiny, started.session, {
      type: 'finish',
      now: new Date().toISOString(),
    });
    const raw = repo.save(tiny, done, started.raw);
    expect(repo.read(tiny)).toEqual({ session: done, raw });
    expect(store.values.get(storageKey(tiny))).toBe(currentRaw());
    expect(store.values.has(historyStorageKey(tiny))).toBe(false);
  });
  it('active session is never overwritten without explicit discard consent', () => {
    const store = seeded(),
      repo = new ReviewSessionRepository(() => store);
    const started = repo.start(tiny, source(), all, 'study', null);
    expect(() => repo.start(tiny, source(), all, 'exam', started.raw)).toThrow('em andamento');
    expect(store.values.get(reviewSessionStorageKey(tiny))).toBe(started.raw);
    expect(repo.start(tiny, source(), all, 'exam', started.raw, true).session.id).not.toBe(
      started.session.id,
    );
  });
  it('completed session can be explicitly replaced', () => {
    const store = seeded(),
      repo = new ReviewSessionRepository(() => store);
    const done = transitionReviewSession(tiny, session(), { type: 'finish', now: end });
    const raw = JSON.stringify({ storageVersion: 1, session: done });
    store.values.set(reviewSessionStorageKey(tiny), raw);
    expect(repo.start(tiny, source(), all, 'study', raw).session.id).not.toBe(done.id);
  });
  it('discard deletes only session and source remains byte-identical', () => {
    const store = seeded();
    store.values.set(reviewSessionStorageKey(tiny), saved());
    new ReviewSessionRepository(() => store).discard(tiny, saved());
    expect(store.values.has(reviewSessionStorageKey(tiny))).toBe(false);
    expect(store.values.get(storageKey(tiny))).toBe(currentRaw());
  });
  it.each([
    '{bad',
    JSON.stringify({ storageVersion: 9, session: session() }),
    JSON.stringify({ storageVersion: 1, session: { ...session(), examRevision: 2 } }),
  ])('corrupted/incompatible raw preserved %#', (raw) => {
    const store = seeded();
    store.values.set(reviewSessionStorageKey(tiny), raw);
    const repo = new ReviewSessionRepository(() => store);
    expect(() => repo.read(tiny)).toThrow();
    expect(() => repo.start(tiny, source(), all, 'exam', raw)).toThrow();
    expect(readReviewSessionSummary(tinyCatalog.exams[0]!, () => store).warning).toBeTruthy();
    expect(store.values.get(reviewSessionStorageKey(tiny))).toBe(raw);
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it.each(['save', 'discard', 'start'] as const)(
    'concurrent session update rejects %s preserving other writer',
    (action) => {
      const store = seeded();
      store.values.set(reviewSessionStorageKey(tiny), 'other');
      const repo = new ReviewSessionRepository(() => store);
      expect(() =>
        action === 'save'
          ? repo.save(tiny, session(), saved())
          : action === 'discard'
            ? repo.discard(tiny, saved())
            : repo.start(tiny, source(), all, 'exam', saved(), true),
      ).toThrow();
      expect(store.values.get(reviewSessionStorageKey(tiny))).toBe('other');
    },
  );
  it('save does not recreate reset/deleted state', () => {
    const repo = new ReviewSessionRepository(() => memory());
    expect(() => repo.save(tiny, session(), null)).toThrow('removida');
    expect(() => repo.save(tiny, session(), saved())).toThrow('concorrência');
  });
  it.each(['mode', 'questionIds', 'sourceAttemptId', 'selection'] as const)(
    'immutable creation field %s',
    (field) => {
      const store = seeded(),
        repo = new ReviewSessionRepository(() => store),
        state = session();
      store.values.set(reviewSessionStorageKey(tiny), saved());
      const next =
        field === 'mode'
          ? { ...state, mode: 'study' as const }
          : field === 'questionIds'
            ? { ...state, questionIds: [objective.id] }
            : field === 'selection'
              ? { ...state, selection: { kind: 'flagged' as const } }
              : { ...state, sourceAttemptId: 'different' };
      expect(() => repo.save(tiny, next, saved())).toThrow();
      expect(store.values.get(reviewSessionStorageKey(tiny))).toBe(saved());
    },
  );
  it('source concurrency rejects new selection without official writes', () => {
    const store = seeded();
    store.values.set(storageKey(tiny), currentRaw({ ...source(), flagged: [] }));
    expect(() =>
      new ReviewSessionRepository(() => store).start(tiny, source(), all, 'exam', null),
    ).toThrow('fonte mudou');
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('source flag toggles remain academic immutable and detect concurrent flags', () => {
    const store = seeded(),
      repo = new ReviewRepository(() => store),
      original = source();
    const marked = repo.toggleFlag(tiny, original, objective.id);
    const { flagged: _old, ...before } = original,
      { flagged: _new, ...after } = marked;
    expect(after).toEqual(before);
    expect(marked.flagged).not.toContain(objective.id);
    expect(() => repo.toggleFlag(tiny, original, objective.id)).toThrow('concorrência');
    expect(JSON.parse(store.values.get(reviewStorageKey(tiny))!).attempts[0]).toEqual(marked);
  });
  it.each([1, 5, 20])(
    'creating and completing %s sessions never changes any official metric',
    (count) => {
      const store = seeded(),
        repo = new ReviewSessionRepository(() => store),
        exam = tinyCatalog.exams[0]!;
      const snap = () => [{ exam, ...readExamProgress(exam, () => store) }];
      const metrics = () => ({
        progress: snap(),
        global: aggregateGlobalMetrics(snap()),
        subjects: aggregateSubjects(snap()),
        recent: recentActivity(snap()),
      });
      const before = metrics();
      let raw: string | null = null;
      for (let i = 0; i < count; i++) {
        const started = repo.start(tiny, source(), all, 'exam', raw);
        raw = repo.save(
          tiny,
          transitionReviewSession(tiny, started.session, {
            type: 'finish',
            now: new Date().toISOString(),
          }),
          started.raw,
        );
      }
      expect(metrics()).toEqual(before);
      expect(store.values.has(historyStorageKey(tiny))).toBe(false);
      expect(store.values.get(storageKey(tiny))).toBe(currentRaw());
    },
  );
});
describe('safe whole-catalog explicit history reset', () => {
  it.each(['removed', 'foreign answers'])(
    'red team: post-reset %s in the official current aborts stale saving with zero changes',
    (kind) => {
      const ongoing = createAttempt(tiny, '2026-10-05T16:00:00.000Z', 'ongoing');
      const store = memory([
        [storageKey(tiny), currentRaw(ongoing)],
        [
          historyStorageKey(tiny),
          JSON.stringify({ storageVersion: 3, history: [summary(source())] }),
        ],
      ]);
      const repo = new AttemptRepository(() => store),
        open = repo.read(tiny);
      confirmHistoryReset(prepareHistoryReset(tinyCatalog, store), 'ZERAR', store);
      if (kind === 'removed') store.values.delete(storageKey(tiny));
      else
        store.values.set(storageKey(tiny), currentRaw({ ...ongoing, answers: source().answers }));
      const before = new Map(store.values);
      const next = transition(tiny, open.current!, {
        type: 'answer',
        questionId: objective.id,
        value: source().answers[objective.id]!,
      });
      expect(repo.save(tiny, next, open.history, open.persistence).aborted).toBe(true);
      expect(store.values).toEqual(before);
      // A retry from the same stale tab must remain blocked until a fresh read.
      expect(repo.save(tiny, next, open.history, open.persistence).aborted).toBe(true);
      expect(store.values).toEqual(before);
    },
  );
  it('red team: an interrupted own legacy migration remains retryable and is not mistaken for a reset', () => {
    const ongoing = createAttempt(tiny, '2026-10-05T16:00:00.000Z', 'ongoing');
    const store = memory([
      [
        storageKey(tiny),
        JSON.stringify({
          storageVersion: 1,
          current: legacyAttempt(ongoing),
          history: [legacyAttempt(source())],
        }),
      ],
    ]);
    const repo = new AttemptRepository(() => store),
      open = repo.read(tiny);
    store.setItem
      .mockImplementationOnce((key, value) => {
        store.values.set(key, value);
      })
      .mockImplementationOnce(() => {
        throw new Error('quota');
      });
    expect(repo.save(tiny, open.current!, open.history, open.persistence).warning).toBeTruthy();
    const retry = repo.save(tiny, open.current!, open.history, open.persistence);
    expect(retry.warning).toBeNull();
    expect(retry.history.map((h) => h.id)).toEqual(['source']);
    expect(readExamProgress(tinyCatalog.exams[0]!, () => store).progress.attemptCount).toBe(1);
  });
  it.each(['v3', 'legacy'])(
    'red team: an official %s attempt already open in another tab cannot resurrect reset history',
    (kind) => {
      const ongoing = createAttempt(tiny, '2026-10-05T16:00:00.000Z', 'ongoing');
      const store =
        kind === 'legacy'
          ? memory([
              [
                storageKey(tiny),
                JSON.stringify({
                  storageVersion: 1,
                  current: legacyAttempt(ongoing),
                  history: [legacyAttempt(source())],
                }),
              ],
            ])
          : memory([
              [storageKey(tiny), currentRaw(ongoing)],
              [
                historyStorageKey(tiny),
                JSON.stringify({ storageVersion: 3, history: [summary(source())] }),
              ],
            ]);
      const official = new AttemptRepository(() => store),
        open = official.read(tiny);
      expect(open.history).toHaveLength(1);
      confirmHistoryReset(prepareHistoryReset(tinyCatalog, store), 'ZERAR', store);
      const answered = transition(tiny, open.current!, {
        type: 'answer',
        questionId: objective.id,
        value: source().answers[objective.id]!,
      });
      const saved = official.save(tiny, answered, open.history, open.persistence);
      expect(saved.history).toEqual([]);
      expect(store.getItem(historyStorageKey(tiny))).toBeNull();
      const done = transition(tiny, answered, { type: 'finish', now: end });
      official.save(tiny, done, saved.history, saved.persistence);
      expect(readExamProgress(tinyCatalog.exams[0]!, () => store).progress.attemptCount).toBe(1);
      expect(
        JSON.parse(store.getItem(historyStorageKey(tiny))!).history.map(
          (h: { id: string }) => h.id,
        ),
      ).toEqual(['ongoing']);
    },
  );
  it.each([
    'empty',
    'history',
    'archive',
    'session',
    'completed',
    'ongoing',
    'completed+history',
    'ongoing+history',
  ])('red team: reset with %s as the only local exam state', (kind) => {
    const store = memory(),
      ongoing = createAttempt(tiny, '2026-10-05T16:00:00.000Z', 'ongoing', 'study');
    ongoing.answers[objective.id] = source().answers[objective.id]!;
    ongoing.flagged = [objective.id];
    ongoing.confirmedQuestionIds = [objective.id];
    if (kind.includes('completed')) store.values.set(storageKey(tiny), currentRaw());
    if (kind.includes('ongoing')) store.values.set(storageKey(tiny), currentRaw(ongoing));
    if (kind.includes('history'))
      store.values.set(
        historyStorageKey(tiny),
        JSON.stringify({ storageVersion: 3, history: [summary(source())] }),
      );
    if (kind === 'archive')
      store.values.set(
        reviewStorageKey(tiny),
        JSON.stringify({ storageVersion: 1, attempts: [source()] }),
      );
    if (kind === 'session') store.values.set(reviewSessionStorageKey(tiny), saved());
    store.values.set('unknown', 'unchanged');
    confirmHistoryReset(prepareHistoryReset(tinyCatalog, store), 'ZERAR', store);
    expect(store.values).toEqual(
      new Map([
        ['unknown', 'unchanged'],
        ...(kind.includes('ongoing')
          ? ([[storageKey(tiny), currentRaw(ongoing)]] as [string, string][])
          : []),
      ]),
    );
    expect(readExamProgress(tinyCatalog.exams[0]!, () => store).progress).toMatchObject({
      status: kind.includes('ongoing') ? 'in-progress' : 'not-started',
      attemptCount: 0,
      bestResultPercentage: null,
      lastResultPercentage: null,
    });
  });
  it('red team: corruption only in the last catalog exam aborts with zero mutations', async () => {
    const { catalog } = await readExamCatalog();
    expect(catalog.exams.length).toBeGreaterThan(0);
    const store = memory(
      catalog.exams.flatMap(
        (exam) =>
          [
            [historyStorageKey(exam), '{legacy-or-corrupt-history'],
            [reviewStorageKey(exam), 'archive raw'],
            [reviewSessionStorageKey(exam), 'session raw'],
          ] as [string, string][],
      ),
    );
    store.values.set(storageKey(catalog.exams.at(-1)!), '{bad');
    const before = new Map(store.values);
    expect(() => prepareHistoryReset(catalog, store)).toThrow('Reset abortado');
    expect(store.values).toEqual(before);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.removeItem).not.toHaveBeenCalled();
  });
  it('red team: every catalog key is read before the first reset mutation', async () => {
    const { catalog } = await readExamCatalog();
    const store = memory(catalog.exams.map((exam) => [historyStorageKey(exam), 'history']));
    const allKeys = catalog.exams.flatMap((exam) => [
      storageKey(exam),
      historyStorageKey(exam),
      reviewStorageKey(exam),
      reviewSessionStorageKey(exam),
    ]);
    store.removeItem.mockImplementation((key) => {
      expect(new Set(store.getItem.mock.calls.map(([k]) => k))).toEqual(new Set(allKeys));
      store.values.delete(key);
    });
    confirmHistoryReset(prepareHistoryReset(catalog, store), 'ZERAR', store);
    expect(store.values.size).toBe(0);
  });
  it.each([1, 2])(
    'red team: completed legacy v%s is removed, while ongoing metadata is byte-preserved',
    (version) => {
      const store = memory([
        [
          storageKey(tiny),
          JSON.stringify({
            storageVersion: version,
            current: legacyAttempt(source()),
            ...(version === 1 ? { history: [legacyAttempt(source('old'))] } : {}),
          }),
        ],
      ]);
      confirmHistoryReset(prepareHistoryReset(tinyCatalog, store), 'ZERAR', store);
      expect(store.values.size).toBe(0);
    },
  );
  function setup() {
    const ongoing = createAttempt(tiny, '2026-10-05T16:00:00.000Z', 'in-progress', 'study');
    ongoing.answers[objective.id] = source().answers[objective.id]!;
    ongoing.flagged = [objective.id];
    ongoing.confirmedQuestionIds = [objective.id];
    const store = memory([
      [storageKey(tiny), currentRaw(ongoing)],
      [
        historyStorageKey(tiny),
        JSON.stringify({ storageVersion: 3, history: [summary(source())] }),
      ],
      [reviewStorageKey(tiny), JSON.stringify({ storageVersion: 1, attempts: [source()] })],
      [reviewSessionStorageKey(tiny), saved()],
      [catalogPreferencesKey, JSON.stringify({ storageVersion: 1, favorites: [tiny.id] })],
      [uiPreferencesKey, JSON.stringify(defaultUiPreferences)],
      [legacyThemeKey, 'theme-raw'],
      ['foreign', 'untouched'],
    ]);
    return { store, ongoing };
  }
  it('prepare remains read-only including counts', () => {
    const { store } = setup(),
      before = [...store.values];
    expect(prepareHistoryReset(tinyCatalog, store)).toMatchObject({
      completed: 1,
      sessions: 1,
      preserved: 1,
    });
    expect([...store.values]).toEqual(before);
    expect(store.removeItem).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it.each(['', 'zerar', 'Zerar', ' ZERAR', 'ZERAR ', 'ZERAR\n'])(
    'rejects non-exact strong confirmation %j',
    (confirmation) => {
      const { store } = setup(),
        before = [...store.values];
      expect(() =>
        confirmHistoryReset(prepareHistoryReset(tinyCatalog, store), confirmation, store),
      ).toThrow('exatamente ZERAR');
      expect([...store.values]).toEqual(before);
    },
  );
  it('removes histories/reviews/session and preserves current, favorites, UI/theme and unknown bytes', () => {
    const { store, ongoing } = setup(),
      before = new Map(store.values);
    const result = confirmHistoryReset(prepareHistoryReset(tinyCatalog, store), 'ZERAR', store);
    expect(result).toEqual({ completed: 1, sessions: 1, preserved: 1 });
    for (const key of [
      storageKey(tiny),
      catalogPreferencesKey,
      uiPreferencesKey,
      legacyThemeKey,
      'foreign',
    ])
      expect(store.values.get(key)).toBe(before.get(key));
    for (const key of [
      historyStorageKey(tiny),
      reviewStorageKey(tiny),
      reviewSessionStorageKey(tiny),
    ])
      expect(store.values.has(key)).toBe(false);
    expect(JSON.parse(store.values.get(storageKey(tiny))!).current).toEqual(ongoing);
    expect(readExamProgress(tinyCatalog.exams[0]!, () => store).progress).toMatchObject({
      status: 'in-progress',
      attemptCount: 0,
      bestResultPercentage: null,
      lastResultPercentage: null,
    });
  });
  it('completed current removed and exam becomes not-started', () => {
    const store = seeded();
    confirmHistoryReset(prepareHistoryReset(tinyCatalog, store), 'ZERAR', store);
    expect(store.values.size).toBe(0);
    expect(readExamProgress(tinyCatalog.exams[0]!, () => store).progress).toMatchObject({
      status: 'not-started',
      attemptCount: 0,
    });
  });
  it.each([1, 2])(
    'legacy current v%s ongoing normalizes only during reset and embedded history cannot survive',
    (version) => {
      const { store, ongoing } = setup(),
        old = JSON.stringify({
          storageVersion: version,
          current: legacyAttempt(ongoing),
          ...(version === 1 ? { history: [legacyAttempt(source())] } : {}),
        });
      store.values.set(storageKey(tiny), old);
      const plan = prepareHistoryReset(tinyCatalog, store);
      expect(store.values.get(storageKey(tiny))).toBe(old);
      confirmHistoryReset(plan, 'ZERAR', store);
      expect(JSON.parse(store.values.get(storageKey(tiny))!)).toEqual({
        storageVersion: 3,
        current: { ...ongoing, mode: 'exam', confirmedQuestionIds: [] },
      });
      expect(readExamProgress(tinyCatalog.exams[0]!, () => store).progress.attemptCount).toBe(0);
    },
  );
  it.each([
    '{bad',
    JSON.stringify({ storageVersion: 3, current: { ...source(), examRevision: 2 } }),
    JSON.stringify({ storageVersion: 3, current: { ...source(), completedAt: null } }),
  ])('corrupt or incompatible current aborts everything %#', (raw) => {
    const { store } = setup();
    store.values.set(storageKey(tiny), raw);
    const before = [...store.values];
    expect(() => prepareHistoryReset(tinyCatalog, store)).toThrow('Reset abortado');
    expect([...store.values]).toEqual(before);
  });
  it('explicit reset includes corrupted histories, reviews and sessions but never corrupt current', () => {
    const { store } = setup();
    for (const key of [
      historyStorageKey(tiny),
      reviewStorageKey(tiny),
      reviewSessionStorageKey(tiny),
    ])
      store.values.set(key, '{bad');
    confirmHistoryReset(prepareHistoryReset(tinyCatalog, store), 'ZERAR', store);
    expect(store.values.has(reviewSessionStorageKey(tiny))).toBe(false);
  });
  it('no partial reset after intermediate removal failure', () => {
    const { store } = setup(),
      before = new Map(store.values);
    store.removeItem
      .mockImplementationOnce((key) => {
        store.values.delete(key);
      })
      .mockImplementationOnce(() => {
        throw new Error('blocked');
      });
    expect(() =>
      confirmHistoryReset(prepareHistoryReset(tinyCatalog, store), 'ZERAR', store),
    ).toThrow('restauradas');
    expect(store.values).toEqual(before);
  });
  it('concurrency during confirmation preserves updated ongoing current and every history', () => {
    const { store } = setup(),
      plan = prepareHistoryReset(tinyCatalog, store);
    store.values.set(storageKey(tiny), 'foreign');
    const before = new Map(store.values);
    expect(() => confirmHistoryReset(plan, 'ZERAR', store)).toThrow('concorrência');
    expect(store.values).toEqual(before);
  });
  it('blocked storage reads abort before mutation', () => {
    const { store } = setup();
    store.getItem = vi.fn(() => {
      throw new Error('unavailable');
    });
    expect(() => prepareHistoryReset(tinyCatalog, store)).toThrow();
    expect(store.removeItem).not.toHaveBeenCalled();
  });
});
