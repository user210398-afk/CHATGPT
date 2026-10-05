import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
    'simulados',
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
    ':(exclude)src/engine/catalog-progress.ts',
    ':(exclude)src/engine/catalog-preferences.ts',
    ':(exclude)src/engine/catalog-query.ts',
  ]);
  expect(stdout.trim()).toBe('');
  // 7A.1 may expose existing contracts and accept index metadata for keys.
  // Strip only those authorized changes; every persistence body must still match.
  const { stdout: originalPersistence } = await run('git', [
    'show',
    'b31295406ee800f0bb113282da7edfc27bfa511b:src/engine/persistence.ts',
  ]);
  const persistence = await readFile('src/engine/persistence.ts', 'utf8');
  const compatiblePersistence = persistence
    .replace(
      /^export const (HISTORY_LIMIT|historyEntrySchema|currentEnvelopeSchema|historyEnvelopeSchema|previousEnvelopeSchema)\b/gm,
      'const $1',
    )
    .replace(/^export function (summary|includeCurrent)\b/gm, 'function $1')
    .replaceAll("Pick<Exam, 'id' | 'revision'>", 'Exam');
  expect(compatiblePersistence).toBe(originalPersistence);
});
