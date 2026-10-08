import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseExam } from '../schema/exam';
import { loadCandidate, validateAll } from '../scripts/authoring/core';
import { readExamCatalog } from '../scripts/catalog';

const run = promisify(execFile);

// Freeze every existing exam byte for byte. Only additional, approved authoring
// pairs may expand the catalog; tracked and untracked additions follow the same checks.
export async function assertAcademicPreservation(baseline: string, root = '.') {
  assert.match(baseline, /^[a-f0-9]{40}$/);
  const { stdout } = await run(
    'git',
    ['ls-tree', '-r', '--name-only', baseline, '--', 'data/exams'],
    { cwd: root },
  );
  const files = stdout.trim().split('\n').filter(Boolean);
  assert.ok(files.length > 0, 'Baseline acadêmico vazio');
  const historicalExams = [];
  for (const file of files) {
    assert.match(file, /^data\/exams\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/);
    assert.ok((await lstat(join(root, file))).isFile(), `Fonte não regular: ${file}`);
    const { stdout: original } = await run('git', ['show', `${baseline}:${file}`], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.deepEqual(await readFile(join(root, file)), original, `Baseline alterado: ${file}`);
    historicalExams.push(parseExam(JSON.parse(original.toString('utf8')), file));
  }
  for (const file of await readdir(join(root, 'data/exams'))) {
    assert.match(file, /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/, 'Arquivo acadêmico inesperado');
    assert.ok((await lstat(join(root, 'data/exams', file))).isFile(), 'Prova não regular');
  }
  const { exams } = await readExamCatalog(join(root, 'data/exams'), join(root, 'public'));
  const historicalIds = historicalExams.map((exam) => exam.id);
  const additions = exams.filter((exam) => !historicalIds.includes(exam.id));
  await validateAll(root);
  for (const exam of additions) {
    const pair = await loadCandidate(root, exam.id, historicalIds);
    assert.equal(pair.review.status, 'approved', `Adição sem aprovação: ${exam.id}`);
    assert.deepEqual(exam, pair.exam, `Candidate/produção divergentes: ${exam.id}`);
  }
  return { historicalExams, additions, exams };
}
