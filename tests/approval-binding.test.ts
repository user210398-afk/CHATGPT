import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import examTemplate from '../authoring/templates/exam.example.json';
import reviewTemplate from '../authoring/templates/review.example.json';
import { reviewSchema } from '../schema/authoring';
import {
  candidateFingerprint,
  historicalApprovalCommit,
  historicalApprovals,
} from '../scripts/authoring/approval-binding';
import { loadCandidate, promote, validateAll, validateCandidate } from '../scripts/authoring/core';
import { contentGate } from '../scripts/authoring/gate';
import { digest, json } from '../scripts/authoring/generation-files';
import { approveWorkflow, workflowStatus } from '../scripts/authoring/workflow';
import { releaseBaselineCommit } from '../scripts/release-baseline';

const run = promisify(execFile);
const id = 'quinto-neutro-f01';
let root: string;
const path = (directory: string) => join(root, 'authoring', directory, `${id}.json`);
const production = () => join(root, 'data/exams', `${id}.json`);
async function commit() {
  await run('git', ['add', '-A'], { cwd: root });
  await run(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Neutral F01 fixture',
    ],
    { cwd: root },
  );
}
async function bytes() {
  const files: Record<string, string> = {};
  for (const directory of [
    'authoring/candidates',
    'authoring/reviews',
    'authoring/generations',
    'data/exams',
  ]) {
    for (const file of await readdir(join(root, directory)))
      if (file.endsWith('.json'))
        files[`${directory}/${file}`] = digest(await readFile(join(root, directory, file)));
  }
  return files;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'f01-neutral-'));
  await run('git', ['clone', '--shared', '--quiet', '--no-checkout', process.cwd(), root]);
  await run('git', ['checkout', '--quiet', releaseBaselineCommit], { cwd: root });
  for (const directory of ['candidates', 'reviews', 'generations'])
    await mkdir(join(root, 'authoring', directory), { recursive: true });
  const exam = { ...structuredClone(examTemplate), id };
  // A second neutral question exercises essays and order; no real academic data.
  const {
    options: _options,
    correctAnswer: _answer,
    ...base
  } = structuredClone(exam.questions[0]!);
  const essay = {
    ...base,
    id: 'essay-1',
    type: 'essay',
    statement: [{ type: 'text', text: 'Descreva uma forma geométrica neutra.' }],
    modelAnswer: [{ type: 'text', text: 'Resposta neutra fictícia.' }],
  };
  await writeFile(path('candidates'), json({ ...exam, questions: [...exam.questions, essay] }));
  await writeFile(
    path('reviews'),
    json({
      ...reviewTemplate,
      examId: id,
      requirements: { ...reviewTemplate.requirements, essayCount: 1 },
    }),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const approve = () =>
  approveWorkflow(root, { id, reviewedBy: 'Humano fictício', confirm: 'APROVAR' });
async function editCandidate(mutate: (exam: any) => void) {
  const exam = JSON.parse(await readFile(path('candidates'), 'utf8'));
  mutate(exam);
  await writeFile(path('candidates'), json(exam));
}
const changes: [string, (exam: any) => void][] = [
  [
    'gabarito',
    (e) => {
      e.questions[0].correctAnswer = 'b';
    },
  ],
  [
    'alternativa',
    (e) => {
      e.questions[0].options[0].text[0].text += '!';
    },
  ],
  [
    'explicação',
    (e) => {
      e.questions[0].explanation[0].text += '!';
    },
  ],
  [
    'enunciado',
    (e) => {
      e.questions[0].statement[0].text += '!';
    },
  ],
  [
    'resposta-modelo',
    (e) => {
      e.questions[1].modelAnswer[0].text += '!';
    },
  ],
  [
    'tags da prova',
    (e) => {
      e.tags.push('neutro');
    },
  ],
  [
    'tags da questão',
    (e) => {
      e.questions[0].tags.push('neutro');
    },
  ],
  [
    'revision',
    (e) => {
      e.revision++;
    },
  ],
  [
    'título',
    (e) => {
      e.title += '!';
    },
  ],
  [
    'metadados',
    (e) => {
      e.description += '!';
    },
  ],
  [
    'proveniência',
    (e) => {
      e.provenance.notes.push('Nota neutra');
    },
  ],
  [
    'ordem das alternativas',
    (e) => {
      e.questions[0].options.reverse();
    },
  ],
  [
    'ordem das questões',
    (e) => {
      e.questions.reverse();
    },
  ],
  [
    'whitespace dentro do texto',
    (e) => {
      e.questions[0].statement[0].text += ' ';
    },
  ],
];
it('aprovação explícita captura digest do snapshot; intacto promove e segundo approve recusa', async () => {
  const raw = JSON.parse(await readFile(path('candidates'), 'utf8'));
  const before = await bytes();
  const review = await approve();
  expect(review.approval).toEqual({ candidateSha256: candidateFingerprint(raw) });
  expect(candidateFingerprint({ b: 2, a: [true, null, 'á'] })).toBe(
    digest('{"a":[true,null,"á"],"b":2}'),
  );
  expect(await workflowStatus(root, id)).toMatchObject({ state: 'ready-to-promote' });
  expect((await bytes())[`authoring/candidates/${id}.json`]).toBe(
    before[`authoring/candidates/${id}.json`],
  );
  await expect(approve()).rejects.toThrow(/aprovado/);
  await promote(root, id, 'PROMOVER');
  await commit();
  expect(await contentGate(root, releaseBaselineCommit)).toBe(1);
  expect(await readFile(production())).toEqual(await readFile(path('candidates')));
});
it.each(changes)(
  'alteração pós-aprovação de %s rejeita status/validação/promoção/Gate, sem escrita',
  async (_name, change) => {
    await approve();
    await editCandidate(change);
    const before = await bytes();
    await expect(workflowStatus(root, id)).rejects.toThrow(/aprovação divergente/);
    await expect(validateAll(root)).rejects.toThrow(/aprovação divergente/);
    await expect(promote(root, id, 'PROMOVER')).rejects.toThrow(/aprovação divergente/);
    expect(await bytes()).toEqual(before);
    // Production matching the mutated candidate cannot rescue the stale approval.
    await cp(path('candidates'), production());
    await commit();
    const gateBefore = await bytes();
    await expect(contentGate(root, releaseBaselineCommit)).rejects.toThrow(/aprovação divergente/);
    expect(await bytes()).toEqual(gateBefore);
  },
);
it('ordem das chaves e whitespace externo preservam vínculo; promoção copia os bytes atuais validados', async () => {
  await approve();
  const exam = JSON.parse(await readFile(path('candidates'), 'utf8'));
  const reordered = Object.fromEntries(Object.entries(exam).reverse());
  await writeFile(path('candidates'), `\n ${JSON.stringify(reordered, null, 4)}\n\n`);
  expect(await workflowStatus(root, id)).toMatchObject({ state: 'ready-to-promote' });
  await promote(root, id, 'PROMOVER');
  expect(await readFile(production())).toEqual(await readFile(path('candidates')));
});
it.each(['ausente', 'antigo', 'fabricado', 'malformado', 'null', 'extra', 'tipo'])(
  'novo ID approved com vínculo %s falha, mesmo com production correspondente',
  async (kind) => {
    const approved = await approve();
    const review: any = structuredClone(approved);
    if (kind === 'ausente') delete review.approval;
    if (kind === 'antigo')
      await editCandidate((e) => {
        e.revision++;
      });
    if (kind === 'fabricado') review.approval = { candidateSha256: '0'.repeat(64) };
    if (kind === 'malformado') review.approval = { candidateSha256: 'not-a-hash' };
    if (kind === 'null') review.approval = null;
    if (kind === 'extra') review.approval.extra = true;
    if (kind === 'tipo') review.approval.candidateSha256 = 123;
    await writeFile(path('reviews'), json(review));
    const before = await bytes();
    await expect(loadCandidate(root, id)).rejects.toThrow();
    await expect(workflowStatus(root, id)).rejects.toThrow();
    await expect(validateAll(root)).rejects.toThrow();
    await expect(promote(root, id, 'PROMOVER')).rejects.toThrow();
    expect(await bytes()).toEqual(before);
    await cp(path('candidates'), production());
    await commit();
    await expect(contentGate(root, releaseBaselineCommit)).rejects.toThrow();
  },
);
it('digest em draft/in-review não é consentimento; só approve estabelece vínculo', async () => {
  const raw = JSON.parse(await readFile(path('candidates'), 'utf8'));
  for (const status of ['draft', 'in-review'])
    expect(() =>
      reviewSchema.parse({
        ...reviewTemplate,
        status,
        approval: { candidateSha256: candidateFingerprint(raw) },
      }),
    ).toThrow(/status approved/);
  expect(() =>
    validateCandidate(
      raw,
      {
        ...reviewTemplate,
        examId: id,
        status: 'draft',
        requirements: { ...reviewTemplate.requirements, essayCount: 1 },
      },
      `${id}.json`,
    ),
  ).not.toThrow();
});
it('correção legítima invalida aprovação, incrementa revision e requer nova decisão', async () => {
  const first = await approve();
  await editCandidate((e) => {
    e.revision++;
    e.questions[0].correctAnswer = 'b';
  });
  const { approval: _approval, ...review } = first;
  await writeFile(
    path('reviews'),
    json({
      ...review,
      status: 'in-review',
      reviewedBy: null,
      checks: Object.fromEntries(Object.keys(review.checks).map((key) => [key, false])),
      notes: [...review.notes, 'Fonte neutra: discrepância fictícia corrigida, revision 2.'],
    }),
  );
  expect(await workflowStatus(root, id)).toMatchObject({
    state: 'awaiting-human-review',
    candidateRevision: 2,
  });
  await expect(promote(root, id, 'PROMOVER')).rejects.toThrow(/approved/);
  const second = await approve();
  expect(second.approval).not.toEqual(first.approval);
  await promote(root, id, 'PROMOVER');
});
it('os quatro conjuntos históricos conferem bytes e manifesto com o commit fixo; status/readers zero-write', async () => {
  await run('git', ['checkout', '--quiet', historicalApprovalCommit], { cwd: root });
  await rm(path('candidates'));
  await rm(path('reviews'));
  const before = await bytes();
  expect(Object.keys(historicalApprovals)).toHaveLength(4);
  expect(await validateAll(root)).toBe(4);
  for (const [historicalId, evidence] of Object.entries(historicalApprovals)) {
    const pair = await loadCandidate(root, historicalId);
    expect(pair.review.status).toBe('approved');
    expect(pair.review.approval).toBeUndefined();
    expect(await workflowStatus(root, historicalId)).toMatchObject({ state: 'promoted' });
    for (const [key, directory] of [
      ['candidate', 'authoring/candidates'],
      ['review', 'authoring/reviews'],
      ['generation', 'authoring/generations'],
      ['production', 'data/exams'],
    ] as const) {
      const file = `${directory}/${historicalId}.json`;
      const original = (
        await run('git', ['show', `${historicalApprovalCommit}:${file}`], {
          cwd: root,
          encoding: 'buffer',
        })
      ).stdout;
      expect(await readFile(join(root, file))).toEqual(original);
      expect(digest(original)).toBe(evidence[key]);
      if (key === 'candidate' || key === 'review')
        expect(candidateFingerprint(JSON.parse(original.toString('utf8')))).toBe(
          evidence[`${key}Canonical`],
        );
    }
  }
  expect(await contentGate(root, historicalApprovalCommit)).toBe(0);
  expect(await bytes()).toEqual(before);
});
it.each(['candidate', 'review', 'generation', 'production', 'delete-set', 'rename-set'])(
  'Gate rejeita alteração histórica %s',
  async (part) => {
    await run('git', ['checkout', '--quiet', historicalApprovalCommit], { cwd: root });
    await rm(path('candidates'));
    await rm(path('reviews'));
    const historicalId = Object.keys(historicalApprovals)[0]!;
    const dirs = [
      'authoring/candidates',
      'authoring/reviews',
      'authoring/generations',
      'data/exams',
    ];
    const dirsByKey: Record<string, string> = {
      candidate: dirs[0]!,
      review: dirs[1]!,
      generation: dirs[2]!,
      production: dirs[3]!,
    };
    if (part.endsWith('set')) {
      for (const directory of dirs) {
        const file = join(root, directory, `${historicalId}.json`);
        if (part === 'delete-set') await rm(file);
        else await rename(file, join(root, directory, 'renomeado.json'));
      }
    } else {
      const file = join(root, dirsByKey[part]!, `${historicalId}.json`);
      await writeFile(file, Buffer.concat([await readFile(file), Buffer.from('\n')]));
      await expect(loadCandidate(root, historicalId)).rejects.toThrow(/histórico alterado/);
    }
    await commit();
    await expect(contentGate(root, historicalApprovalCommit)).rejects.toThrow();
  },
);
it('escopo F01 preserva todos os dados, runtime, Exam/generation, dependências e publicação', async () => {
  const paths = [
    'data',
    'authoring',
    'src',
    'public',
    'app',
    'simulados',
    'schema/exam.ts',
    'schema/exam.schema.json',
    'schema/generation.ts',
    '.github',
    'package.json',
    'package-lock.json',
    'AGENTS.md',
  ];
  // F02 explicitly changes only the catalog's read-only history parser.
  // All other F01-protected paths remain byte-identical to the historical baseline.
  expect(
    (await run('git', [
      'diff',
      historicalApprovalCommit,
      '--',
      ...paths,
      ':(exclude)src/engine/catalog-progress.ts',
    ])).stdout,
  ).toBe('');
  expect(
    (await run('git', ['ls-files', '--others', '--exclude-standard', '--', ...paths])).stdout,
  ).toBe('');
});

it('quinto ID sem binding é rejeitado ao lado dos quatro conjuntos históricos e production correspondente', async () => {
  const review = await approve();
  const { approval: _binding, ...unbound } = review;
  await writeFile(path('reviews'), json(unbound));
  await run('git', ['checkout', '--quiet', historicalApprovalCommit], { cwd: root });
  await cp(path('candidates'), production());
  await commit();
  await expect(validateAll(root)).rejects.toThrow(/sem vínculo de aprovação/);
  await expect(contentGate(root, historicalApprovalCommit)).rejects.toThrow(
    /sem vínculo de aprovação/,
  );
  for (const historicalId of Object.keys(historicalApprovals))
    expect((await loadCandidate(root, historicalId)).review.status).toBe('approved');
});
it('cleanup de spans também rejeita vínculo antigo mesmo com candidate e production iguais', async () => {
  await editCandidate((e) => {
    e.questions[0].statement[0].text += '[span_1](start_span)[span_1](end_span)';
  });
  await approve();
  await promote(root, id, 'PROMOVER');
  await commit();
  const base = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  await editCandidate((e) => {
    e.questions[0].statement[0].text = e.questions[0].statement[0].text.replace(
      '[span_1](start_span)[span_1](end_span)',
      '',
    );
  });
  await cp(path('candidates'), production());
  await commit();
  const before = await bytes();
  await expect(contentGate(root, base)).rejects.toThrow(/aprovação divergente/);
  expect(await bytes()).toEqual(before);
});
