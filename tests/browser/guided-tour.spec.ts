import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseExam } from '../../schema/exam';
import { guidedTourSteps } from '../../src/app/guided-tour';
import { createAttempt, transition } from '../../src/engine/exam-state';
import { storageKey } from '../../src/engine/persistence';
import { storageFixtureJson } from '../legacy-fixtures';
import { createReviewSession, type ReviewSelection } from '../../src/engine/review-session';
import { historyStorageKey, summary } from '../../src/engine/persistence';
import { reviewStorageKey } from '../../src/engine/review-history';
import { reviewSessionStorageKey } from '../../src/engine/review-session-storage';
import { defaultUiPreferences, uiPreferencesKey } from '../../src/engine/ui-preferences';
import { catalogPreferencesKey } from '../../src/engine/catalog-preferences';

// Match the shared Vitest fixtures without importing JSON through Node ESM.
const poc = parseExam(
  JSON.parse(readFileSync('data/exams/fisiologia-m5-aula-1-2026.json', 'utf8')),
);
const first = poc.questions[0]!;
const firstEssay = poc.questions.find((q) => q.type === 'essay')!;
const tiny = {
  ...poc,
  questions: [
    { ...first, category: 'A', tags: ['x', 'z'] },
    { ...poc.questions[1]!, category: 'A', tags: ['y', 'z'] },
    { ...firstEssay, category: 'B', tags: ['x'] },
  ],
};
const tinyCatalog = {
  schemaVersion: 1 as const,
  exams: [
    {
      id: poc.id,
      revision: poc.revision,
      title: poc.title,
      subject: poc.subject,
      year: poc.year,
      division: poc.division,
      description: poc.description,
      tags: poc.tags,
      questionCount: 3,
      objectiveCount: 2,
      essayCount: 1,
    },
  ],
};
const objective = tiny.questions[0]!;
const second = tiny.questions[1]!;
const essay = tiny.questions[2]!;
function source(id = 'source') {
  let attempt = createAttempt(tiny, '2026-10-05T16:00:00.000Z', id);
  if (objective.type !== 'multiple-choice' || second.type !== 'multiple-choice')
    throw new Error('fixture');
  const correct = objective.correctAnswer;
  attempt = transition(tiny, attempt, {
    type: 'answer',
    questionId: objective.id,
    value: objective.options.find((o) => o.id !== correct)!.id,
  });
  attempt = transition(tiny, attempt, {
    type: 'answer',
    questionId: second.id,
    value: second.correctAnswer,
  });
  attempt = transition(tiny, attempt, { type: 'flag', questionId: objective.id });
  attempt = transition(tiny, attempt, { type: 'flag', questionId: essay.id });
  return transition(tiny, attempt, { type: 'finish', now: '2026-10-05T17:00:00.000Z' });
}
const all: ReviewSelection = {
  kind: 'filtered',
  filters: { status: 'all', flaggedOnly: false, category: '', tag: '' },
};
function session(
  mode: 'exam' | 'study' = 'exam',
  selection: ReviewSelection = all,
  id = 'session',
) {
  return createReviewSession(tiny, source(), selection, mode, '2026-10-05T18:00:00.000Z', id);
}

