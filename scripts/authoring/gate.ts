import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { parseExam } from '../../schema/exam';
import { readExamCatalog } from '../catalog';
import { assertReleaseBaseline } from '../release-baseline';
import { removeSpanArtifacts } from '../span-artifacts';
import { loadCandidate, validateAll } from './core';
import { historicalApprovals } from './approval-binding';
import { digest } from './generation-files';
const run = promisify(execFile);
export async function contentGate(root: string, base: string) {
  assert.match(base, /^[a-f0-9]{40}$/, 'Base deve ser um SHA Git completo');
  const git = async (args: string[]) =>
    (await run('git', args, { cwd: root, maxBuffer: 8 * 1024 * 1024 })).stdout;
  await assertReleaseBaseline(root);
  // Preserve every historical artifact that already belongs to the PR base,
  // including deletions/renames of entire sets that validateAll cannot discover.
  const existing = new Set(
    (await git(['ls-tree', '-r', '--name-only', base, '--', 'authoring', 'data/exams']))
      .trim()
      .split('\n'),
  );
  for (const [id, evidence] of Object.entries(historicalApprovals))
    for (const [key, directory] of [
      ['candidate', 'authoring/candidates'],
      ['review', 'authoring/reviews'],
      ['generation', 'authoring/generations'],
      ['production', 'data/exams'],
    ] as const) {
      const file = `${directory}/${id}.json`;
      if (!existing.has(file)) continue;
      assert.ok(
        (await lstat(join(root, file))).isFile(),
        `Baseline histórico exige arquivo regular: ${file}`,
      );
      assert.equal(
        digest(await readFile(join(root, file))),
        evidence[key],
        `Baseline de aprovação histórico alterado: ${file}`,
      );
    }

  const baseFiles = (await git(['ls-tree', '-r', '--name-only', base, '--', 'data/exams']))
    .trim()
    .split('\n')
    .filter((file) => file.endsWith('.json'));
  const baseIds = await Promise.all(
    baseFiles.map(
      async (file) => parseExam(JSON.parse(await git(['show', `${base}:${file}`])), file).id,
    ),
  );
  const changes = (
    await git(['diff', '--no-renames', '--name-status', '-z', base, 'HEAD', '--', 'data/exams'])
  ).split('\0');
  let additions = 0;
  for (let i = 0; i < changes.length - 1; i += 2) {
    const status = changes[i]!;
    const file = changes[i + 1]!;
    if (status !== 'M')
      assert.equal(
        status,
        'A',
        `Gate permite somente adições; alteração proibida: ${status} ${file}`,
      );
    assert.match(
      file,
      /^data\/exams\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/,
      'Arquivo de produção inesperado',
    );
    assert.ok((await lstat(join(root, file))).isFile(), 'Produção exige arquivo regular');
    if (status === 'M') {
      const { stdout: original } = await run('git', ['show', `${base}:${file}`], {
        cwd: root,
        encoding: 'buffer',
        maxBuffer: 8 * 1024 * 1024,
      });
      const text = original.toString('utf8');
      assert.deepEqual(Buffer.from(text), original, 'Cleanup exige base UTF-8 sem perda');
      const cleaned = removeSpanArtifacts(text);
      assert.notEqual(
        cleaned,
        text,
        `Gate permite somente adições ou remoção real de spans: ${file}`,
      );
      assert.deepEqual(
        await readFile(join(root, file)),
        Buffer.from(cleaned),
        `Cleanup exige exclusivamente remoção exata de spans: ${file}`,
      );
      continue;
    }
    const production = parseExam(JSON.parse(await readFile(join(root, file), 'utf8')), file);
    const pair = await loadCandidate(root, production.id, baseIds);
    assert.equal(pair.review.status, 'approved', 'Gate exige review approved');
    assert.ok(pair.review.approval, 'Gate exige vínculo de aprovação para novas adições');
    assert.equal(file, `data/exams/${production.id}.json`, 'Filename divergente');
    assert.ok(
      isDeepStrictEqual(production, pair.exam),
      'Candidate e production diferentes semanticamente',
    );
    additions++;
  }
  await readExamCatalog(join(root, 'data/exams'), join(root, 'public'));
  await validateAll(root);
  return additions;
}
