import { chooseExam } from './attempt-helpers';
import { test, expect } from '@playwright/test';

test('catálogo → tentativa mista → reload → resultado → revisão no base path', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const failures: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('?view=all');
  await expect(page.getByRole('heading', { name: 'Suas provas' })).toBeVisible();
  await page.getByRole('searchbox').fill('hipofise');
  await page.getByRole('link', { name: /Abrir prova/ }).click();
  await expect(page).toHaveURL(/\/CHATGPT\/\?exam=fisiologia-m5-aula-1-2026$/);
  await chooseExam(page);
  await expect(page.getByRole('heading', { name: 'Questão 1 de 30' })).toBeVisible();
  await page.getByRole('radio', { name: /b\) Substância/ }).check();
  await page.getByRole('button', { name: '⚑ Marcar para revisão' }).click();
  await page.getByRole('button', { name: 'Próxima →' }).click();
  await page.getByRole('button', { name: '← Anterior' }).click();
  await expect(page.getByRole('radio', { name: /b\) Substância/ })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('objetiva.png'), fullPage: true });
  await page.getByRole('button', { name: 'Ir para questão 21', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Sua resposta' })
    .fill('Minha resposta dissertativa persistida.');
  await page.getByRole('button', { name: /Tema escuro/ }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Questão 21 de 30' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue('Minha resposta dissertativa persistida.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('dissertativa-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização' }).click();
  await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeVisible();
  await expect(page.getByText('5%', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeVisible();
  await page.getByRole('button', { name: 'Revisar respostas' }).click();
  await expect(page.getByRole('heading', { name: 'Resposta-modelo' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Voltar ao resultado' }).click();
  await page.getByRole('button', { name: 'Nova tentativa' }).click();
  await chooseExam(page);
  await expect(page.getByRole('heading', { name: 'Questão 1 de 30' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /b\) Substância/ })).not.toBeChecked();
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  expect(requests.some((url) => /\/simulados\/|\/legacy\/|api.github.com/.test(url))).toBe(false);
  expect(requests.every((url) => url.startsWith('http://127.0.0.1:4173/CHATGPT/'))).toBe(true);
});