async function monitorWrites(page: Page) {
  await page.addInitScript(() => {
    const audit = { writes: [] as string[] };
    Object.assign(window, { tourAudit: audit });
    for (const method of ['setItem', 'removeItem', 'clear'] as const) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args: string[]) {
        audit.writes.push(`${method}:${args[0] ?? ''}`);
        return Reflect.apply(original, this, args);
      };
    }
  });
}
async function assertNoWrites(page: Page) {
  expect(
    await page.evaluate(
      () => (window as unknown as { tourAudit: { writes: string[] } }).tourAudit.writes,
    ),
  ).toEqual([]);
}
async function storageSnapshot(page: Page) {
  return page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
}
async function start(page: Page) {
  await page.getByRole('button', { name: 'Conhecer o MedSim' }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName(guidedTourSteps[0].title);
}
async function overflowDiagnostic(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    url: location.href,
    step: document.getElementById('tour-progress')?.textContent ?? 'tour fechado',
    theme: document.documentElement.dataset.theme,
    textSize: document.documentElement.dataset.textSize,
    overflowingElements: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          (rect.left < 0 ||
            rect.right > window.innerWidth ||
            element.scrollWidth > element.clientWidth)
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          id: element.id,
          className: element.className,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          text: element.textContent?.trim().slice(0, 120),
          computedWidth: style.width,
          minWidth: style.minWidth,
          fontSize: style.fontSize,
          whiteSpace: style.whiteSpace,
          overflowWrap: style.overflowWrap,
          display: style.display,
          overflowX: style.overflowX,
        };
      }),
  }));
}
async function panelFits(page: Page) {
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const bounds = await page.getByRole('dialog').boundingBox();
      return (
        !!bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= viewport.width + 1 &&
        bounds.y + bounds.height <= viewport.height + 1
      );
    })
    .toBe(true);
  const diagnostic = await overflowDiagnostic(page);
  expect(
    diagnostic.scrollWidth <= diagnostic.innerWidth,
    JSON.stringify(diagnostic, null, 2),
  ).toBe(true);
}
async function complete(page: Page, checkTargets = false) {
  for (let index = 0; index < 7; index++) {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName(guidedTourSteps[index]!.title);
    await expect(dialog.getByText(`CONHECER O MEDSIM · ETAPA ${index + 1} DE 7`)).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe('/CHATGPT/');
    expect(url.searchParams.has('exam')).toBe(false);
    expect(url.searchParams.has('reviewExam')).toBe(false);
    if (checkTargets) {
      await expect(page.locator(guidedTourSteps[index]!.target)).toBeVisible();
      await expect(page.locator('.tour-spotlight')).toBeVisible();
    }
    await panelFits(page);
    await dialog.getByRole('button', { name: index === 6 ? 'Concluir' : 'Próximo' }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('UX1: rotas e links existentes permanecem acessíveis, sem abertura automática', async ({
  page,
}) => {
  await monitorWrites(page);
  const destinations = [
    ['', /Escolha o que/],
    ['?view=all', 'Todos os simulados'],
    ['?view=dashboard', 'Meu desempenho'],
    ['?view=review', 'Revisão'],
    ['?view=error-notebook', 'Caderno de Erros'],
    ['?view=settings', 'Configurações'],
    [`?exam=${poc.id}`, /Como deseja fazer esta tentativa/],
    ['?view=review-session', 'Não foi possível abrir esta página'],
  ] as const;
  for (const [url, heading] of destinations) {
    await page.goto(url || './');
    await expect(
      page.getByRole('heading', { name: heading, exact: typeof heading === 'string' }),
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Conhecer o MedSim' })).toBeVisible();
    expect(new URL(page.url()).search).toBe(url);
    await assertNoWrites(page);
  }
  await page.locator('.app-nav').getByRole('link', { name: 'Matérias', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Escolha o que/ })).toBeVisible();
  await page.locator('.app-nav').getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meu desempenho' })).toBeVisible();
});

test('UX1: sete etapas com alvos reais, restauração, reabertura e zero escritas', async ({
  page,
}, info) => {
  await monitorWrites(page);
  await page.goto('?view=settings');
  const before = await storageSnapshot(page);
  const historyLength = await page.evaluate(() => history.length);
  await start(page);
  await expect(page.locator('#app-surface')).toHaveAttribute('inert', '');
  await expect(page.getByRole('dialog').getByRole('heading')).toBeFocused();
  await info.attach('tour-welcome', { body: await page.screenshot(), contentType: 'image/png' });
  await complete(page, true);
  await expect(page.getByRole('button', { name: 'Conhecer o MedSim' })).toBeFocused();
  expect(new URL(page.url()).search).toBe('?view=settings');
  expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  expect(await storageSnapshot(page)).toEqual(before);
  await start(page);
  await complete(page);
  await assertNoWrites(page);
});

test('UX1: Tab, Shift+Tab, setas, Anterior, Escape e Sair mantêm foco correto', async ({
  page,
}) => {
  await page.goto('./');
  await start(page);
  const dialog = page.getByRole('dialog');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Sair' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Próximo' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(dialog).toHaveAccessibleName(guidedTourSteps[1].title);
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Anterior' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Sair' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Anterior' }).click();
  await expect(dialog).toHaveAccessibleName(guidedTourSteps[0].title);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Conhecer o MedSim' })).toBeFocused();
  await start(page);
  await dialog.getByRole('button', { name: 'Próximo' }).click();
  await dialog.getByRole('button', { name: 'Sair' }).click();
  await expect(dialog).toHaveCount(0);
  await start(page);
  await expect(dialog).toHaveAccessibleName(guidedTourSteps[0].title);
});

test('UX1: alvo ausente permite seguir, e reload recupera a etapa iniciada explicitamente', async ({
  page,
}) => {
  await page.goto('./');
  const originalUrl = page.url();
  await start(page);
  await page.locator('.brand').evaluate((element) => element.remove());
  await expect(
    page.getByRole('dialog').getByText(/O destaque desta etapa está indisponível/),
  ).toBeVisible();
  await complete(page);
  await start(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Próximo' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Próximo' }).click();
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveAccessibleName(guidedTourSteps[2].title);
  expect(await page.evaluate(() => history.state.medsimGuidedTour.originalUrl)).toBe(originalUrl);
  await expect(page.getByRole('dialog').getByRole('heading')).toBeFocused();
  await page.getByRole('dialog').getByRole('button', { name: 'Sair' }).click();
  expect(page.url()).toBe(originalUrl);
});

test('UX1: dados vazios e storage bloqueado permitem navegação completa', async ({ page }) => {
  await monitorWrites(page);
  await page.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    }
  });
  await page.route('**/generated/exam-index.json', (route) =>
    route.fulfill({ json: { schemaVersion: 1, exams: [] } }),
  );
  await page.goto('./');
  await start(page);
  await complete(page, true);
  await assertNoWrites(page);
});

