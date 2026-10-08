import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { assertAcademicPreservation } from './academic-preservation';
import { examCounts } from '../scripts/release-baseline';
import { mockOutput } from '../scripts/authoring/generation-providers';
import { json } from '../scripts/authoring/generation-files';
import {
  approveWorkflow,
  importWorkflow,
  initWorkflow,
  promoteWorkflow,
} from '../scripts/authoring/workflow';

const baseline = '8dbdd359e0f7badebdbce45b64ef893a17dee6e2';
const run = promisify(execFile);
const id = 'preservation-neutral-addition';
const original = 'data/exams/fisiologia-m5-aula-1-2026.json';
let root: string;
const artifact = (directory: string) => join(root, 'authoring', directory, `${id}.json`);
const production = () => join(root, 'data/exams', `${id}.json`);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'medsim-preservation-'));
  await run('git', ['clone', '--shared', '--quiet', '--no-checkout', process.cwd(), root]);
  await run('git', ['checkout', '--quiet', baseline], { cwd: root });
  for (const directory of ['candidates', 'reviews', 'generations'])
    await mkdir(join(root, 'authoring', directory), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function imported() {
  const file = join(root, 'Neutral source.txt');
  await cp('tests/fixtures/authoring/source.txt', file);
  const initial = await initWorkflow(root, {
    id,
    file,
    subject: 'Organização',
    title: 'Adição neutra',
    division: 'Fixture de teste',
    objective: '1',
    essay: '0',
  });
  const result = join(root, '.authoring-work', id, 'result.json');
  await writeFile(result, json(mockOutput(initial.request)));
  await importWorkflow(root, { id, file, result });
}
async function approvedAddition() {
  await imported();
  await approveWorkflow(root, { id, reviewedBy: 'Revisor humano fictício', confirm: 'APROVAR' });
  await promoteWorkflow(root, { id, confirm: 'PROMOVER' });
}
async function mutate(path: string, change: (value: any) => void) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  change(value);
  await writeFile(path, json(value));
}

it('preserva os bytes e contagens das 19 provas históricas', async () => {
  const result = await assertAcademicPreservation(baseline, root);
  expect(result.additions).toEqual([]);
  expect(examCounts(result.historicalExams)).toMatchObject({
    exams: 19,
    questions: 522,
    objective: 492,
    essay: 30,
  });
});
it('aceita a vigésima prova somente após import, aprovação e promoção oficiais, untracked e committed', async () => {
  await approvedAddition();
  for (const committed of [false, true]) {
    if (committed) {
      await run(
        'git',
        [
          'add',
          `data/exams/${id}.json`,
          ...['candidates', 'reviews', 'generations'].map((dir) => `authoring/${dir}/${id}.json`),
        ],
        { cwd: root },
      );
      await run(
        'git',
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          'commit',
          '--quiet',
          '-m',
          'Fixture approved addition',
        ],
        { cwd: root },
      );
    }
    const result = await assertAcademicPreservation(baseline, root);
    expect(examCounts(result.exams)).toMatchObject({
      exams: 20,
      questions: 523,
      objective: 493,
      essay: 30,
    });
    expect(result.historicalExams).toHaveLength(19);
    expect(result.additions.map((exam) => exam.id)).toEqual([id]);
  }
});
it.each(['conteúdo', 'whitespace'])(
  'rejeita alteração de %s em uma prova anterior',
  async (mode) => {
    const path = join(root, original);
    if (mode === 'conteúdo')
      await mutate(path, (exam) => {
        exam.description += ' alterado';
      });
    else await writeFile(path, `${await readFile(path, 'utf8')}\n`);
    await expect(assertAcademicPreservation(baseline, root)).rejects.toThrow('Baseline alterado');
  },
);
it.each(['excluir', 'renomear'])('rejeita %s uma prova anterior', async (mode) => {
  if (mode === 'excluir') await rm(join(root, original));
  else await rename(join(root, original), join(root, 'data/exams/renamed.json'));
  await expect(assertAcademicPreservation(baseline, root)).rejects.toThrow();
});
it('rejeita produção adicional sem candidate/review', async () => {
  const exam = JSON.parse(await readFile(join(root, original), 'utf8'));
  exam.id = id;
  await writeFile(production(), json(exam));
  await expect(assertAcademicPreservation(baseline, root)).rejects.toThrow();
});
it('rejeita adição em draft, sem declarar uma aprovação de fixture', async () => {
  await imported();
  await cp(artifact('candidates'), production());
  await expect(assertAcademicPreservation(baseline, root)).rejects.toThrow(/approved|aprovação/);
});
it('rejeita aprovação com checklist incompleto', async () => {
  await approvedAddition();
  await mutate(artifact('reviews'), (review) => {
    review.checks.answerKeyReviewed = false;
  });
  await expect(assertAcademicPreservation(baseline, root)).rejects.toThrow('checklist');
});
it('rejeita produção divergente do candidate aprovado', async () => {
  await approvedAddition();
  await mutate(production(), (exam) => {
    exam.questions[0].explanation[0].text += ' alterado';
  });
  await expect(assertAcademicPreservation(baseline, root)).rejects.toThrow(/divergente|diferentes/);
});
it.each(['ausente', 'hash divergente', 'anchors ausentes'])(
  'rejeita generation record %s',
  async (mode) => {
    await approvedAddition();
    if (mode === 'ausente') await rm(artifact('generations'));
    else
      await mutate(artifact('generations'), (record) => {
        if (mode === 'hash divergente') record.source.sha256 = '0'.repeat(64);
        else record.questions[0].sourceAnchors = [];
      });
    await expect(assertAcademicPreservation(baseline, root)).rejects.toThrow();
  },
);
it('rejeita review órfão em vez de ignorá-lo', async () => {
  await approvedAddition();
  await cp(artifact('reviews'), join(root, 'authoring/reviews/orphan.json'));
  await expect(assertAcademicPreservation(baseline, root)).rejects.toThrow('órfãos');
});
it('rejeita symlink de produção e arquivos inesperados no domínio acadêmico', async () => {
  await approvedAddition();
  await rm(production());
  await symlink(artifact('candidates'), production());
  await expect(assertAcademicPreservation(baseline, root)).rejects.toThrow('regular');
  await rm(production());
  await cp(artifact('candidates'), production());
  await writeFile(join(root, 'data/exams/unexpected.txt'), 'unexpected');
  await expect(assertAcademicPreservation(baseline, root)).rejects.toThrow('inesperado');
});
