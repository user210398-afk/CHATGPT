import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
  ]);
  expect(stdout.trim()).toBe('');
});