test('UX1: prova ativa continua montada e não sofre escrita ou reinício', async ({ page }) => {
  const key = storageKey(poc);
  const raw = storageFixtureJson({ storageVersion: 2, current: createAttempt(poc), history: [] });
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key, raw });
  await monitorWrites(page);
  await page.goto(`?exam=${poc.id}`);
  const question = page.getByRole('heading', { name: 'Questão 1 de 30', exact: true });
  await expect(question).toBeVisible();
  await question.evaluate((element) => Object.assign(element, { tourPreserved: true }));
  const before = await storageSnapshot(page);
  await start(page);
  await complete(page);
  await expect(question).toBeVisible();
  expect(
    await question.evaluate(
      (element) => (element as unknown as { tourPreserved: boolean }).tourPreserved,
    ),
  ).toBe(true);
  expect(await storageSnapshot(page)).toEqual(before);
  await assertNoWrites(page);
});

test('UX1: temas, alto contraste, texto grande, movimento reduzido e tela estreita', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('?view=settings');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Tema', { exact: true }).selectOption(theme);
    await page.getByLabel('Contraste', { exact: true }).selectOption('high');
    await page.getByLabel('Tamanho do texto').selectOption('large');
    await info.attach(`overflow-before-tour-${theme}`, {
      body: JSON.stringify(await overflowDiagnostic(page), null, 2),
      contentType: 'application/json',
    });
    await start(page);
    expect(
      await page
        .locator('.tour-panel')
        .evaluate((element) => getComputedStyle(element).transitionDuration),
    ).toBe('0s');
    await info.attach(`tour-${theme}-contrast-320`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    const panel = page.getByRole('dialog');
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await panel.getByRole('button', { name: 'Próximo' }).click();
    await expect(panel).toHaveAccessibleName(guidedTourSteps[1].title);
    expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(panel.getByRole('heading')).toBeFocused();
    await expect
      .poll(async () => {
        const container = await panel.boundingBox();
        const title = await panel.getByRole('heading').boundingBox();
        return (
          !!container &&
          !!title &&
          title.y >= container.y &&
          title.y + title.height <= container.y + container.height
        );
      })
      .toBe(true);
    await page.keyboard.press('ArrowLeft');
    await expect(panel).toHaveAccessibleName(guidedTourSteps[0].title);
    expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
    await complete(page, true);
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await start(page);
  await panelFits(page);
  await page.keyboard.press('Escape');
});

test('UX1: Back/Forward recuperam etapa e estado alheio; Sair encerra sem ressurreição', async ({
  page,
}) => {
  await monitorWrites(page);
  await page.goto('?view=settings&reviewPosition=2&reviewResume=%5B%5D&custom=a%2Bb#appearance');
  const originalUrl = page.url();
  const otherState = {
    navigation: { position: 2, data: ['preserved'] },
    unrelated: { active: true },
  };
  await page.evaluate((state) => history.replaceState(state, '', location.href), otherState);
  const length = await page.evaluate(() => history.length);
  await start(page);
  const panel = page.getByRole('dialog');
  await panel.getByRole('button', { name: 'Próximo' }).click();
  await panel.getByRole('button', { name: 'Próximo' }).click();
  const tourUrl = page.url();
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.goBack();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
    expect(page.url()).toBe(originalUrl);
    expect(await page.evaluate(() => history.state)).toEqual(otherState);
    await page.goForward();
    await expect(panel).toHaveAccessibleName(guidedTourSteps[2].title);
    expect(page.url()).toBe(tourUrl);
    expect(await page.evaluate(() => history.length)).toBe(length + 1);
    expect(await page.evaluate(() => history.state.navigation)).toEqual(otherState.navigation);
  }
  await page.reload();
  await expect(panel).toHaveAccessibleName(guidedTourSteps[2].title);
  await panel.getByRole('button', { name: 'Sair' }).click();
  await expect(panel).toHaveCount(0);
  expect(page.url()).toBe(originalUrl);
  expect(await page.evaluate(() => history.state.medsimGuidedTour.active)).toBe(false);
  await page.goBack();
  expect(await page.evaluate(() => history.state)).toEqual(otherState);
  await page.goForward();
  await expect(panel).toHaveCount(0);
  expect(page.url()).toBe(originalUrl);
  await page.reload();
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => history.state.unrelated)).toEqual(otherState.unrelated);
  await assertNoWrites(page);
});

