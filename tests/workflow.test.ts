import { execFile } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generationRequestSchema } from '../schema/generation';
import examTemplate from '../authoring/templates/exam.example.json';
import reviewTemplate from '../authoring/templates/review.example.json';
import { loadCandidate, validateAll } from '../scripts/authoring/core';
import { digest, json, readSource } from '../scripts/authoring/generation-files';
import { mapGeneration } from '../scripts/authoring/generation-mapper';
import * as providers from '../scripts/authoring/generation-providers';
import { assertReleaseBaseline, releaseBaselineCommit } from '../scripts/release-baseline';
import {
  approveWorkflow,
  buildRequest,
  importWorkflow,
  initWorkflow,
  promoteWorkflow,
  workflowStatus,
  type InitOptions,
} from '../scripts/authoring/workflow';

const run = promisify(execFile);
const id = 'oficina-neutra-6c';
let root: string;
let file: string;
const network = vi.fn<typeof fetch>();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'medsim workflow com espaços '));
  await run('git', ['clone', '--shared', '--quiet', '--no-checkout', process.cwd(), root]);
  await run('git', ['checkout', '--quiet', releaseBaselineCommit], { cwd: root });
  for (const directory of ['candidates', 'reviews', 'generations'])
    await mkdir(join(root, 'authoring', directory), { recursive: true });
  file = join(root, 'Fonte neutra com espaços.txt');
  await cp('tests/fixtures/authoring/source.txt', file);
  network.mockReset().mockRejectedValue(new Error('Rede proibida'));
  vi.stubGlobal('fetch', network);
});
afterEach(async () => {
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
const options = (extra: Partial<InitOptions> = {}): InitOptions => ({
  file,
  id,
  subject: 'Organização',
  title: 'Oficina neutra',
  division: 'Teste fictício',
  objective: '2',
  essay: '1',
  ...extra,
});
const artifact = (directory: string) => join(root, 'authoring', directory, `${id}.json`);
const approval = (confirm: string | undefined = 'APROVAR') =>
  approveWorkflow(root, { id, reviewedBy: 'Revisor humano fictício', confirm });
const promotion = (confirm: string | undefined = 'PROMOVER') =>
  promoteWorkflow(root, { id, confirm });
async function imported() {
  const initial = await initWorkflow(root, options());
  const output = providers.mockOutput(initial.request);
  const result = join(root, '.authoring-work', id, 'result.json');
  await writeFile(result, json(output));
  const artifacts = await importWorkflow(root, { id, file, result });
  return { ...initial, result, output, artifacts };
}
async function snapshot(path = root, prefix = ''): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      Object.assign(entries, await snapshot(join(path, entry.name), `${name}/`));
    else entries[name] = digest(await readFile(join(path, entry.name)));
  }
  return entries;
}
async function changeReview(change: Record<string, unknown>) {
  const path = artifact('reviews');
  const review = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, json({ ...review, ...change }));
}

