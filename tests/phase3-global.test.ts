import { removeSpanArtifacts } from '../scripts/span-artifacts';
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { readExamCatalog } from '../scripts/catalog';
import { phase3Base, remainingExams } from '../scripts/phase3-inventory';
import { pocId, pocSource } from '../scripts/legacy-data';
import { assertReleaseBaseline, migratedBaseline, examCounts } from '../scripts/release-baseline';
const run = promisify(execFile);

it('confirma 17 JSONs, 485 questões, 462 objetivas, 23 dissertativas, IDs/referências/assets e catálogo gerado', async () => {
  const { exams: currentExams, catalog } = await readExamCatalog();
  await assertReleaseBaseline();
  const exams = migratedBaseline(currentExams); // schema + referências + arquivos de imagens
  expect(exams).toHaveLength(17);
  expect((await readdir('data/exams')).filter((f) => f.endsWith('.json'))).toHaveLength(
    currentExams.length,
  );
  expect(examCounts(exams)).toEqual({
    exams: 17,
    questions: 485,
    objective: 462,
    essay: 23,
    options: 2187,
    groups: 3,
  });
  expect(new Set(exams.map((e) => e.id)).size).toBe(17);
  expect(new Set(exams.map((e) => e.provenance.sourceFile))).toEqual(
    new Set([pocSource, ...remainingExams.map((e) => e.sourceFile)]),
  );
  const questions = exams.flatMap((e) => e.questions);
  expect(questions).toHaveLength(485);
  expect(new Set(questions.map((q) => q.id)).size).toBe(485);
  expect(questions.filter((q) => q.type === 'multiple-choice')).toHaveLength(462);
  expect(questions.filter((q) => q.type === 'essay')).toHaveLength(23);
  expect(exams.flatMap((e) => e.groups)).toHaveLength(3);
  const options = questions.flatMap((q) =>
    q.type === 'multiple-choice' ? [q.options.length] : [],
  );
  expect([options.filter((n) => n === 4).length, options.filter((n) => n === 5).length]).toEqual([
    123, 339,
  ]);
  await run(process.execPath, ['--import', 'tsx', 'scripts/generate-exam-index.ts']);
  expect(JSON.parse(await readFile('public/generated/exam-index.json', 'utf8'))).toEqual(catalog);
  for (const exam of currentExams) {
    expect(JSON.parse(await readFile(`public/generated/exams/${exam.id}.json`, 'utf8'))).toEqual(
      exam,
    );
  }
}, 15000);

it('mantém POC e fontes legadas idênticas à base confirmada (workflows têm sucessores na Fase 4)', async () => {
  const paths = [
    'simulados',
    'simulados.json',
    'index.html',
    'backup-medsim.js',
    'grifar-borracha.js',
    'desempenho-estatisticas.js',
    'ajustes-voltar-hub-v5.js',
    'branding-medsim.js',
    `data/exams/${pocId}.json`,
  ];
  const { stdout } = await run('git', [
    'ls-tree',
    '-r',
    '-z',
    '--name-only',
    phase3Base,
    '--',
    ...paths,
  ]);
  for (const path of stdout.split('\0').filter(Boolean)) {
    // F03 changes exactly one historical script. Pin its reviewed implementation
    // rather than broadly excluding it from the legacy byte-for-byte guard.
    // All other legacy files still match the original Phase 3 baseline.
    const reference =
      path === 'backup-medsim.js'
        ? 'a77f09035b8c18840ec2d9cdca26efdce3cdffd7'
        : phase3Base;
    const { stdout: base } = await run('git', ['show', `${reference}:${path}`], {
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(await readFile(path, 'utf8'), path).toBe(removeSpanArtifacts(base));
  }
});
