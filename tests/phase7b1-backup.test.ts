import { describe, expect, it } from 'vitest';
import {
  exportBackup,
  parseBackup,
  prepareImport,
  confirmImport,
  mergeExam,
  backupV1Schema,
  type BackupExam,
} from '../src/engine/backup';
import { createAttempt, transition } from '../src/engine/exam-state';
import { storageKey, historyStorageKey, summary } from '../src/engine/persistence';
import { reviewStorageKey, ReviewRepository } from '../src/engine/review-history';
import { defaultUiPreferences, uiPreferencesKey } from '../src/engine/ui-preferences';
import { poc, first, firstEssay } from './fixtures';
import { catalogExam } from './catalog-fixtures';
import { legacyAttempt, legacyHistory } from './legacy-fixtures';
import { memory, finished } from './phase7b1-fixtures';
const catalog = { schemaVersion: 1 as const, exams: [catalogExam] },
  loader = async () => poc;
const entry = (
  attempt: ReturnType<typeof finished>,
  kind: 'current' | 'history' | 'review',
): BackupExam => ({
  examId: poc.id,
  revision: poc.revision,
  current: kind === 'current' ? attempt : null,
  history: kind === 'history' ? [summary(attempt)] : [],
  reviewAttempts: kind === 'review' ? [attempt] : [],
});
describe('backup v2 and genuine frozen v1 compatibility', () => {
  it('reads real v1 fields, normalizes only memory, then imports storage v3', async () => {
    const current = finished(),
      { attemptModePreference: _mode, ...prefs } = defaultUiPreferences;
    const old = {
      format: 'medsim-backup',
      version: 1,
      exportedAt: current.completedAt,
      exams: [
        {
          examId: poc.id,
          revision: poc.revision,
          current: legacyAttempt(current),
          history: [legacyHistory(summary(current))],
        },
      ],
      catalogPreferences: { storageVersion: 1, favorites: [] },
      uiPreferences: { ...prefs, storageVersion: 1 },
    };
    expect(backupV1Schema.safeParse(old).success).toBe(true);
    const raw = JSON.stringify(old),
      backup = parseBackup(raw);
    expect(backup.version).toBe(2);
    expect(backup.exams[0]!.current).toEqual(current);
    expect(backup.exams[0]!.reviewAttempts).toEqual([]);
    expect(backup.uiPreferences).toMatchObject({ storageVersion: 2, attemptModePreference: 'ask' });
    const store = memory(),
      plan = await prepareImport(backup, catalog, store, loader);
    expect(store.setItem).not.toHaveBeenCalled();
    confirmImport(plan, true, store);
    expect(JSON.parse(store.values.get(storageKey(poc))!).storageVersion).toBe(3);
    expect(JSON.parse(store.values.get(historyStorageKey(poc))!).storageVersion).toBe(3);
    expect(store.values.has(reviewStorageKey(poc))).toBe(false);
    expect(
      backupV1Schema.safeParse({ ...old, exams: [{ ...old.exams[0], current }] }).success,
    ).toBe(false);
  });
  it.each(['exam', 'study'] as const)(
    'roundtrip %s preserves post-completion flags, reviews, answers and prefs v2',
    async (mode) => {
      const current = finished(mode),
        source = memory([
          [storageKey(poc), JSON.stringify({ storageVersion: 3, current })],
          [
            uiPreferencesKey,
            JSON.stringify({ ...defaultUiPreferences, attemptModePreference: 'study' }),
          ],
        ]),
        repo = new ReviewRepository(() => source);
      repo.capture(poc, current);
      const marked = repo.toggleFlag(poc, current, firstEssay.id),
        before = [...source.values];
      const exported = await exportBackup(catalog, source, loader);
      expect(exported.version).toBe(2);
      expect(exported.exams[0]!.reviewAttempts).toEqual([marked]);
      expect([...source.values]).toEqual(before);
      const target = memory(),
        plan = await prepareImport(parseBackup(JSON.stringify(exported)), catalog, target, loader);
      expect(target.setItem).not.toHaveBeenCalled();
      confirmImport(plan, true, target);
      expect(new ReviewRepository(() => target).load(poc, current.id)).toEqual(marked);
      expect(JSON.parse(target.values.get(storageKey(poc))!).current).toEqual(marked);
      expect(JSON.parse(target.values.get(uiPreferencesKey)!)).toEqual(exported.uiPreferences);
      const again = await prepareImport(exported, catalog, target, loader);
      expect(again.changes).toEqual([]);
    },
  );
  it('archive incompatibility aborts entire export with no writes', async () => {
    const store = memory([
      [
        reviewStorageKey(poc),
        JSON.stringify({
          storageVersion: 1,
          attempts: [{ ...finished('study'), confirmedQuestionIds: [] }],
        }),
      ],
    ]);
    await expect(exportBackup(catalog, store, loader)).rejects.toThrow('Exportação abortada');
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it.each([
    'mode',
    'confirmed',
    'flags',
    'answer',
    'option',
    'result',
    'date',
    'revision',
    'open',
  ] as const)('rejects incompatible imported review %s', async (kind) => {
    const source = memory([
        [storageKey(poc), JSON.stringify({ storageVersion: 3, current: finished('study') })],
      ]),
      backup = await exportBackup(catalog, source, loader);
    backup.exams[0]!.current = null;
    backup.exams[0]!.history = [];
    const attempt = backup.exams[0]!.reviewAttempts[0]!;
    if (kind === 'mode') attempt.mode = 'exam';
    if (kind === 'confirmed') attempt.confirmedQuestionIds = ['absent'];
    if (kind === 'flags') attempt.flagged = ['absent'];
    if (kind === 'answer') attempt.answers = { absent: 'option-1' };
    if (kind === 'option') attempt.answers[first.id] = 'option-999';
    if (kind === 'result') attempt.result!.percentage = 100;
    if (kind === 'date') attempt.completedAt = '2020-01-01T00:00:00.000Z';
    if (kind === 'revision') attempt.examRevision = 999;
    if (kind === 'open') {
      attempt.completedAt = null;
      attempt.result = null;
    }
    const store = memory(),
      plan = await prepareImport(backup, catalog, store, loader);
    expect(plan.compatibleExams).toBe(0);
    expect(plan.changes).toEqual([]);
    expect(store.setItem).not.toHaveBeenCalled();
  });
  for (const a of ['current', 'history', 'review'] as const)
    for (const b of ['current', 'history', 'review'] as const) {
      it(`${a} × ${b}: identical deduplicates, divergent local record wins`, () => {
        const local = finished('exam', 'same'),
          different = transition(poc, createAttempt(poc, local.startedAt, local.id, 'exam'), {
            type: 'finish',
            now: local.completedAt!,
          });
        for (const equal of [true, false]) {
          const merged = mergeExam(
            entry(local, a),
            entry(equal ? structuredClone(local) : different, b),
          );
          expect(equal ? merged.conflicts === 0 : merged.conflicts > 0).toBe(true);
          if (a === 'current') expect(merged.current).toEqual(local);
          if (a === 'history') expect(merged.history).toContainEqual(summary(local));
          if (a === 'review') expect(merged.reviewAttempts).toContainEqual(local);
          if (!equal && b === 'review') expect(merged.reviewAttempts).not.toContainEqual(different);
        }
      });
    }
  it('flag-only import divergence follows local metadata without changing academic fields', () => {
    const local = finished('study', 'same'),
      imported = { ...local, flagged: [first.id] };
    const merged = mergeExam(entry(local, 'current'), entry(imported, 'review'));
    expect(merged.conflicts).toBe(0);
    expect(merged.current).toEqual(local);
    expect(merged.reviewAttempts[0]!.flagged).toEqual([]);
  });
  it('review expected raw participates in concurrency and rollback', async () => {
    const source = memory([
        [storageKey(poc), JSON.stringify({ storageVersion: 3, current: finished('study') })],
      ]),
      backup = await exportBackup(catalog, source, loader);
    const target = memory(),
      plan = await prepareImport(backup, catalog, target, loader);
    target.values.set(reviewStorageKey(poc), 'concurrent');
    expect(() => confirmImport(plan, false, target)).toThrow('concorrência');
    expect(target.setItem).not.toHaveBeenCalled();
    target.values.delete(reviewStorageKey(poc));
    const second = await prepareImport(backup, catalog, target, loader);
    target.setItem.mockImplementation((key, value) => {
      if (key === reviewStorageKey(poc)) throw new Error('quota');
      target.values.set(key, value);
    });
    expect(() => confirmImport(second, false, target)).toThrow('foram restauradas');
    expect(target.values.size).toBe(0);
  });
});
