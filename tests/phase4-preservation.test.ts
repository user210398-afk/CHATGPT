import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { removeSpanArtifacts } from '../scripts/span-artifacts';
import { readFile } from 'node:fs/promises';
import { assertReleaseBaseline } from '../scripts/release-baseline';
import { expect, it } from 'vitest';

const run = promisify(execFile);
it('release mantém baseline acadêmico, engine e scripts históricos da base Fase 4', async () => {
  await assertReleaseBaseline();
  const { stdout } = await run('git', [
    'diff',
    '--name-only',
    'b31295406ee800f0bb113282da7edfc27bfa511b',
    '--',
    'src/engine',
    'simulados.json',
    'index.html',
    '*.js',
    'scripts/legacy-data.ts',
    'scripts/exam-parity.ts',
    'scripts/migrate-poc.ts',
    'scripts/migrate-exam.ts',
    'scripts/phase3-inventory.ts',
    'scripts/audit-legacy.ts',
    'scripts/catalog.ts',
    'scripts/generate-exam-index.ts',
    'package-lock.json',
    ':(exclude)src/engine/persistence.ts',
    ':(exclude)src/engine/exam-state.ts',
    ':(exclude)src/engine/review-history.ts',
    ':(exclude)src/engine/review-filters.ts',
    ':(exclude)src/engine/storage-transaction.ts',
    ':(exclude)src/engine/content-equality.ts',
    ':(exclude)src/engine/catalog-progress.ts',
    ':(exclude)src/engine/catalog-preferences.ts',
    ':(exclude)src/engine/catalog-query.ts',
    // Phase 7B.2A authorizes subject-groups.ts as catalog/presentation metadata only.
    // This exclusion does not authorize generic src/engine changes;
    // all other engine protections remain in force.
    ':(exclude)src/engine/subject-groups.ts',
    ':(exclude)src/engine/dashboard-metrics.ts',
    ':(exclude)src/engine/ui-preferences.ts',
    ':(exclude)src/engine/backup.ts',
    ':(exclude)src/engine/backup-browser.ts',
  ]);
  expect(stdout.trim()).toBe('');
  // Authorized 7B.1 transitions/storage are covered by domain and migration tests.
  // Academic calculation and all historical scripts remain byte-protected.
  const { stdout: originalEngine } = await run('git', [
    'show',
    'b31295406ee800f0bb113282da7edfc27bfa511b:src/engine/exam-state.ts',
  ]);
  const engine = await readFile('src/engine/exam-state.ts', 'utf8');
  const calculation = (text: string) =>
    text.slice(
      text.indexOf('export function answeredCount('),
      text.indexOf('export function transition('),
    );
  expect(calculation(engine)).toBe(calculation(originalEngine));
  const { stdout: paths } = await run('git', [
    'ls-tree',
    '-r',
    '-z',
    '--name-only',
    'b31295406ee800f0bb113282da7edfc27bfa511b',
    '--',
    'simulados',
  ]);
  for (const path of paths.split('\0').filter(Boolean)) {
    const { stdout: base } = await run(
      'git',
      ['show', `b31295406ee800f0bb113282da7edfc27bfa511b:${path}`],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    expect(await readFile(path, 'utf8'), path).toBe(removeSpanArtifacts(base));
  }
});
