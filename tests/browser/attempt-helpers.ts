import { expect, type Page } from '@playwright/test';
// Old regression scenarios explicitly choose Exam when the new default asks.
export async function chooseExam(page: Page) {
  await expect(
    page
      .getByRole('heading', {
        name: /Como deseja fazer esta tentativa\?|Questão \d+ de \d+|Seu resultado/,
      })
      .first(),
  ).toBeVisible();
  const choose = page.getByRole('button', { name: 'Iniciar em Modo Prova' });
  if (await choose.isVisible()) await choose.click();
}
