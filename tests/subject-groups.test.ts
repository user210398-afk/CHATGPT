import { expect, it } from 'vitest';
import { readExamCatalog } from '../scripts/catalog';
import {
  groupCatalogExams,
  subjectGroupDefinition,
  subjectHubTotals,
} from '../src/engine/subject-groups';
import { readExamProgress } from '../src/engine/catalog-progress';
import { allExamsUrl, resolveRoute, subjectUrl } from '../src/utils/paths';
const { catalog } = await readExamCatalog();

it('19 provas aparecem exatamente uma vez, sem duplicatas ou provas sem grupo', () => {
  const exams = groupCatalogExams(catalog.exams).flatMap((group) => group.exams);
  expect(exams).toHaveLength(19);
  expect(new Set(exams.map((exam) => exam.id)).size).toBe(19);
  expect(exams.map((exam) => exam.id).sort()).toEqual(catalog.exams.map((exam) => exam.id).sort());
});

it.each([
  ['farmacologia', 5, 148],
  ['fisiologia', 3, 63],
  ['imunologia', 3, 90],
  ['microbiologia-e-virologia', 4, 120],
  ['parasitologia', 1, 31],
  ['patologia', 1, 30],
  ['propedeutica', 2, 40],
])('%s agrega %i provas / %i questões', (id, examCount, questionCount) => {
  expect(groupCatalogExams(catalog.exams).find((group) => group.id === id)).toMatchObject({
    examCount,
    questionCount,
  });
});

it.each([
  ['Farmacologia', 'farmacologia'],
  ['Farmacologia Básica', 'farmacologia'],
  ['Propedêutica', 'propedeutica'],
  ['Propedêutica/Clínica Médica', 'propedeutica'],
  ['Microbiologia/Virologia', 'microbiologia-e-virologia'],
  ['Patologia/Imunologia', 'patologia'],
])('alias %s pertence a %s', (subject, id) => expect(subjectGroupDefinition(subject).id).toBe(id));

it('membership obrigatório segue subject acadêmico, inclusive imunologia-b4-2024', () => {
  const groups = groupCatalogExams(catalog.exams);
  expect(
    groups
      .find((group) => group.id === 'farmacologia')!
      .exams.map((exam) => exam.id)
      .sort(),
  ).toEqual([
    'farmaco-p2-2023',
    'farmaco-p2-2024',
    'farmaco-p2-2025',
    'farmacologia-anti-hipertensivos-teste-2026',
    'farmacologia-parassimpatoliticos',
  ]);
  expect(
    groups
      .find((group) => group.id === 'propedeutica')!
      .exams.map((exam) => exam.id)
      .sort(),
  ).toEqual(['propedeu-p2-2024', 'propedeu-p2-2025']);
  expect(
    groups.find((group) => group.id === 'microbiologia-e-virologia')!.exams.map((exam) => exam.id),
  ).toContain('imunologia-b4-2024');
});

it('subject desconhecido cria grupo próprio com nome original e rota estável', () => {
  const exam = { ...catalog.exams[0]!, subject: 'Neurologia Pediátrica' };
  const [group] = groupCatalogExams([exam]);
  expect(group!.title).toBe(exam.subject);
  expect(group!.exams).toEqual([exam]);
  expect(resolveRoute(new URL(subjectUrl(group!.id), 'https://example.org').search).area).toBe(
    group!.id,
  );
});

it('colisões de normalização, caixa, pontuação e nomes reservados têm identidade própria', () => {
  const subjects = [
    'Área Nova',
    'Area Nova',
    'area nova',
    'Area/Nova',
    'Area-Nova',
    'Clínica Médica',
    'Clinica Medica',
    'A/B',
    'A B',
    'Área X',
    'Area X',
    'farmacologia',
    '🧠',
    '🫀',
  ];
  const exams = subjects.map((subject, index) => ({
    ...catalog.exams[0]!,
    id: `future-${index}`,
    subject,
  }));
  const groups = groupCatalogExams(exams);
  expect(groups).toHaveLength(subjects.length);
  expect(new Set(groups.map((group) => group.id)).size).toBe(subjects.length);
  expect(groupCatalogExams([...exams].reverse()).map((group) => group.id)).toEqual(
    groups.map((group) => group.id),
  );
  expect(groups.flatMap((group) => group.exams)).toHaveLength(exams.length);
  for (const exam of exams) {
    const standalone = groupCatalogExams([exam])[0]!;
    const group = groups.find((group) => group.title === exam.subject)!;
    expect(group.id).toBe(standalone.id);
    expect(group.exams).toEqual([exam]);
    expect(resolveRoute(new URL(subjectUrl(group.id), 'https://example.org').search).area).toBe(
      group.id,
    );
  }
  expect(subjectGroupDefinition('farmacologia').id).not.toBe('farmacologia');
});

