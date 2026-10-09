import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  rename,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import examTemplate from '../authoring/templates/exam.example.json';
import reviewTemplate from '../authoring/templates/review.example.json';
import { reviewSchema } from '../schema/authoring';
import { parseExam } from '../schema/exam';
import { contentGate } from '../scripts/authoring/gate';
import {
  loadCandidate,
  normalizeText,
  promote,
  validateAll,
  validateCandidate,
} from '../scripts/authoring/core';
import {
  assertReleaseBaseline,
  releaseBaselineCommit,
  migratedExamIds,
  migratedBaseline,
  examCounts,
} from '../scripts/release-baseline';
import { readExamCatalog } from '../scripts/catalog';
import { removeSpanArtifacts } from '../scripts/span-artifacts';

const run = promisify(execFile);
const fixture = () => ({
  exam: structuredClone(examTemplate),
  review: reviewSchema.parse(structuredClone(reviewTemplate)),
});
function approved() {
  const pair = fixture();
  pair.review.status = 'approved';
  pair.review.reviewedBy = 'Revisor humano de teste';
  for (const key of Object.keys(pair.review.checks) as (keyof typeof pair.review.checks)[])
    pair.review.checks[key] = true;
  return pair;
}
const validate = (pair = fixture()) =>
  validateCandidate(pair.exam, pair.review, `${pair.exam.id}.json`);

