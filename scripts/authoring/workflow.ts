import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { identifier } from '../../schema/exam';
import { reviewSchema } from '../../schema/authoring';
import { generationRequestSchema, type GenerationRequest } from '../../schema/generation';
import { readExamCatalog } from '../catalog';
import { loadCandidate, promote, validateAll, validateCandidate } from './core';
import { generate, importGeneration, validateExport } from './generation';
import {
  assertAvailable,
  exists,
  GenerationError,
  json,
  readJson,
  readSource,
  safeDirectory,
  withGenerationLock,
} from './generation-files';
import { validateGenerationRecord } from './generation-integrity';
import { snapshotFile, assertStable } from './artifact-snapshot';
import { candidateFingerprint } from './approval-binding';

export interface InitOptions {
  file: string;
  id: string;
  subject: string;
  title: string;
  division: string;
  objective?: string;
  essay?: string;
  options?: string;
  difficulty?: string;
  year?: string;
  language?: string;
  focus?: string[];
  exclude?: string[];
  allowExternalKnowledge?: boolean;
}
function number(value: string | undefined, fallback?: number) {
  if (value === undefined) return fallback;
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new GenerationError('Número inválido');
  return Number(value);
}
export function buildRequest(input: InitOptions): GenerationRequest {
  if (input.objective === undefined && input.essay === undefined)
    throw new GenerationError('Informe --objective e/ou --essay; counts não podem ser inferidos');
  const ratios = (input.difficulty ?? '0.2,0.6,0.2').split(',');
  if (ratios.length !== 3) throw new GenerationError('Difficulty exige três proporções');
  return generationRequestSchema.parse({
    examId: input.id,
    subject: input.subject,
    title: input.title,
    division: input.division,
    year: input.year === undefined ? null : number(input.year),
    language: input.language ?? 'pt-BR',
    objectiveCount: number(input.objective, 0),
    essayCount: number(input.essay, 0),
    optionsPerObjective: number(input.options, 5),
    difficulty: { easy: number(ratios[0]), medium: number(ratios[1]), hard: number(ratios[2]) },
    focusTopics: input.focus ?? [],
    excludeTopics: input.exclude ?? [],
    allowExternalKnowledge: input.allowExternalKnowledge ?? false,
  });
}

// Read-only check: never create missing directories or follow authoring directory symlinks.
async function regularDirectories(root: string, parts: string[]) {
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    if (!(await exists(path))) return;
    assert.ok((await lstat(path)).isDirectory(), 'Diretório inválido ou symlink');
  }
}
async function inspectPaths(root: string, id: string) {
  identifier.parse(id);
  for (const directory of ['candidates', 'reviews', 'generations', 'exports'])
    await regularDirectories(root, [
      'authoring',
      directory,
      ...(directory === 'exports' ? [id] : []),
    ]);
  await regularDirectories(root, ['.authoring-work', id]);
  await regularDirectories(root, ['data', 'exams']);
  const production = join(root, 'data/exams', `${id}.json`);
  if (await exists(production))
    assert.ok((await lstat(production)).isFile(), 'Production deve ser arquivo regular');
}
const manifestPath = (root: string, id: string) =>
  join(root, 'authoring/exports', id, 'export-manifest.json');

