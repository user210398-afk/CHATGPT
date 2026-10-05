import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { removeSpanArtifacts } from '../scripts/span-artifacts';
const run = promisify(execFile);
const base = 'd1d9fc3fac7a99f6ad51ccf4153b25e263b07a93';
const files = [
  ['data/exams/farmaco-p2-2025.json', 166],
  ['data/exams/imunologia-b4-2023.json', 120],
  ['data/exams/imunologia-b4-2024.json', 182],
  ['simulados/farmaco-p2-Simulado-2025.html', 168],
  ['simulados/imunologia-b4-Simulado 2023.html', 120],
  ['simulados/imunologia-b4-Simulado 2024.html', 184],
] as const;
it.each(files)('%s differs only by removal of %i artificial tokens', async (path, tokens) => {
  const { stdout } = await run('git', ['show', `${base}:${path}`], { maxBuffer: 4 * 1024 * 1024 });
  expect([...stdout.matchAll(/\[span_[0-9]+\]\((?:start|end)_span\)/g)]).toHaveLength(tokens);
  expect(await readFile(path)).toEqual(Buffer.from(removeSpanArtifacts(stdout)));
});
it('zero remaining span artifacts across all tracked user content, including escaped variants', async () => {
  const { stdout } = await run('git', ['ls-files', '-z']);
  for (const path of stdout
    .split('\0')
    .filter(
      (path) =>
        /^(data\/exams\/|simulados\/|src\/|app\/|public\/media\/)/.test(path) &&
        /\.(json|html|ts|tsx|css|js|txt|md)$/.test(path),
    )) {
    expect(await readFile(path, 'utf8'), path).not.toMatch(
      /start_span|end_span|\[span_[0-9]+\]|\\\[span_/,
    );
  }
});
it('all academic/authoring/schema/infra bytes match the mandatory base except the six approved cleanup files', async () => {
  const { stdout } = await run('git', [
    'ls-tree',
    '-r',
    '-z',
    '--name-only',
    base,
    '--',
    'data/exams',
    'simulados',
    'authoring',
    'schema',
    'package.json',
    'package-lock.json',
    '.github',
    'scripts/authoring',
  ]);
  for (const path of stdout.split('\0').filter(Boolean)) {
    const { stdout: original } = await run('git', ['show', `${base}:${path}`], {
      encoding: 'buffer',
      maxBuffer: 8 * 1024 * 1024,
    });
    const expected = files.some(([file]) => file === path)
      ? Buffer.from(removeSpanArtifacts(original.toString('utf8')))
      : original;
    expect(await readFile(path), path).toEqual(expected);
  }
}, 60000);
it('normal generator publishes clean exams from their canonical source', async () => {
  for (const file of (await readdir('public/generated/exams')).filter((path) =>
    path.endsWith('.json'),
  )) {
    const output = await readFile(`public/generated/exams/${file}`, 'utf8');
    expect(output, file).not.toMatch(/start_span|end_span|\[span_[0-9]+\]/);
    expect(JSON.parse(output)).toEqual(JSON.parse(await readFile(`data/exams/${file}`, 'utf8')));
  }
});
