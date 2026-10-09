import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { readFileSync } from 'node:fs';
import { assertAcademicPreservation } from './academic-preservation';
import { examCounts } from '../scripts/release-baseline';
import { prepareHistoryReset, confirmHistoryReset } from '../src/engine/history-reset';
import { exportBackup, prepareImport, confirmImport } from '../src/engine/backup';
import {
  AttemptRepository,
  storageKey,
  historyStorageKey,
  summary,
} from '../src/engine/persistence';
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
  it('historical academic bytes stay frozen; new exams require approved authoring; official modules stay identical', async () => {
    const { historicalExams } = await assertAcademicPreservation(baseline);
    const paths = [
      'simulados',
      'schema/exam.ts',
      'src/types/exam.ts',
      'src/engine/exam-state.ts',
      'src/engine/review-session.ts',
      'src/engine/history-reset.ts',
      'src/engine/backup.ts',
      '.github/workflows',
      'package.json',
      'package-lock.json',
      'vite.config.ts',
      // PWA-1: exact infrastructure additions, byte/semantic guards in pwa.test.tsx.
      // All other workflow, lockfile, schema and engine assertions remain active.
      ':(exclude).github/workflows/ci.yml',
      ':(exclude)package.json',
      ':(exclude)vite.config.ts',
    ];
    expect(
      (await run('git', ['diff', '--name-only', baseline, '--', ...paths])).stdout.trim(),
    ).toBe('');
    expect(
      (
        await run('git', ['ls-files', '--others', '--exclude-standard', '--', ...paths])
      ).stdout.trim(),
    ).toBe('');
    expect(examCounts(historicalExams)).toMatchObject({
      exams: 19,
      questions: 522,
      objective: 492,
      essay: 30,
    });
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

// RT-P1 explicitly authorizes persistence.ts; replace only its impossible byte gate.
it('RT-P1 official writes/conflicts preserve annotations, scratch and unrelated raw bytes', () => {
  const store = memory(),
    current = createAttempt(exam);
  const official = new AttemptRepository(() => store);
  const foreignKeys = [
    annotationStorageKey(exam),
    scratchStorageKey(exam, scope),
    'unknown-personal-key',
  ];
  for (const key of foreignKeys) store.values.set(key, ` opaque:${key} `);
  const personal = foreignKeys.map((key) => [key, store.values.get(key)]);
  const a = official.read(exam),
    b = official.read(exam);
  expect(official.save(exam, current, a.history, a.persistence).status).toBe('saved');
  const winner = new Map(store.values);
  expect(official.save(exam, createAttempt(exam), b.history, b.persistence).status).toBe(
    'conflict',
  );
  expect(store.values).toEqual(winner);
  expect(foreignKeys.map((key) => [key, store.values.get(key)])).toEqual(personal);
});