export async function initWorkflow(root: string, input: InitOptions) {
  const request = buildRequest(input);
  await inspectPaths(root, request.examId);
  await assertAvailable(root, request.examId, true);
  // Fail before creating scratch if the original is inaccessible/unsupported.
  await readSource(input.file);
  const scratchRoot = await safeDirectory(root, ['.authoring-work']);
  const scratch = join(scratchRoot, request.examId);
  try {
    await mkdir(scratch);
  } catch {
    throw new GenerationError('Scratch já existe; inspecione antes de continuar');
  }
  try {
    const stage = await mkdtemp(join(scratch, '.request-stage-'));
    const config = join(scratch, 'request.json');
    try {
      const temporary = join(stage, 'request.json');
      await writeFile(temporary, json(request), { flag: 'wx', mode: 0o600 });
      await link(temporary, config);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
    // Explicit export with an empty environment: no API key lookup or implicit live provider.
    const result = await generate(
      root,
      { file: input.file, config, provider: 'export' },
      { env: {} },
    );
    assert.equal(result.kind, 'export');
    return { request, manifest: await validateExport(manifestPath(root, request.examId)), config };
  } catch (error) {
    // Only the scratch directory exclusively created by this invocation is removed.
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}

export type WorkflowState =
  | 'not-started'
  | 'awaiting-generation-result'
  | 'awaiting-human-review'
  | 'approved'
  | 'ready-to-promote'
  | 'promoted';

export async function workflowStatus(root: string, id: string) {
  await inspectPaths(root, id);
  const candidate = await exists(join(root, 'authoring/candidates', `${id}.json`));
  const review = await exists(join(root, 'authoring/reviews', `${id}.json`));
  const generation = await exists(join(root, 'authoring/generations', `${id}.json`));
  const exported = await exists(join(root, 'authoring/exports', id));
  const scratch = await exists(join(root, '.authoring-work', id));
  const { exams } = await readExamCatalog(join(root, 'data/exams'), join(root, 'public'));
  const production = exams.find((exam) => exam.id === id);
  const manifest = exported ? await validateExport(manifestPath(root, id)) : undefined;
  if (manifest) assert.equal(manifest.request.examId, id, 'Export ID divergente');
  const request = scratch
    ? generationRequestSchema.parse(
        await readJson(join(root, '.authoring-work', id, 'request.json')),
      )
    : manifest?.request;
  if (request) assert.equal(request.examId, id, 'Request ID divergente');
  if (scratch) assert.ok(manifest, 'Scratch incompleto: export ausente');
  if (request && manifest)
    assert.ok(isDeepStrictEqual(request, manifest.request), 'Scratch/request e export divergentes');
  if (!candidate) {
    assert.ok(!review && !generation && !production, 'Artefatos órfãos: candidate ausente');
    return {
      id,
      state: (manifest ? 'awaiting-generation-result' : 'not-started') as WorkflowState,
      candidateRevision: null,
      counts: request
        ? {
            objectiveCount: request.objectiveCount,
            essayCount: request.essayCount,
            optionsPerObjective: request.optionsPerObjective,
          }
        : null,
      reviewStatus: null,
      checks: null,
      reviewedBy: null,
      generationRecord: 'absent',
      production: false,
      sourceSha256: manifest?.source.sha256 ?? null,
    };
  }
  // Includes Zod, 6A semantic validation, required 6B evidence and production equality.
  await validateAll(root, id);
  const pair = await loadCandidate(root, id);
  const record = generation
    ? validateGenerationRecord(
        await readJson(join(root, 'authoring/generations', `${id}.json`)),
        pair.exam,
        pair.review,
      )
    : undefined;
  if (manifest) {
    assert.equal(manifest.source.sha256, pair.review.source.sha256, 'Export/source SHA divergente');
    assert.equal(
      manifest.source.fileName,
      pair.review.source.fileName,
      'Export/source basename divergente',
    );
    assert.ok(record, 'Export exige generation record');
    assert.ok(
      isDeepStrictEqual(manifest.request, record.request),
      'Export/generation request divergente',
    );
    assert.ok(
      isDeepStrictEqual(manifest.source, record.source),
      'Export/generation source divergente',
    );
    assert.ok(
      isDeepStrictEqual(manifest.provider, record.provider),
      'Export/generation provider divergente',
    );
  }
  return {
    id,
    state: (production
      ? 'promoted'
      : pair.review.status === 'approved'
        ? 'ready-to-promote'
        : 'awaiting-human-review') as WorkflowState,
    candidateRevision: pair.exam.revision,
    counts: pair.review.requirements,
    reviewStatus: pair.review.status,
    checks: pair.review.checks,
    reviewedBy: pair.review.reviewedBy,
    generationRecord: record ? 'valid' : 'absent (6A manual/legacy)',
    production: Boolean(production),
    sourceSha256: pair.review.source.sha256,
  };
}

export async function importWorkflow(
  root: string,
  input: { id: string; file: string; result: string },
) {
  await inspectPaths(root, input.id);
  const status = await workflowStatus(root, input.id);
  assert.equal(
    status.state,
    'awaiting-generation-result',
    'Import exige export íntegro sem candidate',
  );
  const artifacts = await importGeneration(root, {
    file: input.file,
    result: input.result,
    export: manifestPath(root, input.id),
  });
  await validateAll(root, input.id);
  return artifacts;
}

// Internal seams for deterministic fault/concurrency tests; never exposed by the CLI.
export interface ApprovalDependencies {
  afterValidation?: () => Promise<void>;
  replaceReview?: typeof rename;
}

export async function approveWorkflow(
  root: string,
  input: { id: string; reviewedBy: string; confirm?: string },
  dependencies: ApprovalDependencies = {},
) {
  assert.equal(input.confirm, 'APROVAR', 'Confirmação literal --confirm APROVAR obrigatória');
  const reviewedBy = z.string().trim().min(1).parse(input.reviewedBy);
  await inspectPaths(root, input.id);
  return withGenerationLock(root, input.id, async () => {
    const candidatePath = join(root, 'authoring/candidates', `${input.id}.json`);
    const path = join(root, 'authoring/reviews', `${input.id}.json`);
    const generationPath = join(root, 'authoring/generations', `${input.id}.json`);
    const candidateSnapshot = await snapshotFile(candidatePath);
    const reviewSnapshot = await snapshotFile(path);
    const generationSnapshot = await snapshotFile(generationPath, true);
    assert.ok(reviewSnapshot.present && candidateSnapshot.present);
    const checkAcademic = async () => {
      await inspectPaths(root, input.id);
      await assertStable(candidatePath, candidateSnapshot);
      await assertStable(generationPath, generationSnapshot);
    };
    const checkAll = async () => {
      await checkAcademic();
      await assertStable(path, reviewSnapshot);
    };
    const status = await workflowStatus(root, input.id);
    assert.equal(status.state, 'awaiting-human-review', 'Review já aprovado ou candidate ausente');
    const pair = await loadCandidate(root, input.id);
    // The bytes captured before validation must be precisely the validated artifacts.
    await checkAll();
    const review = reviewSchema.parse({
      ...pair.review,
      status: 'approved',
      approval: {
        candidateSha256: candidateFingerprint(JSON.parse(candidateSnapshot.bytes.toString('utf8'))),
      },
      reviewedBy,
      checks: Object.fromEntries(Object.keys(pair.review.checks).map((key) => [key, true])),
      notes: [
        ...pair.review.notes,
        'Aprovação registrada após declaração explícita do usuário/revisor; a CLI não decide a aprovação acadêmica.',
      ],
    });
    validateCandidate(pair.exam, review, `${input.id}.json`);
    await dependencies.afterValidation?.();
    const stage = await mkdtemp(join(root, 'authoring/reviews', '.approval-stage-'));
    const replaceReview = dependencies.replaceReview ?? rename;
    let retainBackup = false;
    try {
      const temporary = join(stage, 'review.json');
      const rollback = join(stage, 'original.json');
      await writeFile(temporary, json(review), { flag: 'wx', mode: 0o600 });
      await writeFile(rollback, reviewSnapshot.bytes, {
        flag: 'wx',
        mode: Number(reviewSnapshot.info.mode & 0o777n),
      });
      await checkAll();
      await replaceReview(temporary, path);
      try {
        const installed = await snapshotFile(path);
        assert.ok(
          installed.present && installed.bytes.equals(Buffer.from(json(review))),
          'Review mudou durante aprovação',
        );
        await checkAcademic();
        await validateAll(root, input.id);
        await checkAcademic();
        await assertStable(path, installed);
      } catch (error) {
        try {
          // Never overwrite a concurrent review edit. Keep exact original backup on conflict.
          const current = await snapshotFile(path);
          assert.ok(
            current.present && current.bytes.equals(Buffer.from(json(review))),
            'Review externo preservado',
          );
          // Only review is restored. Concurrent candidate/generation edits are never touched.
          const restore = join(stage, 'restore.json');
          await writeFile(restore, reviewSnapshot.bytes, {
            flag: 'wx',
            mode: Number(reviewSnapshot.info.mode & 0o777n),
          });
          await replaceReview(restore, path);
          const restored = await snapshotFile(path);
          if (!restored.present || !restored.bytes.equals(reviewSnapshot.bytes))
            throw new Error('Review restaurado divergente');
        } catch {
          retainBackup = true;
          throw new GenerationError(
            `Falha ao restaurar atomicamente o review anterior; aprovação NÃO confirmada. Backup preservado em ${rollback}; inspecione antes de continuar.`,
          );
        }
        throw error;
      }
    } finally {
      if (!retainBackup) await rm(stage, { recursive: true, force: true });
    }
    return review;
  });
}

export async function promoteWorkflow(root: string, input: { id: string; confirm?: string }) {
  assert.equal(input.confirm, 'PROMOVER', 'Confirmação literal --confirm PROMOVER obrigatória');
  await inspectPaths(root, input.id);
  const status = await workflowStatus(root, input.id);
  assert.equal(
    status.state,
    'ready-to-promote',
    'Promoção exige review approved e ID ausente de production',
  );
  // Core promotion owns the lock and revalidates snapshots before exclusive publication.
  return promote(root, input.id, input.confirm);
}
