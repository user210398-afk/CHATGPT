import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { readFileSync, readdirSync } from 'node:fs';
import { prepareHistoryReset, confirmHistoryReset } from '../src/engine/history-reset';
import { exportBackup, prepareImport, confirmImport } from '../src/engine/backup';
import { storageKey, historyStorageKey, summary } from '../src/engine/persistence';
import { reviewStorageKey } from '../src/engine/review-history';
import { reviewSessionStorageKey } from '../src/engine/review-session-storage';
import { annotationStorageKey } from '../src/engine/question-annotations-storage';
import { scratchStorageKey } from '../src/engine/solver-scratch';
import { createAttempt } from '../src/engine/exam-state';
import { tinyCatalog, source, session } from './phase7b2b-fixtures';
import { exam, scope, memory } from './phase8a-fixtures';
const baseline = '8dbdd359e0f7badebdbce45b64ef893a17dee6e2';
describe('annotations/scratch preserve official domains', () => {
  it('ZERAR byte-identically preserves annotations/scratch and resets exact official domains', () => {
    const store = memory(),
      attempt = source();
    store.values.set(storageKey(exam), JSON.stringify({ storageVersion: 3, current: attempt }));
    store.values.set(
      historyStorageKey(exam),
      JSON.stringify({ storageVersion: 3, history: [summary(attempt)] }),
    );
    store.values.set(
      reviewStorageKey(exam),
      JSON.stringify({ storageVersion: 1, attempts: [attempt] }),
    );
    store.values.set(
      reviewSessionStorageKey(exam),
      JSON.stringify({ storageVersion: 1, session: session() }),
    );
    const annotations = ' {"personal":"preserve even incompatible raw"}  ',
      scratch = ' scratch opaque bytes ';
    store.values.set(annotationStorageKey(exam), annotations);
    store.values.set(scratchStorageKey(exam, scope), scratch);
    const plan = prepareHistoryReset(tinyCatalog, store);
    expect(plan.expected.has(annotationStorageKey(exam))).toBe(false);
    expect(store.writes).toEqual([]);
    confirmHistoryReset(plan, 'ZERAR', store);
    expect(store.values).toEqual(
      new Map([
        [annotationStorageKey(exam), annotations],
        [scratchStorageKey(exam, scope), scratch],
      ]),
    );
  });
  it('backup v3 excludes personal domains; export/preview read-only; import preserves exact raw', async () => {
    const store = memory(),
      raw = '{unreadable annotations must not block backup}',
      scratch = '{scratch}';
    const current = createAttempt(exam);
    store.values.set(storageKey(exam), JSON.stringify({ storageVersion: 3, current }));
    store.values.set(annotationStorageKey(exam), raw);
    store.values.set(scratchStorageKey(exam, scope), scratch);
    const backup = await exportBackup(tinyCatalog, store, async () => exam);
    expect(backup.version).toBe(3);
    expect(JSON.stringify(backup)).not.toContain('annotations');
    expect(JSON.stringify(backup)).not.toContain('solver-scratch');
    const plan = await prepareImport(backup, tinyCatalog, store, async () => exam);
    expect(store.writes).toEqual([]);
    expect(plan.expected.has(annotationStorageKey(exam))).toBe(false);
    confirmImport(plan, true, store);
    expect(store.values.get(annotationStorageKey(exam))).toBe(raw);
    expect(store.values.get(scratchStorageKey(exam, scope))).toBe(scratch);
  });
  it('academic data and official engine modules remain identical to baseline, including untracked academic files', async () => {
    const paths = [
      'data/exams',
      'simulados',
      'schema/exam.ts',
      'src/types/exam.ts',
      'src/engine/exam-state.ts',
      'src/engine/review-session.ts',
      'src/engine/persistence.ts',
      'src/engine/history-reset.ts',
      'src/engine/backup.ts',
      '.github/workflows',
      'package.json',
      'package-lock.json',
      'vite.config.ts',
    ];
    expect(
      (await run('git', ['diff', '--name-only', baseline, '--', ...paths])).stdout.trim(),
    ).toBe('');
    expect(
      (
        await run('git', ['ls-files', '--others', '--exclude-standard', '--', ...paths])
      ).stdout.trim(),
    ).toBe('');
    const exams = readdirSync('data/exams')
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(`data/exams/${name}`, 'utf8')));
    const questions = exams.flatMap((exam) => exam.questions);
    expect([
      exams.length,
      questions.length,
      questions.filter((q) => q.type === 'multiple-choice').length,
      questions.filter((q) => q.type === 'essay').length,
    ]).toEqual([19, 522, 492, 30]);
  });
  it('new production domains never clear storage or delete by generic prefix', () => {
    for (const path of [
      'src/engine/question-annotations-storage.ts',
      'src/engine/solver-scratch.ts',
      'src/app/useQuestionAnnotations.ts',
      'src/app/useSolverScratch.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/\.clear\s*\(|\.key\s*\(|\.startsWith\s*\(/);
    }
  });
});