it('review estrito válido e templates usam o Schema v1 seguro', () => {
  expect(reviewSchema.parse(reviewTemplate).status).toBe('draft');
  expect(validate().exam.schemaVersion).toBe(1);
  expect(() => reviewSchema.parse({ ...reviewTemplate, extra: true })).toThrow();
});
it.each([
  'sourceCoverageReviewed',
  'answerKeyReviewed',
  'explanationsReviewed',
  'duplicateCheckReviewed',
] as const)('approved exige check %s', (key) => {
  const pair = approved();
  pair.review.checks[key] = false;
  expect(() => validate(pair)).toThrow(/checklist/);
});
it.each([null, '', '  '])('approved exige reviewedBy não vazio: %s', (value) => {
  const pair = approved();
  pair.review.reviewedBy = value;
  expect(() => validate(pair)).toThrow();
});
it('ai-assisted só pode ser aprovado com provider/model/promptVersion', () => {
  const pair = approved();
  pair.review.generation.mode = 'ai-assisted';
  expect(() => validate(pair)).toThrow(/metadata/);
  Object.assign(pair.review.generation, {
    provider: 'fictício',
    model: 'mock',
    promptVersion: 'v1',
  });
  expect(validate(pair).review.status).toBe('approved');
});
it.each([
  [
    'examId',
    (p: ReturnType<typeof fixture>) => {
      p.review.examId = 'outro';
    },
  ],
  [
    'objectiveCount',
    (p: ReturnType<typeof fixture>) => {
      p.review.requirements.objectiveCount = 2;
    },
  ],
  [
    'essayCount',
    (p: ReturnType<typeof fixture>) => {
      p.review.requirements.essayCount = 1;
    },
  ],
  [
    'optionsPerObjective',
    (p: ReturnType<typeof fixture>) => {
      p.review.requirements.optionsPerObjective = 5;
    },
  ],
  [
    'sourceFile',
    (p: ReturnType<typeof fixture>) => {
      p.review.source.fileName = 'outro.txt';
    },
  ],
  [
    'sourceSha256',
    (p: ReturnType<typeof fixture>) => {
      p.review.source.sha256 = '1'.repeat(64);
    },
  ],
] as const)('rejeita %s divergente', (field, mutate) => {
  const pair = fixture();
  mutate(pair);
  expect(() => validate(pair)).toThrow(field);
});
it('hash inválido e filename divergente falham', () => {
  const pair = fixture();
  pair.review.source.sha256 = 'inválido';
  expect(() => validate(pair)).toThrow();
  expect(() => validateCandidate(examTemplate, reviewTemplate, 'outro.json')).toThrow(/Filename/);
});
it('normaliza diacríticos, pontuação, caixa e whitespace; duplicata de enunciado falha', () => {
  expect(normalizeText('  ÁRVORE, azul!\n')).toBe('arvore azul');
  const pair = fixture();
  pair.exam.questions.push({
    ...structuredClone(pair.exam.questions[0]!),
    id: 'q2',
    statement: [{ type: 'text', text: 'QUAL PALÁVRA REPRESENTA O NÚMERO UM!' }],
  });
  pair.review.requirements.objectiveCount = 2;
  expect(() => validate(pair)).toThrow(/Enunciados.*duplicata/);
});
it('alternativa duplicada normalizada falha', () => {
  const pair = fixture();
  pair.exam.questions[0]!.options[1]!.text = [{ type: 'text', text: ' ÚM! ' }];
  expect(() => validate(pair)).toThrow(/alternativas.*duplicata/);
});
it('Schema v1 aceita commit, SHA-256 e ambos; exige ao menos um válido', () => {
  const { exam } = fixture();
  const base = { sourceFile: 'a.txt', notes: [] };
  for (const identity of [
    { sourceCommit: 'a'.repeat(40) },
    { sourceSha256: 'b'.repeat(64) },
    { sourceSha256: 'B'.repeat(64) },
    { sourceCommit: 'a'.repeat(40), sourceSha256: 'b'.repeat(64) },
  ])
    expect(parseExam({ ...exam, provenance: { ...base, ...identity } }).schemaVersion).toBe(1);
  for (const identity of [
    {},
    { sourceCommit: 'falso' },
    { sourceSha256: 'z'.repeat(64) },
    { sourceCommit: 'a'.repeat(40), sourceSha256: 'inválido' },
  ])
    expect(() => parseExam({ ...exam, provenance: { ...base, ...identity } })).toThrow();
});
it('prova somente dissertativa aceita optionsPerObjective null', () => {
  const { exam, review } = fixture();
  const { options: _options, correctAnswer: _answer, ...question } = exam.questions[0]!;
  const essay = {
    ...exam,
    questions: [
      { ...question, type: 'essay', modelAnswer: [{ type: 'text', text: 'Exemplo de resposta' }] },
    ],
  };
  review.requirements = { objectiveCount: 0, essayCount: 1, optionsPerObjective: null };
  expect(validateCandidate(essay, review, `${exam.id}.json`).exam.questions[0]!.type).toBe('essay');
});
it('17 JSONs atuais validam e baseline é individual e byte a byte', async () => {
  await assertReleaseBaseline();
  const { exams } = await readExamCatalog();
  expect(examCounts(migratedBaseline([...exams, parseExam(examTemplate)]))).toEqual({
    exams: 17,
    questions: 485,
    objective: 462,
    essay: 23,
    options: 2187,
    groups: 3,
  });
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'medsim-authoring-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function repository() {
  await run('git', ['clone', '--shared', '--quiet', '--no-checkout', process.cwd(), root]);
  await run('git', ['checkout', '--quiet', releaseBaselineCommit], { cwd: root });
  for (const dir of ['authoring/candidates', 'authoring/reviews', 'authoring/templates'])
    await mkdir(join(root, dir), { recursive: true });
}
async function writePair(pair = approved()) {
  await writeFile(
    join(root, `authoring/candidates/${pair.exam.id}.json`),
    JSON.stringify(pair.exam),
  );
  await writeFile(
    join(root, `authoring/reviews/${pair.exam.id}.json`),
    JSON.stringify(pair.review),
  );
  return pair;
}
async function commit() {
  await run('git', ['add', '-A'], { cwd: root });
  await run(
    'git',
    [
      '-c',
      'user.name=Teste',
      '-c',
      'user.email=teste@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Fixture',
    ],
    { cwd: root },
  );
}
async function addition(pair = approved()) {
  await writePair(pair);
  await writeFile(join(root, `data/exams/${pair.exam.id}.json`), JSON.stringify(pair.exam));
  await commit();
  return pair;
}
it('zero candidates e templates explicitamente ignorados são válidos', async () => {
  await repository();
  await writeFile(join(root, 'authoring/templates/exam.example.json'), '{}');
  await writeFile(join(root, 'authoring/candidates/exam.example.json'), '{}');
  expect(await validateAll(root)).toBe(0);
  await expect(loadCandidate(root, 'exam.example')).rejects.toThrow();
  expect(await contentGate(root, releaseBaselineCommit)).toBe(0);
});
it('candidate sem review e review órfão falham', async () => {
  await repository();
  const pair = await writePair();
  await rm(join(root, `authoring/reviews/${pair.exam.id}.json`));
  await expect(loadCandidate(root, pair.exam.id)).rejects.toThrow();
  await expect(validateAll(root)).rejects.toThrow(/correspondente/);
});
it('promoção exige confirmação literal', async () => {
  await expect(promote(root, 'exemplo-neutro', undefined)).rejects.toThrow(/PROMOVER/);
});
it('promoção rejeita review draft', async () => {
  await repository();
  const pair = await writePair(fixture());
  await expect(promote(root, pair.exam.id, 'PROMOVER')).rejects.toThrow(/approved/);
});
it('promoção válida copia bytes exatos e mantém par auditável', async () => {
  await repository();
  const pair = await writePair();
  const target = await promote(root, pair.exam.id, 'PROMOVER');
  expect(await readFile(target)).toEqual(
    await readFile(join(root, `authoring/candidates/${pair.exam.id}.json`)),
  );
  expect(await validateAll(root)).toBe(1);
  await expect(promote(root, pair.exam.id, 'PROMOVER')).rejects.toThrow(/ID já existe/);
  await assertReleaseBaseline(root);
});
it('promoção rejeita colisão com ID migrado', async () => {
  await repository();
  const pair = approved();
  pair.exam.id = migratedExamIds[0]!;
  pair.review.examId = pair.exam.id;
  await writePair(pair);
  await expect(promote(root, pair.exam.id, 'PROMOVER')).rejects.toThrow(/ID já existe/);
});
it.each(['modificar', 'excluir', 'renomear'] as const)('gate rejeita %s baseline', async (mode) => {
  await repository();
  const file = join(root, `data/exams/${migratedExamIds[0]}.json`);
  if (mode === 'modificar') await writeFile(file, (await readFile(file, 'utf8')) + '\n');
  else if (mode === 'excluir') await rm(file);
  else await rename(file, join(root, 'data/exams/renomeado.json'));
  await commit();
  await expect(contentGate(root, releaseBaselineCommit)).rejects.toThrow();
});
it('gate aceita nova prova mock aprovada e catálogo extensível', async () => {
  await repository();
  await addition();
  expect(await contentGate(root, releaseBaselineCommit)).toBe(1);
  expect((await readExamCatalog(join(root, 'data/exams'))).exams).toHaveLength(18);
});
async function modifiedExam(spans = true) {
  await repository();
  const pair = approved();
  if (spans) pair.exam.questions[0]!.statement[0]!.text += '[span_1](start_span)[span_1](end_span)';
  await addition(pair);
  const base = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const file = join(root, `data/exams/${pair.exam.id}.json`);
  const original = await readFile(file, 'utf8');
  return { base, file, original, cleaned: removeSpanArtifacts(original) };
}
it('gate aceita M com remoção exata de spans e conta zero adições', async () => {
  const { base, file, original, cleaned } = await modifiedExam();
  expect(cleaned).not.toBe(original);
  await writeFile(file, cleaned);
  // This fixture has a retained candidate; keep the existing production equality check valid.
  await writeFile(join(root, 'authoring/candidates/exemplo-neutro.json'), cleaned);
  await commit();
  expect(await contentGate(root, base)).toBe(0);
});
const academicChanges: [string, (exam: typeof examTemplate) => void][] = [
  [
    'uma letra',
    (exam) => {
      exam.questions[0]!.statement[0]!.text = exam.questions[0]!.statement[0]!.text.replace(
        'Qual',
        'qual',
      );
    },
  ],
  [
    'opção',
    (exam) => {
      exam.questions[0]!.options[0]!.text[0]!.text += '!';
    },
  ],
  [
    'gabarito',
    (exam) => {
      exam.questions[0]!.correctAnswer = 'b';
    },
  ],
  [
    'explanation',
    (exam) => {
      exam.questions[0]!.explanation[0]!.text += '!';
    },
  ],
  [
    'categoria',
    (exam) => {
      exam.questions[0]!.category += '!';
    },
  ],
  [
    'tag',
    (exam) => {
      exam.tags.push('nova');
    },
  ],
  [
    'revision',
    (exam) => {
      exam.revision++;
    },
  ],
  [
    'ID',
    (exam) => {
      exam.questions[0]!.id = 'q2';
    },
  ],
  [
    'whitespace',
    (exam) => {
      exam.questions[0]!.statement[0]!.text += ' ';
    },
  ],
  [
    'pontuação',
    (exam) => {
      exam.questions[0]!.statement[0]!.text += '!';
    },
  ],
  [
    'reordenação',
    (exam) => {
      exam.questions[0]!.options.reverse();
    },
  ],
];
it.each(academicChanges)(
  'gate rejeita spans removidos mais alteração de %s',
  async (_label, mutate) => {
    const { base, file, cleaned } = await modifiedExam();
    const exam: typeof examTemplate = JSON.parse(cleaned);
    mutate(exam);
    await writeFile(file, JSON.stringify(exam));
    await commit();
    await expect(contentGate(root, base)).rejects.toThrow(/exclusivamente remoção exata/);
  },
);
it('gate rejeita M sem spans e com alteração acadêmica', async () => {
  const { base, file, original } = await modifiedExam(false);
  await writeFile(file, original.replace('Qual', 'qual'));
  await commit();
  await expect(contentGate(root, base)).rejects.toThrow(/remoção real de spans/);
});
it('gate rejeita M sem remoção real mesmo com bytes iguais à base', async () => {
  const { base, file, original } = await modifiedExam(false);
  await chmod(file, 0o755);
  await commit();
  expect(await readFile(file, 'utf8')).toBe(original);
  await expect(contentGate(root, base)).rejects.toThrow(/remoção real de spans/);
});
it('gate rejeita cleanup parcial e whitespace externo adicional', async () => {
  const { base, file, original, cleaned } = await modifiedExam();
  for (const invalid of [original.replace('[span_1](start_span)', ''), cleaned + '\n']) {
    await writeFile(file, invalid);
    await commit();
    await expect(contentGate(root, base)).rejects.toThrow(/exclusivamente remoção exata/);
  }
});
it.each(['D', 'R', 'T'] as const)(
  'gate mantém rejeição de %s em prova não baseline',
  async (status) => {
    const { base, file } = await modifiedExam();
    if (status === 'R') await rename(file, join(root, 'data/exams/renomeado.json'));
    else {
      await rm(file);
      if (status === 'T') await symlink('../simulados.json', file);
    }
    await commit();
    await expect(contentGate(root, base)).rejects.toThrow(/somente adições/);
  },
);
it('gate conta somente A ao combinar adição aprovada e cleanup M', async () => {
  await repository();
  const file = join(root, 'data/exams/farmaco-p2-2025.json');
  await writeFile(file, removeSpanArtifacts(await readFile(file, 'utf8')));
  await addition();
  expect(await contentGate(root, releaseBaselineCommit)).toBe(1);
});
it('gate aceita os três cleanups reais da 7B.1 contra a base aprovada', async () => {
  await repository();
  const base = 'd1d9fc3fac7a99f6ad51ccf4153b25e263b07a93';
  await run('git', ['checkout', '--quiet', base], { cwd: root });
  for (const id of ['farmaco-p2-2025', 'imunologia-b4-2023', 'imunologia-b4-2024']) {
    const file = `data/exams/${id}.json`;
    const original = await readFile(join(root, file), 'utf8');
    const actual = await readFile(file, 'utf8');
    expect(actual).toBe(removeSpanArtifacts(original));
    expect(actual).not.toBe(original);
    await writeFile(join(root, file), actual);
  }
  await commit();
  expect(await contentGate(root, base)).toBe(0);
});
it('gate não aplica a exceção de spans a A sem review approved', async () => {
  await repository();
  const pair = fixture();
  pair.exam.questions[0]!.statement[0]!.text += '[span_1](start_span)[span_1](end_span)';
  await addition(pair);
  await expect(contentGate(root, releaseBaselineCommit)).rejects.toThrow(/approved/);
});
it('gate rejeita nova prova sem review', async () => {
  await repository();
  const pair = await addition();
  await rm(join(root, `authoring/reviews/${pair.exam.id}.json`));
  await commit();
  await expect(contentGate(root, releaseBaselineCommit)).rejects.toThrow();
});
it('gate rejeita candidate diferente de production', async () => {
  await repository();
  const pair = await addition();
  pair.exam.title = 'Diferente';
  await writePair(pair);
  await commit();
  await expect(contentGate(root, releaseBaselineCommit)).rejects.toThrow(
    /diferentes semanticamente/,
  );
});
it('gate rejeita review draft e modificações de prova anteriormente adicionada', async () => {
  await repository();
  await addition(fixture());
  await expect(contentGate(root, releaseBaselineCommit)).rejects.toThrow(/approved/);
  const base = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const pair = approved();
  pair.exam.title = 'Revisada';
  await addition(pair);
  await expect(contentGate(root, base)).rejects.toThrow(/somente adições/);
});
it('hash CLI usa crypto, imprime basename e não copia arquivo', async () => {
  const file = join(root, 'Fonte local.txt');
  await writeFile(file, 'Fonte neutra');
  const { stdout, stderr } = await run(process.execPath, [
    '--import',
    'tsx',
    'scripts/authoring/cli.ts',
    'hash',
    '--file',
    file,
  ]);
  expect(stderr).toBe('');
  expect(stdout).toBe(
    `File: Fonte local.txt\nSHA-256: ${createHash('sha256').update('Fonte neutra').digest('hex')}\n`,
  );
  expect(stdout).not.toContain(root);
});
it('validação reaproveita IDs internos e gabarito do parseExam', () => {
  const pair = fixture();
  pair.exam.questions[0]!.correctAnswer = 'ausente';
  expect(() => validate(pair)).toThrow(/Gabarito/);
  const duplicate = fixture();
  duplicate.exam.questions[0]!.options[1]!.id = 'a';
  expect(() => validate(duplicate)).toThrow(/ID duplicado/);
});
it('promoção reverte somente a nova cópia quando asset não existe', async () => {
  await repository();
  const pair = approved();
  pair.exam.images = [
    { src: 'media/ausente.png', alt: 'Mock' },
  ] as unknown as typeof pair.exam.images;
  await writePair(pair);
  await expect(promote(root, pair.exam.id, 'PROMOVER')).rejects.toThrow(/Arquivo ausente/);
  await expect(readFile(join(root, `data/exams/${pair.exam.id}.json`))).rejects.toThrow();
  await assertReleaseBaseline(root);
});
it('gate rejeita duplicata em adição aprovada', async () => {
  await repository();
  const pair = approved();
  pair.exam.questions[0]!.options[1]!.text = structuredClone(
    pair.exam.questions[0]!.options[0]!.text,
  );
  await addition(pair);
  await expect(contentGate(root, releaseBaselineCommit)).rejects.toThrow(/duplicata/);
});
it('CLI retorna exit code não zero para erro de authoring e promoção sem confirmação', async () => {
  await expect(
    run(process.execPath, [
      '--import',
      'tsx',
      'scripts/authoring/cli.ts',
      'validate',
      '--id',
      'ausente',
    ]),
  ).rejects.toMatchObject({ code: 1 });
  await expect(
    run(process.execPath, [
      '--import',
      'tsx',
      'scripts/authoring/cli.ts',
      'promote',
      '--id',
      'exemplo-neutro',
    ]),
  ).rejects.toMatchObject({ code: 1 });
});
it('validate-dist aceita catálogo com 18 mocks e rejeita payload divergente', async () => {
  await repository();
  await addition();
  const { exams, catalog } = await readExamCatalog(join(root, 'data/exams'), join(root, 'public'));
  const dist = join(root, 'dist');
  await mkdir(join(dist, 'generated/exams'), { recursive: true });
  await mkdir(join(dist, 'assets'));
  await mkdir(join(dist, 'legacy'));
  await writeFile(
    join(dist, 'index.html'),
    (await readFile('app/index.html', 'utf8'))
      .replaceAll('%BASE_URL%', '/CHATGPT/')
      .replace('href="/favicon.svg"', 'href="/CHATGPT/favicon.svg"')
      .replace('src="/main.ts"', 'src="/CHATGPT/assets/app.js"')
      .replace('</head>', '<link rel="stylesheet" href="/CHATGPT/assets/app.css"></head>'),
  );
  // Include the new release assets in this synthetic dist; retain all academic assertions.
  for (const path of ['manifest.webmanifest', 'sw.js', 'icons', 'favicon.svg'])
    await cp(join(process.cwd(), 'public', path), join(dist, path), { recursive: true });
  await writeFile(join(dist, 'assets/app.css'), 'body {}');
  await writeFile(join(dist, 'assets/app.js'), '// Mock estático');
  await writeFile(join(dist, 'generated/exam-index.json'), JSON.stringify(catalog));
  for (const exam of exams)
    await writeFile(join(dist, `generated/exams/${exam.id}.json`), JSON.stringify(exam));
  for (const path of [
    'index.html',
    'simulados.json',
    'simulados',
    'desempenho-estatisticas.js',
    'ajustes-voltar-hub-v5.js',
    'branding-medsim.js',
    'backup-medsim.js',
    'grifar-borracha.js',
  ])
    await cp(join(root, path), join(dist, 'legacy', path), { recursive: true });
  const command = [
    '--import',
    join(process.cwd(), 'node_modules/tsx/dist/loader.mjs'),
    join(process.cwd(), 'scripts/validate-dist.ts'),
  ];
  const { stdout } = await run(process.execPath, command, { cwd: root });
  expect(stdout).toContain('18 provas / 486 questões / 463 objetivas / 23 dissertativas');
  await writeFile(join(dist, 'generated/exams/exemplo-neutro.json'), '{}');
  await expect(run(process.execPath, command, { cwd: root })).rejects.toThrow();
}, 15000); // Two full dist validations now also decode PNGs and validate manifest/CSP.