it('init com PDF válido, hash real, paths com espaços e defaults seguros', async () => {
  file = join(root, 'Aula neutra com espaços.pdf');
  await cp('tests/fixtures/authoring/workflow-neutral.pdf', file);
  const initial = await initWorkflow(root, options());
  expect(initial.manifest.source).toEqual((await readSource(file)).source);
  expect(initial.request).toMatchObject({
    year: null,
    language: 'pt-BR',
    optionsPerObjective: 5,
    difficulty: { easy: 0.2, medium: 0.6, hard: 0.2 },
    allowExternalKnowledge: false,
  });
  expect(initial.manifest.provider.name).toBe('export');
  expect(await readdir(join(root, 'authoring/exports', id))).toEqual([
    'export-manifest.json',
    'prompt.md',
    'schema.json',
  ]);
  const scratch = await readFile(initial.config, 'utf8');
  expect(scratch).not.toContain(root);
  expect(scratch).not.toContain('base64');
  expect(scratch).not.toContain('OPENAI_API_KEY');
});
it.each([
  { objective: undefined, essay: undefined },
  { objective: '-1' },
  { objective: '2.5' },
  { objective: '' },
  { objective: 'NaN' },
  { objective: '0', essay: '0' },
  { objective: '60', essay: '1' },
  { essay: '61' },
  { options: '3' },
  { difficulty: '0.2,0.6' },
  { difficulty: '0.2,0.6,0.9' },
  { difficulty: ',0.8,0.2' },
  { year: '0' },
  { id: '../escape' },
])('init rejeita parâmetros inválidos sem escrever: %j', async (extra) => {
  const before = await snapshot();
  await expect(initWorkflow(root, options(extra))).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
});
it('um count explícito define o tipo omitido como zero; foco e exclusões repetíveis', () => {
  expect(
    buildRequest(
      options({
        essay: undefined,
        focus: ['Azul', 'Verde'],
        exclude: ['Branco'],
        year: '2026',
        options: '4',
        language: 'pt-PT',
        allowExternalKnowledge: true,
      }),
    ),
  ).toMatchObject({
    essayCount: 0,
    year: 2026,
    focusTopics: ['Azul', 'Verde'],
    excludeTopics: ['Branco'],
    optionsPerObjective: 4,
    language: 'pt-PT',
    allowExternalKnowledge: true,
  });
  expect(buildRequest(options({ objective: undefined }))).toMatchObject({ objectiveCount: 0 });
});
it.each(['candidates', 'reviews', 'generations', 'exports', 'scratch', 'production'])(
  'init rejeita ID existente em %s sem sobrescrever',
  async (directory) => {
    const path =
      directory === 'scratch'
        ? join(root, '.authoring-work', id)
        : directory === 'exports'
          ? join(root, 'authoring/exports', id)
          : directory === 'production'
            ? join(root, 'data/exams', `${id}.json`)
            : artifact(directory);
    await mkdir(join(path, '..'), { recursive: true });
    if (['scratch', 'exports'].includes(directory)) {
      await mkdir(path);
      await writeFile(join(path, 'preservar.txt'), 'evidência existente');
    } else await writeFile(path, 'preservar bytes');
    const before = await snapshot();
    await expect(initWorkflow(root, options())).rejects.toThrow(/existe/);
    expect(await snapshot()).toEqual(before);
  },
);
it('init não cria candidate, review, generation ou production; scratch/export fora de production', async () => {
  const production = await snapshot(join(root, 'data/exams'));
  await initWorkflow(root, options());
  for (const directory of ['candidates', 'reviews', 'generations'])
    expect(await readdir(join(root, 'authoring', directory))).toEqual([]);
  expect(await snapshot(join(root, 'data/exams'))).toEqual(production);
  expect(await validateAll(root)).toBe(0);
});
it('status not-started é somente leitura', async () => {
  const before = await snapshot();
  expect(await workflowStatus(root, id)).toMatchObject({ state: 'not-started', production: false });
  expect(await snapshot()).toEqual(before);
});
it('status awaiting-generation-result verifica export e request sem inferir candidate pelo result', async () => {
  await initWorkflow(root, options());
  await writeFile(join(root, '.authoring-work', id, 'result.json'), '{não é candidate}');
  const before = await snapshot();
  expect(await workflowStatus(root, id)).toMatchObject({
    state: 'awaiting-generation-result',
    candidateRevision: null,
    generationRecord: 'absent',
    counts: { objectiveCount: 2, essayCount: 1 },
  });
  expect(await snapshot()).toEqual(before);
});
it('status awaiting-human-review mostra revision, checks, revisor, counts e record íntegro', async () => {
  await imported();
  const before = await snapshot();
  expect(await workflowStatus(root, id)).toMatchObject({
    state: 'awaiting-human-review',
    candidateRevision: 1,
    reviewStatus: 'draft',
    reviewedBy: null,
    generationRecord: 'valid',
    sourceSha256: digest(await readFile(file)),
    production: false,
    checks: {
      sourceCoverageReviewed: false,
      answerKeyReviewed: false,
      explanationsReviewed: false,
      duplicateCheckReviewed: false,
    },
  });
  expect(await snapshot()).toEqual(before);
});
it('status ready-to-promote quando review approved e production ausente', async () => {
  await imported();
  await approval();
  expect(await workflowStatus(root, id)).toMatchObject({
    state: 'ready-to-promote',
    reviewStatus: 'approved',
    reviewedBy: 'Revisor humano fictício',
    production: false,
  });
});
it('status promoted exige candidate aprovado e production semanticamente igual', async () => {
  await imported();
  await approval();
  await promotion();
  const path = join(root, 'data/exams', `${id}.json`);
  const production = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify(production));
  const before = await snapshot();
  expect(await workflowStatus(root, id)).toMatchObject({ state: 'promoted', production: true });
  expect(await snapshot()).toEqual(before);
  production.title = 'Divergente';
  await writeFile(path, json(production));
  await expect(workflowStatus(root, id)).rejects.toThrow(/divergente/);
});
it.each([
  'manifest',
  'prompt',
  'schema',
  'request',
  'record',
  'review',
  'candidate',
  'orphan',
  'missing-record',
])('status e approve falham com artefato inválido: %s', async (part) => {
  await imported();
  if (part === 'orphan') await rm(artifact('candidates'));
  else if (part === 'missing-record') await rm(artifact('generations'));
  else {
    const path =
      part === 'manifest'
        ? join(root, 'authoring/exports', id, 'export-manifest.json')
        : part === 'prompt'
          ? join(root, 'authoring/exports', id, 'prompt.md')
          : part === 'schema'
            ? join(root, 'authoring/exports', id, 'schema.json')
            : part === 'request'
              ? join(root, '.authoring-work', id, 'request.json')
              : artifact(part === 'record' ? 'generations' : `${part}s`);
    await writeFile(path, '{}');
  }
  const before = await snapshot();
  await expect(workflowStatus(root, id)).rejects.toThrow();
  await expect(approval()).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
});
it('import reutiliza exatamente mapper 6B e preserva draft/checks false', async () => {
  const { request, artifacts, output, manifest } = await imported();
  expect(artifacts).toEqual(
    mapGeneration(
      output,
      request,
      (await readSource(file)).source,
      manifest.provider,
      { id: null, usage: null },
      artifacts.record.createdAt,
    ),
  );
  const { review } = await loadCandidate(root, id);
  expect(review.status).toBe('draft');
  expect(Object.values(review.checks)).toEqual([false, false, false, false]);
  expect(review.reviewedBy).toBeNull();
  expect(await validateAll(root)).toBe(1);
});
it('import rejeita fonte alterada, ID divergente e segunda importação', async () => {
  const { result } = await imported();
  const before = await snapshot();
  await expect(importWorkflow(root, { id, file, result })).rejects.toThrow();
  await expect(importWorkflow(root, { id: 'outro-id', file, result })).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
  const other = await initWorkflow(root, options({ id: 'outro-id' }));
  const otherResult = join(root, '.authoring-work/outro-id/result.json');
  await writeFile(otherResult, json(providers.mockOutput(other.request)));
  await writeFile(file, 'Fonte adulterada');
  await expect(importWorkflow(root, { id: 'outro-id', file, result: otherResult })).rejects.toThrow(
    /Fonte/,
  );
});
it.each([undefined, '', 'aprovar', ' APROVAR', 'APROVAR '])(
  'approve exige APROVAR literal: %s',
  async (confirm) => {
    await imported();
    const before = await snapshot();
    await expect(approveWorkflow(root, { id, reviewedBy: 'Revisor', confirm })).rejects.toThrow(
      /APROVAR/,
    );
    expect(await snapshot()).toEqual(before);
  },
);
it('approve modifica somente review, preservando candidate, record, source, export e production', async () => {
  await imported();
  await changeReview({ notes: ['Nota acadêmica existente.'] });
  const before = await snapshot();
  const review = await approval();
  const after = await snapshot();
  const changed = Object.keys(after).filter((path) => before[path] !== after[path]);
  expect(changed).toEqual([`authoring/reviews/${id}.json`]);
  expect(Object.keys(after)).toEqual(Object.keys(before));
  expect(review.status).toBe('approved');
  expect(Object.values(review.checks)).toEqual([true, true, true, true]);
  expect(review.notes).toEqual([
    'Nota acadêmica existente.',
    expect.stringContaining('declaração explícita'),
  ]);
  expect(await validateAll(root)).toBe(1);
  await expect(approval()).rejects.toThrow(/aprovado/);
});
it.each(['', '  '])('approve rejeita reviewedBy vazio: %s', async (reviewedBy) => {
  await imported();
  const before = await snapshot();
  await expect(approveWorkflow(root, { id, reviewedBy, confirm: 'APROVAR' })).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
});
it('correção posterior incrementa revision e mantém record original; in-review continua aguardando revisão', async () => {
  await imported();
  const record = await readFile(artifact('generations'));
  const exam = JSON.parse(await readFile(artifact('candidates'), 'utf8'));
  exam.revision++;
  exam.questions[0].explanation.push({ type: 'text', text: 'Correção neutra registrada.' });
  await writeFile(artifact('candidates'), json(exam));
  await changeReview({
    status: 'in-review',
    notes: ['Pré-revisão: explicação corrigida, revision 2.'],
  });
  expect(await workflowStatus(root, id)).toMatchObject({
    state: 'awaiting-human-review',
    candidateRevision: 2,
  });
  await approval();
  expect(await readFile(artifact('generations'))).toEqual(record);
});
it.each([undefined, '', 'promover', ' PROMOVER', 'PROMOVER '])(
  'promote exige PROMOVER literal: %s',
  async (confirm) => {
    await imported();
    await approval();
    const before = await snapshot();
    await expect(promoteWorkflow(root, { id, confirm })).rejects.toThrow(/PROMOVER/);
    expect(await snapshot()).toEqual(before);
  },
);
it('promote rejeita draft e approved inválido', async () => {
  await imported();
  await expect(promotion()).rejects.toThrow(/approved/);
  await changeReview({
    status: 'approved',
    reviewedBy: 'Revisor',
    checks: {
      sourceCoverageReviewed: true,
      answerKeyReviewed: false,
      explanationsReviewed: true,
      duplicateCheckReviewed: true,
    },
  });
  await expect(promotion()).rejects.toThrow();
});
it('promote cria somente production após approved, copia bytes exatos e rejeita overwrite', async () => {
  await imported();
  await approval();
  const before = await snapshot();
  const path = await promotion();
  expect(await readFile(path)).toEqual(await readFile(artifact('candidates')));
  const after = await snapshot();
  expect(Object.keys(after).filter((path) => before[path] !== after[path])).toEqual([
    `data/exams/${id}.json`,
  ]);
  await expect(promotion()).rejects.toThrow();
  expect(await snapshot()).toEqual(after);
  await assertReleaseBaseline(root);
});
it('status funciona sem exports/scratch após promoção: apenas evidência canônica é necessária', async () => {
  await imported();
  await approval();
  await rm(join(root, 'authoring/exports'), { recursive: true });
  await rm(join(root, '.authoring-work'), { recursive: true });
  expect(await workflowStatus(root, id)).toMatchObject({ state: 'ready-to-promote' });
  await promotion();
  expect(await workflowStatus(root, id)).toMatchObject({
    state: 'promoted',
    generationRecord: 'valid',
  });
});
it('import rejeita output inválido sem publicar artefatos parciais', async () => {
  await initWorkflow(root, options());
  const result = join(root, '.authoring-work', id, 'result.json');
  await writeFile(result, '{}');
  const before = await snapshot();
  await expect(importWorkflow(root, { id, file, result })).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
});
it('init concorrente aceita só um autor e rejeita symlink na fonte/scratch', async () => {
  const outcomes = await Promise.allSettled([
    initWorkflow(root, options()),
    initWorkflow(root, options()),
  ]);
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  const sourceLink = join(root, 'link.txt');
  await symlink(file, sourceLink);
  await expect(
    initWorkflow(root, options({ id: 'outra-fonte', file: sourceLink })),
  ).rejects.toThrow(/symlink/);
  await symlink(join(root, 'data/exams'), join(root, '.authoring-work', 'scratch-link'));
  await expect(initWorkflow(root, options({ id: 'scratch-link' }))).rejects.toThrow(/symlink/);
});
it('approve concorrente registra uma única aprovação', async () => {
  await imported();
  const outcomes = await Promise.allSettled([approval(), approval()]);
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(
    (await loadCandidate(root, id)).review.notes.filter((note) =>
      note.includes('declaração explícita'),
    ),
  ).toHaveLength(1);
});
it('fluxo interno completo não lê OPENAI_API_KEY nem chama provider live ou fetch', async () => {
  const originalEnv = process.env;
  const env = new Proxy(originalEnv, {
    get(target, property) {
      if (property === 'OPENAI_API_KEY') throw new Error('Leitura da API key proibida');
      return Reflect.get(target, property);
    },
  });
  process.env = env;
  const live = vi.spyOn(providers, 'openAIOutput').mockRejectedValue(new Error('Live proibido'));
  try {
    await imported();
    await workflowStatus(root, id);
    await approval();
    await promotion();
    expect(live).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally {
    process.env = originalEnv;
  }
});
it('CLI dogfood completo com bloqueio de rede/API key e paths com espaços', async () => {
  const guard = join(root, 'guard.mjs');
  await writeFile(
    guard,
    `
import { Socket } from 'node:net';
process.env = new Proxy(process.env, { get(target, key) {
  if (key === 'OPENAI_API_KEY') throw new Error('API key proibida');
  return Reflect.get(target, key);
} });
globalThis.fetch = () => { throw new Error('Rede proibida'); };
Socket.prototype.connect = () => { throw new Error('Rede proibida'); };
`,
  );
  const cli = join(process.cwd(), 'scripts/authoring/workflow-cli.ts');
  const prefix = [
    '--import',
    guard,
    '--import',
    join(process.cwd(), 'node_modules/tsx/dist/loader.mjs'),
    cli,
  ];
  const cliRun = (...args: string[]) => run(process.execPath, [...prefix, ...args], { cwd: root });
  expect((await cliRun('status', '--id', id)).stdout).toContain('not-started');
  expect(
    (
      await cliRun(
        'init',
        '--id',
        id,
        '--file',
        file,
        '--subject',
        'Organização',
        '--title',
        'Oficina neutra',
        '--division',
        'Teste fictício',
        '--objective',
        '2',
        '--essay',
        '1',
        '--focus',
        'Azul',
        '--focus',
        'Verde',
      )
    ).stdout,
  ).toContain('SHA-256');
  expect((await cliRun('status', '--id', id)).stdout).toContain('awaiting-generation-result');
  const config = join(root, '.authoring-work', id, 'request.json');
  const result = join(root, '.authoring-work', id, 'result.json');
  await writeFile(
    result,
    json(
      providers.mockOutput(
        generationRequestSchema.parse(JSON.parse(await readFile(config, 'utf8'))),
      ),
    ),
  );
  expect((await cliRun('import', '--id', id, '--file', file, '--result', result)).stdout).toContain(
    'Candidate criado. Revisão humana obrigatória.',
  );
  expect((await cliRun('status', '--id', id)).stdout).toContain('awaiting-human-review');
  await expect(cliRun('approve', '--id', id, '--reviewed-by', 'ChatGPT')).rejects.toMatchObject({
    code: 1,
  });
  await cliRun('approve', '--id', id, '--reviewed-by', 'ChatGPT', '--confirm', 'APROVAR');
  expect((await cliRun('status', '--id', id)).stdout).toContain('ready-to-promote');
  await expect(cliRun('promote', '--id', id)).rejects.toMatchObject({ code: 1 });
  await cliRun('promote', '--id', id, '--confirm', 'PROMOVER');
  expect((await cliRun('status', '--id', id)).stdout).toContain('promoted');
}, 15000);
it.each(
  [
    ['init', '--provider', 'openai'],
    ['status', '--file', 'ignored'],
    ['approve', '--api-key', 'never-echo'],
    ['toString'],
    ['promote', 'extra'],
  ].map((args) => [args]),
)('CLI rejeita argumentos não autorizados: %j', async (args) => {
  const cli = join(process.cwd(), 'scripts/authoring/workflow-cli.ts');
  const error = await run(process.execPath, ['--import', 'tsx', cli, ...args, '--id', id]).catch(
    (error: { code: number; stderr: string }) => error,
  );
  expect(error).toMatchObject({ code: 1 });
  expect('stderr' in error && error.stderr).not.toContain('never-echo');
});

it('status rejeita production symlink mesmo com bytes semanticamente iguais', async () => {
  await imported();
  await approval();
  await symlink(artifact('candidates'), join(root, 'data/exams', `${id}.json`));
  await expect(workflowStatus(root, id)).rejects.toThrow(/arquivo regular/);
  await expect(promotion()).rejects.toThrow(/arquivo regular/);
});

const approvalChangedMessage =
  'Artefatos mudaram durante a aprovação; revise novamente antes de aprovar.';
const confirmedApproval = { id, reviewedBy: 'Revisor humano fictício', confirm: 'APROVAR' };
async function academicBytes() {
  return {
    candidate: await readFile(artifact('candidates')),
    review: await readFile(artifact('reviews')),
    generation: await readFile(artifact('generations')),
  };
}
async function changeCandidate() {
  const path = artifact('candidates');
  const exam = JSON.parse(await readFile(path, 'utf8'));
  expect(exam.revision).toBe(1);
  exam.revision = 2;
  exam.questions[0].statement = [
    { type: 'text', text: 'Questão neutra alterada concorrentemente.' },
  ];
  await writeFile(path, json(exam));
  return readFile(path);
}
async function changeGeneration() {
  const path = artifact('generations');
  const record = JSON.parse(await readFile(path, 'utf8'));
  record.questions[0].sourceAnchors = ['Anchor neutro alterado concorrentemente.'];
  await writeFile(path, json(record));
  return readFile(path);
}
async function manualPair() {
  await writeFile(artifact('candidates'), json({ ...examTemplate, id }));
  await writeFile(artifact('reviews'), json({ ...reviewTemplate, examId: id }));
  expect(await workflowStatus(root, id)).toMatchObject({ state: 'awaiting-human-review' });
}

it('approve rejeita candidate concorrente revision 1 → 2 e preserva bytes alterados sem aprovar review', async () => {
  await imported();
  const original = await academicBytes();
  let changed: Buffer | undefined;
  await expect(
    approveWorkflow(root, confirmedApproval, {
      afterValidation: async () => {
        changed = await changeCandidate();
      },
    }),
  ).rejects.toThrow(approvalChangedMessage);
  expect(await readFile(artifact('candidates'))).toEqual(changed);
  expect(await readFile(artifact('reviews'))).toEqual(original.review);
  expect(await readFile(artifact('generations'))).toEqual(original.generation);
  expect(await workflowStatus(root, id)).toMatchObject({
    candidateRevision: 2,
    reviewStatus: 'draft',
    state: 'awaiting-human-review',
  });
});
it('approve rejeita generation concorrente e preserva record alterado e review original', async () => {
  await imported();
  const original = await academicBytes();
  let changed: Buffer | undefined;
  await expect(
    approveWorkflow(root, confirmedApproval, {
      afterValidation: async () => {
        changed = await changeGeneration();
      },
    }),
  ).rejects.toThrow(approvalChangedMessage);
  expect(await readFile(artifact('generations'))).toEqual(changed);
  expect(await readFile(artifact('candidates'))).toEqual(original.candidate);
  expect(await readFile(artifact('reviews'))).toEqual(original.review);
});
it('approve rejeita review concorrente e mantém a edição externa do review', async () => {
  await imported();
  const original = await academicBytes();
  let changed: Buffer | undefined;
  await expect(
    approveWorkflow(root, confirmedApproval, {
      afterValidation: async () => {
        await changeReview({ notes: ['Nota externa escrita durante a aprovação.'] });
        changed = await readFile(artifact('reviews'));
      },
    }),
  ).rejects.toThrow(approvalChangedMessage);
  expect(await readFile(artifact('reviews'))).toEqual(changed);
  expect(JSON.parse(changed!.toString()).status).toBe('draft');
  expect(await readFile(artifact('candidates'))).toEqual(original.candidate);
  expect(await readFile(artifact('generations'))).toEqual(original.generation);
});
it.each(['candidates', 'reviews', 'generations'])(
  'approve rejeita remoção concorrente de %s sem recriar arquivo',
  async (directory) => {
    await imported();
    const original = await academicBytes();
    await expect(
      approveWorkflow(root, confirmedApproval, {
        afterValidation: async () => {
          await rm(artifact(directory));
        },
      }),
    ).rejects.toThrow(approvalChangedMessage);
    await expect(readFile(artifact(directory))).rejects.toMatchObject({ code: 'ENOENT' });
    if (directory !== 'reviews')
      expect(await readFile(artifact('reviews'))).toEqual(original.review);
  },
);
it.each(['candidates', 'reviews', 'generations'])(
  'approve rejeita substituição de %s até com bytes idênticos',
  async (directory) => {
    await imported();
    const original = await academicBytes();
    await expect(
      approveWorkflow(root, confirmedApproval, {
        afterValidation: async () => {
          const path = artifact(directory);
          const bytes = await readFile(path);
          const replacement = join(root, 'substituição externa.json');
          await writeFile(replacement, bytes, { flag: 'wx' });
          await rename(replacement, path);
        },
      }),
    ).rejects.toThrow(approvalChangedMessage);
    expect(await academicBytes()).toEqual(original);
  },
);
it.each(['candidates', 'reviews', 'generations'])(
  'approve rejeita alteração só de whitespace em %s',
  async (directory) => {
    await imported();
    const original = await academicBytes();
    await expect(
      approveWorkflow(root, confirmedApproval, {
        afterValidation: async () => {
          const path = artifact(directory);
          await writeFile(path, Buffer.concat([await readFile(path), Buffer.from('\n ')]));
        },
      }),
    ).rejects.toThrow(approvalChangedMessage);
    if (directory !== 'reviews')
      expect(await readFile(artifact('reviews'))).toEqual(original.review);
    expect((await readFile(artifact(directory))).toString()).toMatch(/\n $/);
  },
);
it.each(['candidates', 'reviews', 'generations'])(
  'approve rejeita troca de tipo por diretório em %s',
  async (directory) => {
    await imported();
    const original = await academicBytes();
    await expect(
      approveWorkflow(root, confirmedApproval, {
        afterValidation: async () => {
          await rm(artifact(directory));
          await mkdir(artifact(directory));
        },
      }),
    ).rejects.toThrow(approvalChangedMessage);
    expect((await readdir(join(root, 'authoring', directory))).includes(`${id}.json`)).toBe(true);
    if (directory !== 'reviews')
      expect(await readFile(artifact('reviews'))).toEqual(original.review);
  },
);
it.each(['candidates', 'reviews', 'generations'])(
  'approve rejeita troca por symlink em %s sem tocar edição externa',
  async (directory) => {
    await imported();
    const original = await academicBytes();
    await expect(
      approveWorkflow(root, confirmedApproval, {
        afterValidation: async () => {
          const path = artifact(directory);
          const external = join(root, 'arquivo externo.json');
          await writeFile(external, await readFile(path));
          await rm(path);
          await symlink(external, path);
        },
      }),
    ).rejects.toThrow(approvalChangedMessage);
    expect(await academicBytes()).toEqual(original);
  },
);
it('approve suporta record ausente em 6A manual, mas rejeita criação inesperada', async () => {
  await manualPair();
  const originalReview = await readFile(artifact('reviews'));
  await expect(
    approveWorkflow(root, confirmedApproval, {
      afterValidation: async () => {
        await writeFile(artifact('generations'), '{}', { flag: 'wx' });
      },
    }),
  ).rejects.toThrow(approvalChangedMessage);
  expect(await readFile(artifact('reviews'))).toEqual(originalReview);
  expect(await readFile(artifact('generations'), 'utf8')).toBe('{}');
});
it('approve normal 6A manual mantém ausência de generation e altera somente review', async () => {
  await manualPair();
  const before = await snapshot();
  await approveWorkflow(root, confirmedApproval);
  const after = await snapshot();
  expect(Object.keys(after).filter((path) => before[path] !== after[path])).toEqual([
    `authoring/reviews/${id}.json`,
  ]);
  await expect(readFile(artifact('generations'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it.each(['candidate', 'generation'])(
  'approve detecta %s na janela pré-check/write e restaura review byte a byte',
  async (part) => {
    await imported();
    await changeReview({ notes: ['Nota com espaços e acentos preservada exatamente.'] });
    // Preserve unusual but valid JSON formatting to prove exact-byte restoration.
    await writeFile(
      artifact('reviews'),
      JSON.stringify(JSON.parse(await readFile(artifact('reviews'), 'utf8')), null, 4) + '\n\n',
    );
    const original = await academicBytes();
    let changed: Buffer | undefined;
    const replaceReview = vi.fn<typeof rename>(async (source, target) => {
      if (replaceReview.mock.calls.length === 1) {
        expect(await readFile(artifact('reviews'))).toEqual(original.review);
        changed = part === 'candidate' ? await changeCandidate() : await changeGeneration();
      }
      await rename(source, target);
    });
    await expect(approveWorkflow(root, confirmedApproval, { replaceReview })).rejects.toThrow(
      approvalChangedMessage,
    );
    expect(replaceReview).toHaveBeenCalledTimes(2);
    expect(await readFile(artifact('reviews'))).toEqual(original.review);
    expect(await readFile(artifact(part === 'candidate' ? 'candidates' : 'generations'))).toEqual(
      changed,
    );
    expect(await readFile(artifact(part === 'candidate' ? 'generations' : 'candidates'))).toEqual(
      part === 'candidate' ? original.generation : original.candidate,
    );
    if (part === 'candidate')
      expect(await workflowStatus(root, id)).toMatchObject({
        candidateRevision: 2,
        reviewStatus: 'draft',
        state: 'awaiting-human-review',
      });
  },
);
it.each(['candidates', 'generations'])(
  'approve restaura review se %s for removido após escrita',
  async (directory) => {
    await imported();
    const original = await academicBytes();
    const replaceReview = vi.fn<typeof rename>(async (source, target) => {
      await rename(source, target);
      if (replaceReview.mock.calls.length === 1) await rm(artifact(directory));
    });
    await expect(approveWorkflow(root, confirmedApproval, { replaceReview })).rejects.toThrow(
      approvalChangedMessage,
    );
    expect(await readFile(artifact('reviews'))).toEqual(original.review);
    await expect(readFile(artifact(directory))).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
it('approve restaura review se generation surgir na janela da escrita em 6A manual', async () => {
  await manualPair();
  const original = await readFile(artifact('reviews'));
  const replaceReview = vi.fn<typeof rename>(async (source, target) => {
    if (replaceReview.mock.calls.length === 1)
      await writeFile(artifact('generations'), '{}', { flag: 'wx' });
    await rename(source, target);
  });
  await expect(approveWorkflow(root, confirmedApproval, { replaceReview })).rejects.toThrow(
    approvalChangedMessage,
  );
  expect(await readFile(artifact('reviews'))).toEqual(original);
  expect(await readFile(artifact('generations'), 'utf8')).toBe('{}');
});
it('approve falha explicitamente se rollback atômico falhar e preserva backup exato', async () => {
  await imported();
  const original = await academicBytes();
  let changed: Buffer | undefined;
  const replaceReview = vi.fn<typeof rename>(async (source, target) => {
    if (replaceReview.mock.calls.length === 1) {
      changed = await changeCandidate();
      await rename(source, target);
    } else throw new Error('Falha simulada de restauração');
  });
  await expect(approveWorkflow(root, confirmedApproval, { replaceReview })).rejects.toThrow(
    /Falha ao restaurar atomicamente.*aprovação NÃO confirmada.*Backup preservado/,
  );
  expect(replaceReview).toHaveBeenCalledTimes(2);
  expect(await readFile(artifact('candidates'))).toEqual(changed);
  expect(await readFile(artifact('generations'))).toEqual(original.generation);
  const stages = (await readdir(join(root, 'authoring/reviews'))).filter((name) =>
    name.startsWith('.approval-stage-'),
  );
  expect(stages).toHaveLength(1);
  expect(await readFile(join(root, 'authoring/reviews', stages[0]!, 'original.json'))).toEqual(
    original.review,
  );
});
