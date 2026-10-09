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
    // F03 permits precisely this legacy backup script; behavioral regression tests
    // cover restoration and verified rollback. All other legacy JS stays frozen.
    ':(exclude)backup-medsim.js',
    // PWA-1 authorizes only this new worker; tests/pwa.test.tsx verifies its policy.
    ':(exclude)public/sw.js',
    'scripts/legacy-data.ts',
    'scripts/exam-parity.ts',
    'scripts/migrate-poc.ts',
    'scripts/migrate-exam.ts',
    'scripts/phase3-inventory.ts',
    'scripts/audit-legacy.ts',
    'scripts/catalog.ts',
    'scripts/generate-exam-index.ts',
    'package-lock.json',
    // Phase 8A: exact scratchwork modules; academic engine remains protected.
    ':(exclude)src/engine/statement-projection.ts',
    ':(exclude)src/engine/statement-selection.ts',
    ':(exclude)src/engine/question-annotations.ts',
    ':(exclude)src/engine/question-annotations-storage.ts',
    ':(exclude)src/engine/solver-scratch.ts',
    ':(exclude)src/engine/option-click-arbiter.ts',
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
    // Phase 7B.2B authorizes these three new modules explicitly:
    // review-session.ts and review-session-storage.ts form the isolated review-session domain;
    // history-reset.ts implements the explicit reset operation.
    // These exclusions do not authorize generic src/engine changes;
    // all other baseline protections remain active. Their behavior and persistence
    // are covered by the dedicated Phase 7B.2B suites.
    ':(exclude)src/engine/history-reset.ts',
    ':(exclude)src/engine/review-session-storage.ts',
    ':(exclude)src/engine/review-session.ts',
    ':(exclude)src/engine/dashboard-metrics.ts',
    ':(exclude)src/engine/ui-preferences.ts',
    ':(exclude)src/engine/backup.ts',
    ':(exclude)src/engine/backup-browser.ts',
    // Caderno de Erros: only the two approved read-only notebook modules.
    // Keep every other academic engine and historical baseline protection active.
    ':(exclude)src/engine/error-notebook-storage.ts',
    ':(exclude)src/engine/error-notebook.ts',
    // Analytics v1 authorizes only the two read-only analytics modules.
    // Every other academic engine and historical baseline protection remains active.
    ':(exclude)src/engine/analytics-reader.ts',
    ':(exclude)src/engine/analytics.ts',
  ]);
  expect(stdout.trim()).toBe('');
  // Authorized 7B.1 transitions/storage are covered by domain and migration tests.
  // Academic calculation and all historical scripts remain byte-protected.
  const { stdout: originalEngine } = await run('git', [
    'show',
    'b31295406ee800f0bb113282da7edfc27bfa511b:src/engine/exam-state.ts',
  ]);
  const engine = await readFile('src/engine/exam-state.ts', 'utf8');
  // 7B.2B broadens only the input type to share scoring with an isolated session.
  // Keep the calculation body byte-protected against the production baseline.
  const calculation = (text: string) => {
    const normalized = text
      .replace(
        /export function answeredCount\(\s*exam: Exam,\s*state: Pick<Attempt, 'answers'>,?\s*\): number/,
        'export function answeredCount(exam: Exam, state: Attempt): number',
      )
      .replace(
        /export function calculateResult<T extends Pick<Attempt, 'answers'>>\(\s*exam: Exam,\s*state: T,?\s*\): Result/,
        'export function calculateResult(exam: Exam, state: Attempt): Result',
      );
    return normalized.slice(
      normalized.indexOf('export function answeredCount('),
      normalized.indexOf('export function transition('),
    );
  };
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
