import { test, expect, type Page } from '@playwright/test';
import { readExamCatalog } from '../../scripts/catalog';
import { createAttempt, transition } from '../../src/engine/exam-state';
import { storageKey, historyStorageKey } from '../../src/engine/persistence';
import { catalogPreferencesKey } from '../../src/engine/catalog-preferences';
import { uiPreferencesKey, defaultUiPreferences } from '../../src/engine/ui-preferences';
import { subjectGroupDefinition } from '../../src/engine/subject-groups';
import { storageFixtureJson } from '../legacy-fixtures';
import { chooseExam } from './attempt-helpers';

const { catalog, exams } = await readExamCatalog();
const farmaco = exams.find((exam) => exam.id === 'farmaco-p2-2025')!;
const other = exams.find((exam) => exam.id === 'farmaco-p2-2024')!;
const subjectCard = (page: Page, title: string) =>
  page.getByRole('article', { name: title, exact: true });
const examCard = (page: Page, id: string) =>
  page.locator('.exam-card').filter({ has: page.locator(`a[href="/CHATGPT/?exam=${id}"]`) });
const snapshot = (page: Page) =>
  page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
function monitor(page: Page) {
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', (request) =>
    errors.push(`${request.url()} ${request.failure()?.errorText}`),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => requests.push(request.url()));
  return {
    fullExams: () => requests.filter((url) => /\/generated\/exams\//.test(url)),
    check: () => {
      expect(errors).toEqual([]);
      expect(requests.every((url) => url.startsWith('http://127.0.0.1:4173/CHATGPT/'))).toBe(true);
    },
  };
}