it('ordenação de grupos é determinística independente da ordem do catálogo', () => {
  const exams = [
    ...catalog.exams,
    ...['Zoologia', 'Área', 'Area'].map((subject) => ({ ...catalog.exams[0]!, subject })),
  ];
  const ids = (values: typeof exams) => groupCatalogExams(values).map((group) => group.id);
  expect(ids(exams)).toEqual(ids([...exams].reverse()));
  expect(ids(exams).slice(0, 7)).toEqual([
    'farmacologia',
    'fisiologia',
    'imunologia',
    'microbiologia-e-virologia',
    'parasitologia',
    'patologia',
    'propedeutica',
  ]);
});

it('agrupamento não modifica catálogo original nem objetos CatalogExam', () => {
  const before = JSON.stringify(catalog);
  const frozen = structuredClone(catalog);
  const freeze = (value: unknown): void => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(frozen);
  const progress = new Map(
    frozen.exams.map((exam) => [
      exam.id,
      readExamProgress(exam, () => ({ getItem: () => null })).progress,
    ]),
  );
  for (const value of progress.values()) freeze(value);
  const progressBefore = JSON.stringify([...progress]);
  const groups = groupCatalogExams(frozen.exams, progress);
  expect(JSON.stringify(catalog)).toBe(before);
  expect(JSON.stringify(frozen)).toBe(before);
  expect(JSON.stringify([...progress])).toBe(progressBefore);
  for (const group of groups) for (const exam of group.exams) expect(frozen.exams).toContain(exam);
});

it('agrega exclusivamente os status existentes, sem média ou percentual agregado', () => {
  const exams = catalog.exams.filter(
    (exam) => subjectGroupDefinition(exam.subject).id === 'farmacologia',
  );
  const base = readExamProgress(exams[0]!, () => ({ getItem: () => null })).progress;
  const [group] = groupCatalogExams(
    exams,
    new Map([
      [exams[0]!.id, { ...base, status: 'completed' }],
      [exams[1]!.id, { ...base, status: 'in-progress' }],
    ]),
  );
  expect(group).toMatchObject({ completedCount: 1, inProgressCount: 1, notStartedCount: 3 });
  expect(group).not.toHaveProperty('percentage');
});

it('catálogo vazio não cria grupos fantasmas', () => expect(groupCatalogExams([])).toEqual([]));

it('rotas mantêm Pages, encoding, precedência e área inválida explícita', () => {
  expect(allExamsUrl()).toBe('/CHATGPT/?view=all');
  expect(subjectUrl('área & nova')).toBe('/CHATGPT/?area=%C3%A1rea%20%26%20nova');
  expect(resolveRoute('?area=missing')).toMatchObject({ view: 'catalog', area: 'missing' });
  expect(resolveRoute('?area=')).toMatchObject({ view: 'catalog', area: '' });
  expect(resolveRoute('?view=all')).toMatchObject({ view: 'catalog', allExams: true });
  expect(resolveRoute('?exam=valid-id&area=farmacologia')).toEqual({
    view: 'exam',
    id: 'valid-id',
  });
  expect(resolveRoute('?view=settings&area=farmacologia')).toEqual({ view: 'settings' });
  for (const view of ['dashboard', 'review', 'settings']) {
    expect(resolveRoute(`?view=${view}`)).toEqual({ view });
    expect(resolveRoute(`?view=${view}&area=farmacologia`)).toEqual({ view });
  }
  expect(resolveRoute('?area=farmacologia')).toEqual({
    view: 'catalog',
    area: 'farmacologia',
  });
  expect(resolveRoute('?view=all&area=farmacologia')).toEqual({
    view: 'catalog',
    area: 'farmacologia',
  });
  expect(resolveRoute('?exam=valid-id')).toEqual({ view: 'exam', id: 'valid-id' });
  expect(resolveRoute('?exam=valid-id&view=dashboard&area=farmacologia')).toEqual({
    view: 'exam',
    id: 'valid-id',
  });
});

it('total do Hub centralizado conserva 19 simulados / 522 questões', () => {
  expect(subjectHubTotals(groupCatalogExams(catalog.exams))).toEqual({
    subjectCount: 7,
    examCount: 19,
    questionCount: 522,
  });
});
