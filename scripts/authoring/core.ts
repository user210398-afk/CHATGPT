import assert from 'node:assert/strict';
import { link, lstat, mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { identifier, parseExam, type RichText } from '../../schema/exam';
import { reviewSchema } from '../../schema/authoring';
import { readExamCatalog } from '../catalog';
import { assertReleaseBaseline } from '../release-baseline';
import { validateGenerationRecord } from './generation-integrity';
import { promptVersion } from '../../schema/generation';
import { assertApprovalBinding, historicalEvidence } from './approval-binding';
import { snapshotFile, assertStable } from './artifact-snapshot';
import { digest, withGenerationLock, safeDirectory } from './generation-files';

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
  assertApprovalBinding(raw, manifest, review);
  return { exam, review };
}

async function loadCandidateSnapshot(root: string, id: string, existingIds: string[] = []) {
  identifier.parse(id);
  const filename = join(root, 'authoring/candidates', `${id}.json`);
  const reviewPath = join(root, 'authoring/reviews', `${id}.json`);
  const generationPath = join(root, 'authoring/generations', `${id}.json`);
  const candidate = await snapshotFile(filename);
  const review = await snapshotFile(reviewPath);
  const generation = await snapshotFile(generationPath, true);
  assert.ok(candidate.present && review.present);
  const pair = validateCandidate(
    JSON.parse(candidate.bytes.toString('utf8')),
    JSON.parse(review.bytes.toString('utf8')),
    filename,
    existingIds,
  );
  if (
    generation.present ||
    (pair.review.generation.mode === 'ai-assisted' &&
      pair.review.generation.promptVersion === promptVersion)
  ) {
    assert.ok(generation.present, 'Generation record obrigatório');
    validateGenerationRecord(JSON.parse(generation.bytes.toString('utf8')), pair.exam, pair.review);
  }
  const historical = historicalEvidence(id);
  const productionPath = join(root, 'data/exams', `${id}.json`);
  const production = historical ? await snapshotFile(productionPath) : undefined;
  if (historical) {
    assert.ok(generation.present && production?.present, 'Conjunto histórico incompleto');
    for (const [key, bytes] of [
      ['candidate', candidate.bytes],
      ['review', review.bytes],
      ['generation', generation.bytes],
      ['production', production.bytes],
    ] as const)
      assert.equal(
        digest(bytes),
        historical[key],
        `Baseline de aprovação histórico alterado: ${id}/${key}`,
      );
  }
  const stable = async () => {
    await assertStable(filename, candidate);
    await assertStable(reviewPath, review);
    await assertStable(generationPath, generation);
    if (production) await assertStable(productionPath, production);
  };
  await stable();
  return { pair, candidateBytes: candidate.bytes, stable };
}
export async function loadCandidate(root: string, id: string, existingIds: string[] = []) {
  return (await loadCandidateSnapshot(root, id, existingIds)).pair;
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
  if (!id) {
    let generations: string[] = [];
    try {
      generations = realFiles(await readdir(join(root, 'authoring/generations')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const file of generations) assert.ok(candidates.includes(file), 'Generation record órfão');
  }
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

// Internal deterministic seams; CLI callers cannot inject publication or concurrency hooks.
export interface PromotionDependencies {
  afterValidation?: () => Promise<void>;
  publish?: typeof link;
  removePublished?: typeof unlink;
  afterPublication?: () => Promise<void>;
}
export async function promote(
  root: string,
  id: string,
  confirmation: string | undefined,
  dependencies: PromotionDependencies = {},
) {
  assert.equal(confirmation, 'PROMOVER', 'Confirmação literal --confirm PROMOVER obrigatória');
  return withGenerationLock(root, id, async () => {
    const { exams } = await readExamCatalog(join(root, 'data/exams'), join(root, 'public'));
    const loaded = await loadCandidateSnapshot(
      root,
      id,
      exams.map((exam) => exam.id),
    );
    assert.equal(loaded.pair.review.status, 'approved', 'Promoção exige review approved');
    await assertReleaseBaseline(root);
    await dependencies.afterValidation?.();
    await loaded.stable();
    const target = join(root, 'data/exams', `${id}.json`);
    await safeDirectory(root, ['data', 'exams']);
    const stage = await mkdtemp(join(root, 'data/exams', '.promotion-stage-'));
    const temporary = join(stage, 'candidate.json');
    const backup = join(stage, 'approved-candidate.json');
    let published = false;
    let retainBackup = false;
    try {
      // Publish only the validated bytes. Hard link is atomic and exclusive,
      // including when another actor creates the destination or a symlink.
      await writeFile(temporary, loaded.candidateBytes, { flag: 'wx', mode: 0o600 });
      // Keep an independent exact backup before publication; target edits cannot alter it.
      await writeFile(backup, loaded.candidateBytes, { flag: 'wx', mode: 0o600 });
      await loaded.stable();
      await (dependencies.publish ?? link)(temporary, target);
      published = true;
      const publishedSnapshot = await snapshotFile(target);
      assert.ok(
        publishedSnapshot.present && publishedSnapshot.bytes.equals(loaded.candidateBytes),
        'Cópia divergente',
      );
      const stagedInfo = await lstat(temporary, { bigint: true });
      assert.ok(
        publishedSnapshot.info.dev === stagedInfo.dev &&
          publishedSnapshot.info.ino === stagedInfo.ino,
        'Destino mudou durante promoção',
      );
      await dependencies.afterPublication?.();
      await assertStable(target, publishedSnapshot);
      await loaded.stable();
      const result = await readExamCatalog(join(root, 'data/exams'), join(root, 'public'));
      assert.ok(
        isDeepStrictEqual(
          result.exams.find((exam) => exam.id === id),
          loaded.pair.exam,
        ),
        'Cópia divergente',
      );
      await assertReleaseBaseline(root);
      await loaded.stable();
      await assertStable(target, publishedSnapshot);
    } catch (error) {
      if (published) {
        try {
          const current = await lstat(target, { bigint: true });
          const own = await lstat(temporary, { bigint: true });
          assert.ok(current.dev === own.dev && current.ino === own.ino, 'Destino substituído');
          await (dependencies.removePublished ?? unlink)(target);
        } catch (rollbackError) {
          if ((rollbackError as NodeJS.ErrnoException).code !== 'ENOENT') {
            retainBackup = true;
            throw new Error(
              `Promoção NÃO confirmada; rollback inseguro ou falhou. Backup preservado em ${backup}; inspecione antes de continuar.`,
            );
          }
        }
      }
      throw error;
    } finally {
      if (!retainBackup) await rm(stage, { recursive: true, force: true });
    }
    return target;
  });
}
