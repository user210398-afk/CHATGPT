import { chooseExam } from './attempt-helpers';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { readExamCatalog } from '../../scripts/catalog';

function monitor(page: Page) {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) =>
    failures.push(`${request.url()} ${request.failure()?.errorText}`),
  );
  page.on('request', (request) => {
    if (
      !request.url().startsWith('http://127.0.0.1:4173/CHATGPT/') ||
      /\/legacy\/|\/simulados\/|api\.github\.com/.test(request.url())
    )
      failures.push(request.url());
  });
  return () => expect(failures).toEqual([]);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 100; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Controle inacessível por Tab: ${await target.textContent()}`);
}

test('release: links e metadados do catálogo atual, refresh, claro/escuro e paths de produção', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const check = monitor(page);
  const { exams } = await readExamCatalog();
  for (const theme of ['light', 'dark']) {
    await page.goto('./');
    await expect(
      page.getByText(`${exams.length} provas disponíveis`, { exact: false }),
    ).toBeVisible();
    if (theme === 'dark') await page.getByRole('button', { name: /Tema escuro/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await noOverflow(page);
    for (const exam of exams) {
      await page.goto('./');
      const card = page
        .locator('article')
        .filter({ has: page.locator(`a[href="/CHATGPT/?exam=${exam.id}"]`) });
      await expect(card.getByRole('heading', { name: exam.title, exact: true })).toBeVisible();
      await expect(card.locator('.badge')).toHaveText(exam.subject);
      await expect(card.locator('.card-meta .muted')).toHaveText(
        String(exam.year ?? 'Ano não informado'),
      );
      await expect(card.locator('.division')).toHaveText(exam.division);
      await expect(card.locator('.exam-card-footer .small')).toHaveText(
        `${exam.questions.length} questões`,
      );
      if (!exam.description)
        await expect(card).toContainText(
          `${exam.questions.filter((q) => q.type === 'multiple-choice').length} objetivas · ${exam.questions.filter((q) => q.type === 'essay').length} dissertativas`,
        );
      await card.getByRole('link', { name: /Abrir prova|Continuar/ }).click();
      await expect(page).toHaveURL(new RegExp(`\\?exam=${exam.id}$`));
      await chooseExam(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(exam.title);
      await expect(
        page.getByRole('heading', { name: `Questão 1 de ${exam.questions.length}`, exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(exam.title);
      await expect(page.getByText('✓ Tentativa restaurada neste navegador.')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await noOverflow(page);
    }
  }
  check();
});

test('release: teclado, skip link, labels, foco e estados textuais', async ({ page }) => {
  const check = monitor(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Pular para o conteúdo' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  expect(await skip.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  const search = page.getByRole('searchbox', { name: 'Buscar por tema, disciplina ou ano' });
  await tabTo(page, search);
  await page.keyboard.type('2023');
  const open = page.getByRole('link', { name: /Abrir prova/ }).first();
  await tabTo(page, open);
  await page.keyboard.press('Enter');
  await chooseExam(page);
  await expect(page.getByRole('heading', { name: 'Questão 1 de 35', exact: true })).toBeFocused();
  const radio = page.getByRole('radio').first();
  await tabTo(page, radio);
  await expect(radio).toHaveAccessibleName(/.+/);
  await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Ir para questão 1, respondida', exact: true }),
  ).toBeVisible();
  const next = page.getByRole('button', { name: 'Próxima →' });
  await tabTo(page, next);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Questão 2 de 35', exact: true })).toBeFocused();
  const finish = page.getByRole('button', { name: 'Finalizar tentativa', exact: true });
  await tabTo(page, finish);
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Confirmar finalização' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeFocused();
  await tabTo(page, page.getByRole('button', { name: 'Revisar respostas' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Questão 2 de 35', exact: true })).toBeFocused();
  await page.goto('?exam=fisiologia-m5-endocrino-em-grupo-2026');
  await chooseExam(page);
  const textarea = page.getByRole('textbox', { name: 'Sua resposta' });
  await tabTo(page, textarea);
  await page.keyboard.type('Resposta por teclado.');
  await expect(textarea).toHaveValue('Resposta por teclado.');
  await expect(page.locator('table')).toBeVisible();
  expect(
    await page.locator('table').evaluate((element) => getComputedStyle(element).overflowX),
  ).toBe('auto');
  await noOverflow(page);
  check();
});

test('release: contraste dos tokens nos dois temas e movimento reduzido', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Suas provas' })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: /Tema escuro/ }).click();
    const ratios = await page.evaluate(() => {
      const luminance = (token: string) => {
        const probe = document.createElement('span');
        probe.style.color = `var(--color-${token})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        const rgb = (color.match(/[\d.]+/g) ?? [])
          .slice(0, 3)
          .map((value) => Number(value) / 255)
          .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
      };
      return [
        ['text', 'surface'],
        ['muted', 'surface'],
        ['primary', 'surface'],
        ['on-primary', 'primary'],
        ['success', 'success-bg'],
        ['error', 'error-bg'],
        ['attention', 'attention-bg'],
        ['focus', 'surface'],
      ].map(([foreground, background]) => {
        const a = luminance(foreground!),
          b = luminance(background!);
        return { foreground, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
    });
    for (const { foreground, ratio } of ratios)
      expect(ratio, `${theme}: ${foreground}`).toBeGreaterThanOrEqual(
        foreground === 'focus' ? 3 : 4.5,
      );
    expect(
      await page
        .getByRole('button')
        .first()
        .evaluate((element) => getComputedStyle(element).transitionDuration),
    ).toBe('0s');
  }
});
