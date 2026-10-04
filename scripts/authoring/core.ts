import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, lstat, readFile, readdir, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { identifier, parseExam, type RichText } from '../../schema/exam';
import { reviewSchema } from '../../schema/authoring';
import { readExamCatalog } from '../catalog';
import { assertReleaseBaseline } from '../release-baseline';

export function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\p{P}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// Mantém limites de blocos e br, sem separar nós inline que dividem uma palavra.
function plainText(nodes: RichText): string {
  return nodes
    .map((node) =>
      node.type === 'text'
        ? node.text
        : /^(br|p|div|li|tr|td|th)$/.test(node.tag)
          ? ` ${plainText(node.children)} `
          : plainText(node.children),
    )
    .join('');
}
function noDuplicates(values: RichText[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(plainText(value));
    assert.ok(normalized, `${label}: texto vazio após normalização`);
    assert.ok(!seen.has(normalized), `${label}: duplicata normalizada`);
    seen.add(normalized);
  }
}
export function validateCandidate(
  raw: unknown,
  manifest: unknown,
  filename: string,
  existingIds: string[] = [],
) {
  const exam = parseExam(raw, filename);
  const review = reviewSchema.parse(manifest);
  assert.equal(basename(filename), `${exam.id}.json`, 'Filename deve corresponder ao exam.id');
  assert.ok(!existingIds.includes(exam.id), `ID já existe em produção: ${exam.id}`);
  assert.equal(review.examId, exam.id, 'examId divergente');
  assert.equal(review.source.fileName, exam.provenance.sourceFile, 'sourceFile divergente');
  assert.equal(
    review.source.sha256,
    exam.provenance.sourceSha256,
    'sourceSha256 divergente: provenance externa obrigatória',
  );
  const objective = exam.questions.filter((question) => question.type === 'multiple-choice');
  assert.equal(review.requirements.objectiveCount, objective.length, 'objectiveCount divergente');
  assert.equal(
    review.requirements.essayCount,
    exam.questions.length - objective.length,
    'essayCount divergente',
  );
  assert.equal(
    review.requirements.objectiveCount + review.requirements.essayCount,
    exam.questions.length,
    'Total divergente',
  );
  for (const question of objective) {
    assert.equal(
      question.options.length,
      review.requirements.optionsPerObjective,
      `${question.id}: optionsPerObjective divergente`,
    );
    noDuplicates(
      question.options.map((option) => option.text),
      `${question.id}: alternativas`,
    );
  }
  noDuplicates(
    exam.questions.map((question) => question.statement),
    'Enunciados',
  );
  return { exam, review };
}

async function readRegular(path: string) {
  assert.ok((await lstat(path)).isFile(), `Arquivo regular obrigatório: ${path}`);
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
export async function loadCandidate(root: string, id: string, existingIds: string[] = []) {
  identifier.parse(id);
  const filename = join(root, 'authoring/candidates', `${id}.json`);
  const review = join(root, 'authoring/reviews', `${id}.json`);
  return validateCandidate(
    await readRegular(filename),
    await readRegular(review),
    filename,
    existingIds,
  );
}
function realFiles(files: string[]) {
  return files
    .filter((file) => file.endsWith('.json') && !/\.(example|template)\.json$/i.test(file))
    .sort();
}
export async function validateAll(root = '.', id?: string) {
  const candidates = realFiles(await readdir(join(root, 'authoring/candidates')));
  const reviews = realFiles(await readdir(join(root, 'authoring/reviews')));
  if (!id)
    assert.deepEqual(
      candidates,
      reviews,
      'Cada candidate exige review correspondente, sem reviews órfãos',
    );
  const { exams } = await readExamCatalog(join(root, 'data/exams'), join(root, 'public'));
  const ids = id ? [`${identifier.parse(id)}.json`] : candidates;
  for (const file of ids) {
    const pair = await loadCandidate(root, file.slice(0, -5));
    const production = exams.find((exam) => exam.id === pair.exam.id);
    // Após promoção, o par continua como evidência auditável e deve ser aprovado e igual.
    if (production) {
      assert.equal(pair.review.status, 'approved', 'Candidate em produção exige review approved');
      assert.ok(
        isDeepStrictEqual(production, pair.exam),
        `ID já existe com conteúdo divergente: ${pair.exam.id}`,
      );
    }
  }
  return ids.length;
}

export async function promote(root: string, id: string, confirmation: string | undefined) {
  assert.equal(confirmation, 'PROMOVER', 'Confirmação literal --confirm PROMOVER obrigatória');
  const { exams } = await readExamCatalog(join(root, 'data/exams'), join(root, 'public'));
  const pair = await loadCandidate(
    root,
    id,
    exams.map((exam) => exam.id),
  );
  assert.equal(pair.review.status, 'approved', 'Promoção exige review approved');
  await assertReleaseBaseline(root);
  const target = join(root, 'data/exams', `${id}.json`);
  // COPYFILE_EXCL impede sobrescrita, inclusive em corrida ou destino symlink.
  await copyFile(join(root, 'authoring/candidates', `${id}.json`), target, constants.COPYFILE_EXCL);
  try {
    const result = await readExamCatalog(join(root, 'data/exams'), join(root, 'public'));
    assert.ok(
      isDeepStrictEqual(
        result.exams.find((exam) => exam.id === id),
        pair.exam,
      ),
      'Cópia divergente',
    );
    await assertReleaseBaseline(root);
  } catch (error) {
    await unlink(target);
    throw error;
  }
  return target;
}
