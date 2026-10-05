import { chooseExam } from './attempt-helpers';
import { test, expect } from '@playwright/test';
import { readExamCatalog } from '../../scripts/catalog';

function monitor(page: import('@playwright/test').Page) {
  const errors: string[] = [],
    failures: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) failures.push(r.url());
  });
  page.on('request', (r) => requests.push(r.url()));
  return () => {
    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
    expect(requests.some((url) => /\/simulados\/|\/legacy\/|api.github.com/.test(url))).toBe(false);
    expect(requests.every((url) => url.startsWith('http://127.0.0.1:4173/CHATGPT/'))).toBe(true);
  };
}

test('catálogo atual e loader de cada JSON sem depender do HTML legado', async ({ page }) => {
  const check = monitor(page);
  const { exams, catalog } = await readExamCatalog();
  await page.goto('?view=all');
  await expect(page.getByRole('link', { name: /Abrir prova/ })).toHaveCount(exams.length);
  const response = await page.request.get('generated/exam-index.json');
  expect(await response.json()).toEqual(catalog);
  for (const exam of exams) {
    const loaded = page.waitForResponse((r) =>
      r.url().endsWith(`/generated/exams/${exam.id}.json`),
    );
    await page.goto(`?exam=${exam.id}`);
    await chooseExam(page);
    expect(await (await loaded).json()).toEqual(exam);
    await expect(
      page.getByRole('heading', { name: `Questão 1 de ${exam.questions.length}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: exam.title, exact: true })).toBeVisible();
  }
  check();
});

for (const representative of [
  { id: 'farmaco-p2-2025', type: 'objective', count: 42, target: 1 },
  { id: 'fisiologia-m5-aula-2', type: 'mixed', count: 25, target: 21 },
  { id: 'fisiologia-m5-endocrino-em-grupo-2026', type: 'case', count: 8, target: 2 },
]) {
  test(`${representative.id}: claro/escuro, restauração, finalização e revisão`, async ({
    page,
  }, info) => {
    const check = monitor(page);
    await page.goto(`?exam=${representative.id}`);
    await chooseExam(page);
    await expect(
      page.getByRole('heading', { name: `Questão 1 de ${representative.count}`, exact: true }),
    ).toBeVisible();
    if (representative.type === 'case') {
      await expect(page.locator('table')).toHaveCount(1);
      await expect(page.locator('table').getByText('GH basal', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'QUESTÃO I', exact: true })).toBeVisible();
    } else {
      const radio = page.getByRole('radio').first();
      await radio.check();
      await expect(radio).toBeChecked();
    }
    await page.screenshot({ path: info.outputPath('light.png'), fullPage: true });
    await page.getByRole('button', { name: /Tema escuro/ }).click();
    if (representative.target !== 1) {
      await page
        .getByRole('button', { name: `Ir para questão ${representative.target}`, exact: true })
        .click();
      if (representative.type === 'case') {
        await expect(page.locator('table')).toHaveCount(1); // mesmo caso visível no subitem seguinte
        await expect(page.locator('.case-context').nth(1)).toContainText(
          'Ver caso clínico e tabela de exames no item a.',
        );
      }
      await page
        .getByRole('textbox', { name: 'Sua resposta' })
        .fill('Resposta preservada após recarregar.');
    }
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(
      page.getByRole('heading', {
        name: `Questão ${representative.target} de ${representative.count}`,
        exact: true,
      }),
    ).toBeVisible();
    if (representative.type === 'objective')
      await expect(page.getByRole('radio').first()).toBeChecked();
    else
      await expect(page.getByRole('textbox', { name: 'Sua resposta' })).toHaveValue(
        'Resposta preservada após recarregar.',
      );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('dark-restored.png'), fullPage: true });
    await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar finalização' }).click();
    await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeVisible();
    if (representative.type === 'case')
      await expect(page.getByText('Sem nota automática', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeVisible();
    await page.getByRole('button', { name: 'Revisar respostas' }).click();
    if (representative.type === 'objective') {
      await expect(page.getByRole('heading', { name: 'Explicação' })).toBeVisible();
      await expect(page.getByRole('radio').first()).toBeDisabled();
    } else {
      await expect(page.getByRole('heading', { name: 'Resposta-modelo' })).toBeVisible();
      await expect(page.getByRole('textbox')).toHaveAttribute('readonly', '');
    }
    if (representative.type === 'case') {
      for (const [position, cell] of [
        [4, 'Testosterona livre'],
        [6, 'T4 livre'],
      ] as const) {
        await page
          .getByRole('button', { name: `Ir para questão ${position}`, exact: true })
          .click();
        await expect(page.locator('table')).toHaveCount(1);
        await expect(page.locator('table').getByText(cell, { exact: true })).toBeVisible();
      }
      await page.screenshot({ path: info.outputPath('table-review.png'), fullPage: true });
    }
    check();
  });
}