test('UX1: Concluir desativa recuperação por histórico e reload', async ({ page }) => {
  await monitorWrites(page);
  await page.goto('?view=dashboard&custom=keep#main');
  const originalUrl = page.url();
  await start(page);
  await complete(page);
  expect(page.url()).toBe(originalUrl);
  expect(await page.evaluate(() => history.state.medsimGuidedTour.active)).toBe(false);
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Meu desempenho', exact: true })).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await assertNoWrites(page);
});

test('UX1: estado inválido, origem externa, URL adulterada e links sem contexto nunca iniciam', async ({
  page,
}) => {
  await monitorWrites(page);
  await page.goto('?view=all&medsimGuidedTour=active&step=2');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const valid = {
    version: 1,
    step: 2,
    active: true,
    originalUrl: new URL('?view=settings#main', page.url()).href,
  };
  const states = [
    null,
    'invalid',
    [],
    { medsimGuidedTour: null },
    { medsimGuidedTour: { ...valid, active: false } },
    { medsimGuidedTour: { ...valid, version: 2 } },
    { medsimGuidedTour: { ...valid, step: 7 } },
    { medsimGuidedTour: { ...valid, step: '2' } },
    { medsimGuidedTour: { ...valid, active: 'true' } },
    { medsimGuidedTour: { ...valid, originalUrl: 'https://example.com/CHATGPT/' } },
    { medsimGuidedTour: { ...valid, originalUrl: '/CHATGPT/' } },
    { medsimGuidedTour: { ...valid, unexpected: true } },
  ];
  for (const state of states) {
    await page.evaluate((state) => history.replaceState(state, '', '?view=all'), state);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Todos os simulados', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => history.state)).toEqual(state);
    await assertNoWrites(page);
  }
  await page.evaluate(
    (context) => history.replaceState({ medsimGuidedTour: context }, '', '?view=dashboard'),
    valid,
  );
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Meu desempenho', exact: true })).toBeVisible();
  await assertNoWrites(page);
});

test('UX1: recuperação e histórico preservam registros oficiais, sessões e preferências', async ({
  page,
}) => {
  const records = [
    [storageKey(tiny), JSON.stringify({ storageVersion: 3, current: source() })],
    [historyStorageKey(tiny), JSON.stringify({ storageVersion: 2, history: [summary(source())] })],
    [reviewStorageKey(tiny), JSON.stringify({ storageVersion: 1, attempts: [source()] })],
    [reviewSessionStorageKey(tiny), JSON.stringify({ storageVersion: 1, session: session() })],
    [uiPreferencesKey, JSON.stringify({ ...defaultUiPreferences, setupPrompt: 'dismissed' })],
    [catalogPreferencesKey, JSON.stringify({ storageVersion: 1, favorites: [tiny.id] })],
  ] as const;
  await page.goto('./');
  await page.evaluate((records) => {
    for (const [key, raw] of records) localStorage.setItem(key, raw);
    sessionStorage.setItem('scratch-sentinel', 'unchanged');
  }, records);
  await monitorWrites(page);
  await page.route('**/generated/exam-index.json', (route) => route.fulfill({ json: tinyCatalog }));
  await page.route(`**/generated/exams/${tiny.id}.json`, (route) => route.fulfill({ json: tiny }));
  await page.goto(`?view=review-session&reviewExam=${tiny.id}&reviewPosition=1#main`);
  await expect(
    page.getByRole('heading', { name: 'Questão 2 de 3 da sessão', exact: true }),
  ).toBeVisible();
  const before = await storageSnapshot(page);
  const originalUrl = page.url();
  await start(page);
  for (let index = 0; index < 4; index++)
    await page.getByRole('dialog').getByRole('button', { name: 'Próximo' }).click();
  await assertNoWrites(page);
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveAccessibleName(guidedTourSteps[4].title);
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Questão 2 de 3 da sessão', exact: true }),
  ).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  await page.goForward();
  await expect(page.getByRole('dialog')).toHaveAccessibleName(guidedTourSteps[4].title);
  await page.getByRole('dialog').getByRole('button', { name: 'Sair' }).click();
  await expect(
    page.getByRole('heading', { name: 'Questão 2 de 3 da sessão', exact: true }),
  ).toBeVisible();
  expect(await storageSnapshot(page)).toEqual(before);
  await assertNoWrites(page);
});
