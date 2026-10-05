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
    ':(exclude)src/engine/dashboard-metrics.ts',
    ':(exclude)src/engine/ui-preferences.ts',
    ':(exclude)src/engine/backup.ts',
    ':(exclude)src/engine/backup-browser.ts',
  ]);
  expect(stdout.trim()).toBe('');
  // 7A.1 may expose existing contracts and accept index metadata for keys.
  // 7A.2 also reads imported compact histories alongside a legacy current.
  // F1 also authorizes chronological retention in includeCurrent.
  // Strip only that helper, the bridge and its calls; other persistence bodies must match.
  const { stdout: originalPersistence } = await run('git', [
    'show',
    'b31295406ee800f0bb113282da7edfc27bfa511b:src/engine/persistence.ts',
  ]);
  const persistence = await readFile('src/engine/persistence.ts', 'utf8');
  const compatiblePersistence = persistence
    .replace(
      /^export function includeCurrent[\s\S]*?(?=\n\/\/ Fase 7A.2:)/m,
      originalPersistence.slice(
        originalPersistence.indexOf('function includeCurrent('),
        originalPersistence.indexOf('\nexport class AttemptRepository'),
      ),
    )
    .replace(
      'if (!raw) return { ...fresh, history: readLegacyHistory(this.storage, exam, []) };',
      'if (!raw) return fresh;',
    )
    .replace(/^\/\/ Fase 7A.2:[\s\S]*?(?=export class AttemptRepository)/m, '')
    .replace(
      /history: includeCurrent\(\s*previous\.data\.current,\s*readLegacyHistory\(\s*this\.storage,\s*exam,\s*previous\.data\.history\.map\(summary\),?\s*\),?\s*\)/,
      'history: includeCurrent(previous.data.current, previous.data.history.map(summary))',
    )
    .replace(
      /^export const (HISTORY_LIMIT|historyEntrySchema|currentEnvelopeSchema|historyEnvelopeSchema|previousEnvelopeSchema)\b/gm,
      'const $1',
    )
    .replace(/^export function (summary|includeCurrent)\b/gm, 'function $1')
    .replaceAll("Pick<Exam, 'id' | 'revision'>", 'Exam');
  expect(compatiblePersistence).toBe(originalPersistence);
});
