import { describe, expect, it } from 'vitest';
import {
  backupV1Schema,
  backupV2Schema,
  confirmImport,
  exportBackup,
  MAX_BACKUP_BYTES,
  parseBackup,
  prepareImport,
  type Backup,
} from '../src/engine/backup';
import { isCompatibleReviewSession, transitionReviewSession } from '../src/engine/review-session';
import { reviewSessionStorageKey } from '../src/engine/review-session-storage';
import { storageKey, historyStorageKey, summary } from '../src/engine/persistence';
import { reviewStorageKey } from '../src/engine/review-history';
import { confirmHistoryReset, prepareHistoryReset } from '../src/engine/history-reset';
import { legacyAttempt, legacyHistory } from './legacy-fixtures';
import { readExamProgress } from '../src/engine/catalog-progress';
import { defaultUiPreferences } from '../src/engine/ui-preferences';
import {
  end,
  memory,
  now,
  objective,
  session,
  source,
  tiny,
  tinyCatalog,
  all,
} from './phase7b2b-fixtures';
const load = async () => tiny;
function input(state = session()): Backup {
  return {
    format: 'medsim-backup',
    version: 3,
    exportedAt: now,
    exams: [
      {
        examId: tiny.id,
        revision: tiny.revision,
        current: null,
        history: [],
        reviewAttempts: [],
        reviewSession: state,
      },
    ],
    catalogPreferences: { storageVersion: 1, favorites: [] },
    uiPreferences: null,
  };
}
function seeded(state = session()) {
  return memory([
    [reviewSessionStorageKey(tiny), JSON.stringify({ storageVersion: 1, session: state })],
  ]);
}
describe('backup v3 separate sessions and frozen v1/v2', () => {
  it.each([
    'exam-active-essay',
    'study-active-essay',
    'exam-completed-essay',
    'study-completed-essay',
    'exam-active-mixed',
    'study-active-mixed',
    'exam-completed-mixed',
    'study-completed-mixed',
  ])('red team: zero-write export/preview and exact session roundtrip: %s', async (kind) => {
    const mode = kind.startsWith('study') ? 'study' : 'exam';
    let state = session(
      mode,
      kind.endsWith('essay')
        ? {
            kind: 'filtered',
            filters: { status: 'essay', flaggedOnly: false, category: '', tag: '' },
          }
        : all,
    );
    for (const q of tiny.questions.filter((q) => state.questionIds.includes(q.id))) {
      state = transitionReviewSession(tiny, state, {
        type: 'answer',
        questionId: q.id,
        value: q.type === 'essay' ? 'new essay' : q.correctAnswer,
      });
      if (mode === 'study')
        state = transitionReviewSession(tiny, state, { type: 'confirm-answer', questionId: q.id });
    }
    state = transitionReviewSession(tiny, state, {
      type: 'navigate',
      index: state.questionIds.length - 1,
    });
    if (kind.includes('completed'))
      state = transitionReviewSession(tiny, state, { type: 'finish', now: end });
    const origin = seeded(state),
      beforeOrigin = new Map(origin.values);
    const backup = await exportBackup(tinyCatalog, origin, load, now);
    expect(origin.values).toEqual(beforeOrigin);
    expect(origin.setItem).not.toHaveBeenCalled();
    const destination = memory([['unknown', 'raw\nbytes']]),
      beforeDestination = new Map(destination.values);
    const plan = await prepareImport(backup, tinyCatalog, destination, load);
    expect(destination.values).toEqual(beforeDestination);
    expect(destination.setItem).not.toHaveBeenCalled();
    expect(destination.removeItem).not.toHaveBeenCalled();
    confirmImport(plan, false, destination);
    expect(JSON.parse(destination.values.get(reviewSessionStorageKey(tiny))!).session).toEqual(
      state,
    );
    expect(destination.getItem(storageKey(tiny))).toBeNull();
    expect(destination.getItem('unknown')).toBe('raw\nbytes');
  });
  it.each([1, 2, 3])(
    'red team: backup v%s -> explicit reset -> preview -> import restores official metrics only',
    async (version) => {
      const store = seeded(session('study'));
      store.values.set(storageKey(tiny), JSON.stringify({ storageVersion: 3, current: source() }));
      store.values.set(
        historyStorageKey(tiny),
        JSON.stringify({ storageVersion: 3, history: [summary(source())] }),
      );
      store.values.set(
        reviewStorageKey(tiny),
        JSON.stringify({ storageVersion: 1, attempts: [source()] }),
      );
      const before = readExamProgress(tinyCatalog.exams[0]!, () => store).progress;
      const exported = await exportBackup(tinyCatalog, store, load, now);
      const input =
        version === 3
          ? exported
          : version === 2
            ? {
                ...exported,
                version: 2 as const,
                exams: exported.exams.map(({ reviewSession: _session, ...entry }) => entry),
              }
            : {
                ...exported,
                version: 1 as const,
                uiPreferences: null,
                exams: exported.exams.map((entry) => ({
                  examId: entry.examId,
                  revision: entry.revision,
                  current: entry.current ? legacyAttempt(entry.current) : null,
                  history: entry.history.map(legacyHistory),
                })),
              };
      confirmHistoryReset(prepareHistoryReset(tinyCatalog, store), 'ZERAR', store);
      expect(readExamProgress(tinyCatalog.exams[0]!, () => store).progress.attemptCount).toBe(0);
      const resetBytes = new Map(store.values);
      const plan = await prepareImport(input, tinyCatalog, store, load);
      expect(store.values).toEqual(resetBytes);
      confirmImport(plan, false, store);
      expect(readExamProgress(tinyCatalog.exams[0]!, () => store).progress).toEqual(before);
      expect(store.getItem(reviewSessionStorageKey(tiny)) !== null).toBe(version === 3);
      expect(readExamProgress(tinyCatalog.exams[0]!, () => store).progress.attemptCount).toBe(1);
    },
  );
  it('exports session-only exam as v3, validates it and does not write', async () => {
    const store = seeded(),
      before = new Map(store.values),
      result = await exportBackup(tinyCatalog, store, load, now);
    expect(result).toEqual({ ...input(), uiPreferences: defaultUiPreferences });
    expect(store.values).toEqual(before);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.removeItem).not.toHaveBeenCalled();
  });
  it.each(['exam', 'study'] as const)(
    'active %s session roundtrip preserves answers and confirmation without official attempts',
    async (mode) => {
      let state = session(mode);
      if (objective.type !== 'multiple-choice') throw new Error('fixture');
      state = transitionReviewSession(tiny, state, {
        type: 'answer',
        questionId: objective.id,
        value: objective.correctAnswer,
      });
      if (mode === 'study')
        state = transitionReviewSession(tiny, state, {
          type: 'confirm-answer',
          questionId: objective.id,
        });
      const backup = parseBackup(
          JSON.stringify(await exportBackup(tinyCatalog, seeded(state), load, now)),
        ),
        destination = memory();
      const plan = await prepareImport(backup, tinyCatalog, destination, load);
      expect(destination.values.size).toBe(0);
      confirmImport(plan, false, destination);
      expect(JSON.parse(destination.values.get(reviewSessionStorageKey(tiny))!).session).toEqual(
        state,
      );
      expect(destination.values.has(storageKey(tiny))).toBe(false);
      expect(readExamProgress(tinyCatalog.exams[0]!, () => destination).progress.attemptCount).toBe(
        0,
      );
    },
  );
  it('completed session also roundtrips with its own result', async () => {
    const state = transitionReviewSession(tiny, session(), { type: 'finish', now: end }),
      store = memory();
    confirmImport(await prepareImport(input(state), tinyCatalog, store, load), false, store);
    expect(JSON.parse(store.values.get(reviewSessionStorageKey(tiny))!).session.result.total).toBe(
      3,
    );
    expect(isCompatibleReviewSession(tiny, state)).toBe(true);
  });
  it('identical local session is no-op with no conflict and zero preview writes', async () => {
    const store = seeded(),
      before = new Map(store.values),
      plan = await prepareImport(input(), tinyCatalog, store, load);
    expect(plan.conflicts).toBe(0);
    expect(plan.changes).toEqual([]);
    expect(store.values).toEqual(before);
    confirmImport(plan, false, store);
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it.each(['different id', 'same id different content'])(
    'real conflict %s preserves local session',
    async (kind) => {
      const incoming =
        kind === 'different id' ? { ...session(), id: 'other' } : { ...session(), currentIndex: 1 };
      const store = seeded(),
        before = new Map(store.values),
        plan = await prepareImport(input(incoming), tinyCatalog, store, load);
      expect(plan.conflicts).toBe(1);
      expect(plan.issues.join(' ')).toContain('Sessão de revisão local preservada');
      confirmImport(plan, false, store);
      expect(store.values).toEqual(before);
    },
  );
  it.each(['{bad', JSON.stringify({ storageVersion: 2, session: session() })])(
    'corrupt local session is preserved %#',
    async (raw) => {
      const store = memory([[reviewSessionStorageKey(tiny), raw]]),
        plan = await prepareImport(input(), tinyCatalog, store, load);
      expect(plan.issues.join(' ')).toContain('dados locais incompatíveis');
      confirmImport(plan, false, store);
      expect(store.values.get(reviewSessionStorageKey(tiny))).toBe(raw);
      await expect(exportBackup(tinyCatalog, store, load, now)).rejects.toThrow(
        'Exportação abortada',
      );
    },
  );
  it.each([
    { examId: 'other' },
    { examRevision: 2 },
    { questionIds: ['missing'] },
    { questionIds: [objective.id], currentIndex: 0, answers: { [objective.id]: 'invalid' } },
  ])('rejects academic incompatibility before preview plan mutations %#', async (patch) => {
    const store = memory(),
      plan = await prepareImport(input({ ...session(), ...patch }), tinyCatalog, store, load);
    expect(plan.issues.join(' ')).toContain('incompatível rejeitado');
    expect(plan.changes).toEqual([]);
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('concurrency after preview aborts import and preserves concurrent session', async () => {
    const store = memory(),
      plan = await prepareImport(input(), tinyCatalog, store, load);
    store.values.set(reviewSessionStorageKey(tiny), 'other');
    expect(() => confirmImport(plan, false, store)).toThrow('concorrência');
    expect(store.values.get(reviewSessionStorageKey(tiny))).toBe('other');
  });
  it('export catches concurrent mutation across asynchronous exam validation', async () => {
    const store = seeded();
    await expect(
      exportBackup(
        tinyCatalog,
        store,
        async () => {
          store.values.set(reviewSessionStorageKey(tiny), 'other');
          return tiny;
        },
        now,
      ),
    ).rejects.toThrow('mudou durante');
  });
  it('readable v2 normalizes to v3 in memory; frozen contract rejects sessions', async () => {
    const v2 = {
      ...input(),
      version: 2 as const,
      exams: [{ examId: tiny.id, revision: 1, current: source(), history: [], reviewAttempts: [] }],
    };
    expect(backupV2Schema.safeParse(v2).success).toBe(true);
    expect(
      backupV2Schema.safeParse({ ...v2, exams: [{ ...v2.exams[0], reviewSession: session() }] })
        .success,
    ).toBe(false);
    const parsed = parseBackup(JSON.stringify(v2));
    expect(parsed.version).toBe(3);
    expect(parsed.exams[0]!.reviewSession).toBeNull();
    const store = seeded(),
      before = new Map(store.values),
      plan = await prepareImport(v2, tinyCatalog, store, load);
    expect(store.values).toEqual(before);
    confirmImport(plan, false, store);
    expect(store.values.get(reviewSessionStorageKey(tiny))).toBe(
      before.get(reviewSessionStorageKey(tiny)),
    );
  });
  it('genuine v1 remains frozen and normalizes with session null', () => {
    const v1 = {
      ...input(),
      version: 1,
      exams: [{ examId: tiny.id, revision: 1, current: null, history: [] }],
    };
    expect(backupV1Schema.safeParse(v1).success).toBe(true);
    expect(parseBackup(JSON.stringify(v1)).exams[0]!.reviewSession).toBeNull();
  });
  it('session schema rejects unknown fields and bounded payloads; 10 MiB file bound remains', () => {
    expect(() =>
      parseBackup(
        JSON.stringify(input({ ...session(), answers: { [objective.id]: 'a'.repeat(200001) } })),
      ),
    ).toThrow('Backup inválido');
    expect(() =>
      parseBackup(
        JSON.stringify({
          ...input(),
          exams: [
            { ...input().exams[0], reviewSession: { ...session(), storageKey: 'third-party' } },
          ],
        }),
      ),
    ).toThrow('Backup inválido');
    expect(() => parseBackup('a'.repeat(MAX_BACKUP_BYTES + 1))).toThrow('10 MiB');
  });
});
