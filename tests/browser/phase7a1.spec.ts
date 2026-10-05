import { chooseExam } from './attempt-helpers';
import { storageFixtureJson } from '../legacy-fixtures';
import { test, expect, type Page } from '@playwright/test';
import { readExamCatalog } from '../../scripts/catalog';
import { createAttempt, transition } from '../../src/engine/exam-state';
import { storageKey } from '../../src/engine/persistence';
import { catalogPreferencesKey } from '../../src/engine/catalog-preferences';
import { readFileSync } from 'node:fs';
import { parseExam } from '../../schema/exam';
const poc = parseExam(
  JSON.parse(readFileSync('data/exams/fisiologia-m5-aula-1-2026.json', 'utf8')),
);
const completedAttempt = () =>
  transition(poc, createAttempt(poc, '2026-10-03T10:00:00.000Z'), {
    type: 'finish',
    now: '2026-10-03T11:00:00.000Z',
  });
function card(page: Page, id = poc.id) {
  return page.getByRole('article').filter({ has: page.locator(`a[href="/CHATGPT/?exam=${id}"]`) });
}
function monitor(page: Page) {
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  return () => {
    expect(errors).toEqual([]);
    expect(requests.every((url) => url.startsWith('http://127.0.0.1:4173/CHATGPT/'))).toBe(true);
    return requests;
  };
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
async function seed(page: Page, entries: [string, string][]) {
  await page.evaluate((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value);
  }, entries);
  await page.reload();
}
test('7A.1: catálogo sem progresso, controles acessíveis e somente índice carregado', async ({
  page,
}) => {
  const check = monitor(page);
  const { catalog } = await readExamCatalog();
  await page.goto('./');
  await expect(page.getByRole('article')).toHaveCount(catalog.exams.length);
  await expect(page.locator('.catalog-status')).toHaveText(catalog.exams.map(() => 'Não iniciada'));
  await expect(page.getByRole('link', { name: /Abrir prova/ })).toHaveCount(catalog.exams.length);
  for (const label of ['Disciplina', 'Ano', 'Status', 'Favoritos', 'Tipo', 'Ordenação']) {
    const select = page.getByLabel(label, { exact: true });
    await expect(select).toBeVisible();
    expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await noOverflow(page);
  expect(check().filter((url) => /generated\/exams\//.test(url))).toEqual([]);
});
test('7A.1: tentativas sintéticas, filtros por AND e favoritos persistentes', async ({
  page,
}, info) => {
  const check = monitor(page);
  const { exams, catalog } = await readExamCatalog();
  const objective = exams.find((exam) => exam.id === 'farmaco-p2-2025')!;
  await page.goto('./');
  await seed(page, [
    [
      storageKey(poc),
      storageFixtureJson({
        storageVersion: 2,
        current: {
          ...createAttempt(poc),
          answers: { [poc.questions[0]!.id]: 'option-2', [poc.questions[1]!.id]: 'option-1' },
        },
      }),
    ],
    [
      storageKey(objective),
      storageFixtureJson({
        storageVersion: 2,
        current: transition(objective, createAttempt(objective, '2026-10-03T10:00:00.000Z'), {
          type: 'finish',
          now: '2026-10-03T11:00:00.000Z',
        }),
      }),
    ],
  ]);
  const opened = card(page),
    completed = card(page, objective.id);
  await expect(opened.locator('.catalog-status')).toHaveText('Em andamento');
  await expect(opened.getByText('Respondidas 2 de 30')).toBeVisible();
  await expect(opened.getByRole('progressbar')).toHaveAttribute('value', '2');
  await expect(opened.getByRole('link', { name: /Continuar/ })).toBeVisible();
  await expect(completed.locator('.catalog-status')).toHaveText('Concluída');
  await expect(completed.getByText('Último resultado: 0%')).toBeVisible();
  await expect(completed.getByRole('link', { name: /Ver prova/ })).toBeVisible();
  const favorite = opened.getByRole('button', { name: /Adicionar .* aos favoritos/ });
  expect((await favorite.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await favorite.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await favorite.focus();
  await page.keyboard.press('Space');
  await expect(opened.getByRole('button', { name: /Remover .* dos favoritos/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page).toHaveURL(/\/CHATGPT\/$/);
  await page.reload();
  await expect(opened.getByRole('button', { name: /Remover .* dos favoritos/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Disciplina', { exact: true }).selectOption(poc.subject);
  await page.getByLabel('Status', { exact: true }).selectOption('in-progress');
  await page.getByLabel('Favoritos', { exact: true }).selectOption('favorites');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(
    page.getByText(`1 de ${catalog.exams.length} provas`, { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('catalog-light-filtered.png'), fullPage: true });
  await page.getByRole('button', { name: /Tema escuro/ }).click();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('catalog-dark-filtered.png'), fullPage: true });
  await page.getByLabel('Status', { exact: true }).selectOption('completed');
  await expect(page.getByRole('status')).toContainText('Nenhuma prova encontrada');
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByRole('article')).toHaveCount(catalog.exams.length);
  check();
});
test('7A.1: dogfood responder, voltar, favoritar, concluir e reiniciar sem perder histórico', async ({
  page,
}, info) => {
  const check = monitor(page);
  await page.goto('./');
  await expect(card(page).locator('.catalog-status')).toHaveText('Não iniciada');
  await card(page)
    .getByRole('link', { name: /Abrir prova/ })
    .click();
  await chooseExam(page);
  for (let i = 0; i < 2; i++) {
    const question = poc.questions[i]!;
    if (question.type !== 'multiple-choice') throw new Error('Fixture objetiva esperada');
    await page
      .getByRole('radio')
      .nth(question.options.findIndex((option) => option.id === question.correctAnswer))
      .check();
    if (i === 0) await page.getByRole('button', { name: 'Próxima →' }).click();
  }
  await page.getByRole('link', { name: '← Catálogo de provas' }).click();
  await expect(card(page).locator('.catalog-status')).toHaveText('Em andamento');
  await expect(card(page).getByText('Respondidas 2 de 30')).toBeVisible();
  await card(page)
    .getByRole('button', { name: /Adicionar .* aos favoritos/ })
    .click();
  await page.reload();
  await expect(
    card(page).getByRole('button', { name: /Remover .* dos favoritos/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await card(page)
    .getByRole('link', { name: /Continuar/ })
    .click();
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização' }).click();
  await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeVisible();
  await page.getByRole('link', { name: '← Catálogo de provas' }).click();
  await expect(card(page).locator('.catalog-status')).toHaveText('Concluída');
  await expect(card(page).getByText('Último resultado: 10%')).toBeVisible();
  await expect(card(page).getByText('1 tentativa concluída')).toBeVisible();
  await page.screenshot({ path: info.outputPath('dogfood-completed.png'), fullPage: true });
  await card(page)
    .getByRole('link', { name: /Ver prova/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeVisible();
  await page.getByRole('button', { name: 'Nova tentativa' }).click();
  await chooseExam(page);
  await page.getByRole('link', { name: '← Catálogo de provas' }).click();
  await expect(card(page).locator('.catalog-status')).toHaveText('Em andamento');
  await expect(card(page).getByText('Respondidas 0 de 30')).toBeVisible();
  await expect(card(page).getByText('1 tentativa concluída')).toBeVisible();
  await expect(card(page).getByText('Último resultado: 10%')).toBeVisible();
  await noOverflow(page);
  await card(page)
    .getByRole('link', { name: /Continuar/ })
    .click();
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização' }).click();
  await page.getByText('Histórico local · 2 tentativa(s)').click();
  await expect(page.locator('.history li')).toHaveCount(2);
  check();
});
test('7A.1: storage bloqueado mantém busca, filtros e abertura sem crash', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  const check = monitor(page);
  const { catalog } = await readExamCatalog();
  await page.goto('./');
  await expect(page.getByRole('article')).toHaveCount(catalog.exams.length);
  await page.getByRole('searchbox').fill('hipofise');
  await page.getByLabel('Tipo', { exact: true }).selectOption('mixed');
  await expect(card(page)).toBeVisible();
  const favorite = card(page).getByRole('button', { name: /Adicionar .* aos favoritos/ });
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('status')).toContainText('indisponíveis');
  await noOverflow(page);
  await card(page)
    .getByRole('link', { name: /Abrir prova/ })
    .click();
  await chooseExam(page);
  await chooseExam(page);
  await expect(page.getByRole('heading', { name: 'Questão 1 de 30', exact: true })).toBeVisible();
  check();
});
test('7A.1: corrupção é preservada e falha de escrita é honesta', async ({ page }) => {
  const check = monitor(page);
  await page.goto('./');
  const corruptKey = storageKey(poc);
  await seed(page, [
    [corruptKey, '{bad'],
    [catalogPreferencesKey, '{bad-preferences'],
  ]);
  await card(page)
    .getByRole('button', { name: /Adicionar .* aos favoritos/ })
    .click();
  expect(await page.evaluate((key) => localStorage.getItem(key), corruptKey)).toBe('{bad');
  expect(await page.evaluate((key) => localStorage.getItem(key), catalogPreferencesKey)).toBe(
    '{bad-preferences',
  );
  await seed(page, [
    [corruptKey, storageFixtureJson({ storageVersion: 2, current: completedAttempt() })],
    [catalogPreferencesKey, storageFixtureJson({ storageVersion: 1, favorites: [] })],
  ]);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
  });
  const button = card(page).getByRole('button', { name: /Adicionar .* aos favoritos/ });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('status')).toContainText('O favorito não foi alterado');
  check();
});