test('7B.2A: Home, Farmacologia, back/forward, reload, Propedêutica e Todos', async ({ page }) => {
  const network = monitor(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Suas matérias' })).toBeVisible();
  await expect(page.locator('.subject-card')).toHaveCount(7);
  await expect(page.locator('.exam-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Farmacologia Básica', exact: true })).toHaveCount(
    0,
  );
  await expect(subjectCard(page, 'Farmacologia')).toContainText('5 simulados · 148 questões');
  await subjectCard(page, 'Farmacologia')
    .getByRole('link', { name: /Abrir matéria/ })
    .click();
  await expect(page).toHaveURL(/\?area=farmacologia$/);
  await expect(page.locator('.exam-card')).toHaveCount(5);
  await expect(page.getByLabel('Disciplina', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    /Matérias\s*›\s*Farmacologia/,
  );
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Farmacologia');
  await page.goBack();
  await expect(page.locator('.subject-card')).toHaveCount(7);
  await page.goForward();
  await expect(page.locator('.exam-card')).toHaveCount(5);
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Matérias' })
    .click();
  await subjectCard(page, 'Propedêutica')
    .getByRole('link', { name: /Abrir matéria/ })
    .click();
  await expect(page.locator('.exam-card')).toHaveCount(2);
  await expect(page.getByText('2 simulados · 40 questões', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Matérias' })
    .click();
  await page.getByRole('link', { name: 'Ver todos os simulados' }).click();
  await expect(page).toHaveURL(/\?view=all$/);
  await expect(page.locator('.exam-card')).toHaveCount(catalog.exams.length);
  await expect(page.getByLabel('Disciplina', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.locator('.subject-card')).toHaveCount(7);
  await page.goForward();
  await expect(page.locator('.exam-card')).toHaveCount(catalog.exams.length);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Todos os simulados');
  await page.goto('?area=farmacologia');
  await page.reload();
  await expect(page.locator('.exam-card')).toHaveCount(5);
  await page.goto('?view=all');
  await page.reload();
  await expect(page.locator('.exam-card')).toHaveCount(catalog.exams.length);
  expect(network.fullExams()).toEqual([]);
  network.check();
});

test('7B.2A: navegação zero-write com current/history/review/preferências preservados; prova carrega um Exam', async ({
  page,
}) => {
  const network = monitor(page);
  await page.goto('./');
  await expect(page.locator('.subject-card')).toHaveCount(7);
  await page.evaluate(
    (entries) => {
      for (const [key, value] of entries) localStorage.setItem(key!, value!);
    },
    [
      [
        storageKey(farmaco),
        storageFixtureJson({ storageVersion: 2, current: createAttempt(farmaco) }),
      ],
      [historyStorageKey(farmaco), '{corrupt-history'],
      [`${storageKey(farmaco)}:review`, '{corrupt-review'],
      [catalogPreferencesKey, storageFixtureJson({ storageVersion: 1, favorites: [farmaco.id] })],
      [
        uiPreferencesKey,
        storageFixtureJson({
          ...defaultUiPreferences,
          storageVersion: 1,
          attemptModePreference: undefined,
          setupPrompt: 'dismissed',
        }),
      ],
    ],
  );
  const before = await snapshot(page);
  await page.addInitScript(() => {
    const observed = window as unknown as { storageWrites: string[] };
    observed.storageWrites = [];
    for (const method of ['setItem', 'removeItem', 'clear'] as const) {
      const original = Storage.prototype[method];
      Object.defineProperty(Storage.prototype, method, {
        value: function (...args: string[]) {
          observed.storageWrites.push(method);
          return Reflect.apply(original, this, args);
        },
      });
    }
  });
  async function unchanged() {
    expect(await snapshot(page)).toEqual(before);
    expect(
      await page.evaluate(() => (window as unknown as { storageWrites: string[] }).storageWrites),
    ).toEqual([]);
  }
  await page.reload();
  await expect(page.locator('.subject-card')).toHaveCount(7);
  await unchanged();
  expect(network.fullExams()).toHaveLength(0);
  await subjectCard(page, 'Farmacologia')
    .getByRole('link', { name: /Abrir matéria/ })
    .click();
  await expect(page.locator('.exam-card')).toHaveCount(5);
  await unchanged();
  expect(network.fullExams()).toHaveLength(0);
  await page.getByRole('searchbox').fill('farmacologia');
  await unchanged();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await unchanged();
  await page.reload();
  await expect(page.locator('.exam-card')).toHaveCount(5);
  await unchanged();
  await page.goBack();
  await expect(page.locator('.subject-card')).toHaveCount(7);
  await unchanged();
  await page.getByRole('link', { name: 'Ver todos os simulados' }).click();
  await expect(page.locator('.exam-card')).toHaveCount(catalog.exams.length);
  await page.getByLabel('Ano', { exact: true }).selectOption('2025');
  await unchanged();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.locator('.exam-card')).toHaveCount(catalog.exams.length);
  await unchanged();
  await page.goto('?area=inexistente');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Matéria não encontrada.');
  await unchanged();
  await page.getByRole('link', { name: 'Voltar para Matérias' }).click();
  await expect(page.locator('.subject-card')).toHaveCount(7);
  await unchanged();
  await page.getByRole('link', { name: 'Ver todos os simulados' }).click();
  await expect(page.locator('.exam-card')).toHaveCount(catalog.exams.length);
  await unchanged();
  expect(network.fullExams()).toHaveLength(0);
  await examCard(page, farmaco.id)
    .getByRole('link', { name: /Continuar/ })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(farmaco.title);
  expect(network.fullExams()).toEqual([
    `http://127.0.0.1:4173/CHATGPT/generated/exams/${farmaco.id}.json`,
  ]);
  network.check();
});

test('7B.2A: progresso existente, favoritos por prova e filtros combinados na matéria', async ({
  page,
}) => {
  const studyCurrent = exams.find((exam) => exam.id === 'farmaco-p2-2023')!;
  const studyComplete = exams.find((exam) => exam.id === 'farmacologia-parassimpatoliticos')!;
  const unrelated = exams.find((exam) => exam.subject === 'Fisiologia')!;
  await page.goto('./');
  await expect(page.locator('.subject-card')).toHaveCount(7);
  await page.evaluate(
    (entries) => {
      for (const [key, value] of entries) localStorage.setItem(key!, value!);
    },
    [
      [
        storageKey(farmaco),
        storageFixtureJson({
          storageVersion: 2,
          current: {
            ...createAttempt(farmaco),
            answers: { [farmaco.questions[0]!.id]: 'option-1' },
          },
        }),
      ],
      [
        storageKey(other),
        storageFixtureJson({
          storageVersion: 2,
          current: transition(other, createAttempt(other, '2026-10-03T10:00:00.000Z'), {
            type: 'finish',
            now: '2026-10-03T11:00:00.000Z',
          }),
        }),
      ],
      [
        storageKey(studyCurrent),
        JSON.stringify({
          storageVersion: 3,
          current: createAttempt(
            studyCurrent,
            '2026-10-03T10:00:00.000Z',
            'study-current',
            'study',
          ),
        }),
      ],
      [
        storageKey(studyComplete),
        JSON.stringify({
          storageVersion: 3,
          current: transition(
            studyComplete,
            createAttempt(studyComplete, '2026-10-03T10:00:00.000Z', 'study-complete', 'study'),
            { type: 'finish', now: '2026-10-03T11:00:00.000Z' },
          ),
        }),
      ],
      [
        catalogPreferencesKey,
        storageFixtureJson({ storageVersion: 1, favorites: [farmaco.id, unrelated.id] }),
      ],
    ],
  );
  await page.reload();
  await expect(subjectCard(page, 'Farmacologia')).toContainText(
    '2 concluídos · 2 em andamento · 1 não iniciado',
  );
  await subjectCard(page, 'Farmacologia')
    .getByRole('link', { name: /Abrir matéria/ })
    .click();
  await expect(examCard(page, farmaco.id)).toContainText('Respondidas 1 de 42');
  await expect(examCard(page, other.id)).toContainText('Último resultado: 0%');
  await expect(examCard(page, other.id)).toContainText('1 tentativa concluída');
  await expect(
    examCard(page, studyCurrent.id).getByRole('link', { name: /Continuar/ }),
  ).toBeVisible();
  await expect(examCard(page, studyComplete.id)).toContainText('1 tentativa concluída');
  await page.getByRole('searchbox').fill('farmacologia');
  await page.getByLabel('Ano', { exact: true }).selectOption('2025');
  await page.getByLabel('Status', { exact: true }).selectOption('in-progress');
  await page.getByLabel('Tipo', { exact: true }).selectOption('objective-only');
  await page.getByLabel('Favoritos', { exact: true }).selectOption('favorites');
  await page.getByLabel('Ordenação', { exact: true }).selectOption('recent');
  await expect(page.locator('.exam-card')).toHaveCount(1);
  await examCard(page, farmaco.id)
    .getByRole('button', { name: /Remover .* dos favoritos/ })
    .click();
  await expect(page.locator('.exam-card')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Nenhuma prova encontrada');
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await examCard(page, farmaco.id)
    .getByRole('button', { name: /Adicionar .* aos favoritos/ })
    .click();
  await page.reload();
  await expect(
    examCard(page, farmaco.id).getByRole('button', { name: /Remover .* dos favoritos/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.app-nav').getByRole('link', { name: 'Matérias' }).click();
  await page.getByRole('link', { name: 'Ver todos os simulados' }).click();
  await expect(
    examCard(page, farmaco.id).getByRole('button', { name: /Remover .* dos favoritos/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    examCard(page, unrelated.id).getByRole('button', { name: /Remover .* dos favoritos/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Disciplina', { exact: true }).selectOption('Fisiologia');
  await page.getByRole('searchbox').fill('fisiologia');
  await page.locator('.app-nav').getByRole('link', { name: 'Matérias' }).click();
  await subjectCard(page, 'Propedêutica')
    .getByRole('link', { name: /Abrir matéria/ })
    .click();
  await expect(page.locator('.exam-card')).toHaveCount(2);
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('all');
  await expect(page.getByLabel('Disciplina', { exact: true })).toHaveCount(0);
  await page.locator('.app-nav').getByRole('link', { name: 'Matérias' }).click();
  await subjectCard(page, 'Farmacologia')
    .getByRole('link', { name: /Abrir matéria/ })
    .click();
  await expect(page.locator('.exam-card')).toHaveCount(5);
  await expect(
    examCard(page, farmaco.id).getByRole('button', { name: /Remover .* dos favoritos/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await noOverflow(page);
});

test('7B.2A: dogfood Farmacologia 2025, retorno à matéria, Propedêutica 2024 e catálogo global', async ({
  page,
}) => {
  const network = monitor(page);
  await page.goto('./');
  await subjectCard(page, 'Farmacologia')
    .getByRole('link', { name: /Abrir matéria/ })
    .click();
  await examCard(page, farmaco.id)
    .getByRole('link', { name: /Abrir prova/ })
    .click();
  await chooseExam(page);
  await expect(page.getByRole('heading', { name: 'Questão 1 de 42', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← Simulados da matéria' }).click();
  await expect(page.locator('.exam-card')).toHaveCount(5);
  await expect(examCard(page, farmaco.id)).toContainText('Em andamento');
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Matérias' })
    .click();
  await subjectCard(page, 'Propedêutica')
    .getByRole('link', { name: /Abrir matéria/ })
    .click();
  await examCard(page, 'propedeu-p2-2024')
    .getByRole('link', { name: /Abrir prova/ })
    .click();
  await chooseExam(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    exams.find((exam) => exam.id === 'propedeu-p2-2024')!.title,
  );
  await page.getByRole('link', { name: '← Simulados da matéria' }).click();
  await expect(page.locator('.exam-card')).toHaveCount(2);
  await page.locator('.app-nav').getByRole('link', { name: 'Matérias' }).click();
  await page.getByRole('link', { name: 'Ver todos os simulados' }).click();
  await page.getByLabel('Disciplina', { exact: true }).selectOption('Farmacologia Básica');
  await expect(page.locator('.exam-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.locator('.exam-card')).toHaveCount(catalog.exams.length);
  network.check();
});

test('7B.2A: CTA acessível por Tab/Enter, focus-visible e targets de 44px', async ({ page }) => {
  await page.goto('./');
  const link = subjectCard(page, 'Farmacologia').getByRole('link', { name: /Abrir matéria/ });
  await expect(link).toBeVisible();
  for (
    let i = 0;
    i < 30 && !(await link.evaluate((element) => element === document.activeElement));
    i++
  )
    await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
  const box = (await link.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await expect(page.locator('.subject-monogram').first()).toHaveAttribute('aria-hidden', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Farmacologia');
  const crumb = page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Matérias' });
  expect((await crumb.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('.app-nav').getByRole('link', { name: 'Matérias' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('7B.2A: área inválida não redireciona nem crasha', async ({ page }) => {
  await page.goto('?area=inexistente');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Matéria não encontrada.');
  await expect(page).toHaveURL(/\?area=inexistente$/);
  await page.getByRole('link', { name: 'Voltar para Matérias' }).click();
  await expect(page.locator('.subject-card')).toHaveCount(7);
});

test('7B.2A: catálogo futuro com colisões mantém grupos e rotas próprios', async ({ page }) => {
  const subjects = [
    'Área Nova',
    'Area Nova',
    'Clínica Médica',
    'Clinica Medica',
    'A/B',
    'A B',
    'Área X',
    'Area X',
  ];
  let future = subjects.map((subject, index) => ({
    ...catalog.exams[0]!,
    id: `future-${index}`,
    subject,
  }));
  await page.route('**/generated/exam-index.json', (route) =>
    route.fulfill({
      json: {
        ...catalog,
        exams: future,
      },
    }),
  );
  await page.goto('./');
  await expect(page.locator('.subject-card')).toHaveCount(subjects.length);
  const before = await page
    .locator('.subject-card a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  future = [...future].reverse();
  await page.reload();
  await expect(page.locator('.subject-card')).toHaveCount(subjects.length);
  expect(
    await page
      .locator('.subject-card a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  ).toEqual(before);
  for (const subject of subjects) {
    await subjectCard(page, subject)
      .getByRole('link', { name: /Abrir matéria/ })
      .click();
    expect(new URL(page.url()).searchParams.get('area')).toBe(subjectGroupDefinition(subject).id);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(subject);
    await expect(page.locator('.exam-card')).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(subject);
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Matérias' })
      .click();
  }
});

test('7B.2A: catálogo vazio e filtros sem resultados possuem estados explícitos', async ({
  page,
}) => {
  await page.route('**/generated/exam-index.json', (route) =>
    route.fulfill({ json: { ...catalog, exams: [] } }),
  );
  await page.goto('./');
  await expect(page.getByRole('status')).toContainText('Nenhuma matéria disponível.');
  await page.getByRole('link', { name: 'Ver todos os simulados' }).click();
  await expect(page.getByRole('status')).toContainText('Nenhuma prova encontrada');
});

for (const width of [375, 390, 768, 1024, 1280]) {
  test(`7B.2A: ${width}px Hub e matéria, claro/escuro e preferências acessíveis`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('./');
    await expect(page.locator('.subject-card')).toHaveCount(7);
    const columns = await page
      .locator('.subject-grid')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(width < 768 ? 1 : width < 1280 ? 2 : 3);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: /Tema escuro/ }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await noOverflow(page);
      await page.screenshot({ path: info.outputPath(`hub-${width}-${theme}.png`), fullPage: true });
      await subjectCard(page, 'Farmacologia')
        .getByRole('link', { name: /Abrir matéria/ })
        .click();
      await expect(page.locator('.exam-card')).toHaveCount(5);
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath(`subject-${width}-${theme}.png`),
        fullPage: true,
      });
      await page
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByRole('link', { name: 'Matérias' })
        .click();
      await subjectCard(page, 'Microbiologia e Virologia')
        .getByRole('link', { name: /Abrir matéria/ })
        .click();
      await expect(page.locator('.exam-card')).toHaveCount(4);
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath(`microbiologia-${width}-${theme}.png`),
        fullPage: true,
      });
      await page
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByRole('link', { name: 'Matérias' })
        .click();
    }
    await page.goto('?view=settings');
    await page.getByLabel('Tamanho do texto').selectOption('large');
    await page.getByLabel('Contraste').selectOption('high');
    await page.getByLabel('Densidade').selectOption('compact');
    await page.getByRole('checkbox', { name: /Indicador de foco reforçado/ }).check();
    await page.getByRole('checkbox', { name: /Reduzir movimentos/ }).check();
    await page.locator('.app-nav').getByRole('link', { name: 'Matérias' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-text-size', 'large');
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
    await expect(page.locator('html')).toHaveAttribute('data-enhanced-focus', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
    await noOverflow(page);
    const link = subjectCard(page, 'Farmacologia').getByRole('link', { name: /Abrir matéria/ });
    await link.focus();
    expect(await link.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('5px');
    expect(await link.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
      '0s',
    );
    await page.screenshot({
      path: info.outputPath(`hub-${width}-preferences.png`),
      fullPage: true,
    });
    await link.click();
    await expect(page.locator('.exam-card')).toHaveCount(5);
    await noOverflow(page);
    await page.goto('?view=settings');
    await page.getByLabel('Densidade').selectOption('comfortable');
    await page.locator('.app-nav').getByRole('link', { name: 'Matérias' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
    await noOverflow(page);
    await subjectCard(page, 'Microbiologia e Virologia')
      .getByRole('link', { name: /Abrir matéria/ })
      .click();
    await expect(page.locator('.exam-card')).toHaveCount(4);
    await noOverflow(page);
  });
}
