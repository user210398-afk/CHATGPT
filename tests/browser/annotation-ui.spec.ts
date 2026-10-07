import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseExam } from '../../schema/exam';
import { createAttempt } from '../../src/engine/exam-state';
import { storageKey } from '../../src/engine/persistence';
import { annotationStorageKey } from '../../src/engine/question-annotations-storage';
import { paint, erase, gesture } from './annotation-helpers';
const exam = parseExam(
  JSON.parse(readFileSync('data/exams/fisiologia-m5-aula-1-2026.json', 'utf8')),
);
const q = exam.questions[0]!,
  key = annotationStorageKey(exam);
async function seed(page: Page, raw: string | null = null) {
  await page.goto('?view=review');
  await page.evaluate(
    ({ attemptKey, attempt, key, raw }) => {
      localStorage.setItem(attemptKey, attempt);
      if (raw !== null) localStorage.setItem(key, raw);
    },
    {
      attemptKey: storageKey(exam),
      attempt: JSON.stringify({
        storageVersion: 3,
        current: createAttempt(exam, undefined, 'annotation-ui'),
      }),
      key,
      raw,
    },
  );
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    (window as any).annotationWrites = 0;
    Storage.prototype.setItem = function (k, raw) {
      if (this === localStorage && k === key) (window as any).annotationWrites++;
      return original.call(this, k, raw);
    };
  }, key);
  await page.goto(`?exam=${exam.id}`);
  await expect(page.locator('.statement')).toBeVisible();
}
const raw = (page: Page) => page.evaluate((key) => localStorage.getItem(key), key);
const trigger = (page: Page) => page.getByRole('button', { name: /^Cor:/ });
async function fit(page: Page, selector: string) {
  await page.locator(selector).evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const box = (await page.locator(selector).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const targets = await page
    .locator(selector)
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
    );
  for (const target of targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
}
test('collapsed color disclosure, repeated toggles, outside, Escape, keyboard and explicit selection', async ({
  page,
}) => {
  await seed(page);
  for (const name of ['Amarelo', 'Verde', 'Azul', 'Vermelho'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  for (let i = 0; i < 5; i++) {
    await trigger(page).click();
    await expect(page.getByRole('button', { name: 'Amarelo', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await trigger(page).click();
  }
  await trigger(page).click();
  await page.locator('.category').click();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  await trigger(page).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Vermelho', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(trigger(page)).toHaveAccessibleName('Cor: Vermelho');
  await expect(trigger(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Grifar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await trigger(page).click();
  await expect(page.getByRole('button', { name: 'Vermelho', exact: true })).toContainText('✓');
  await page.getByRole('button', { name: 'Verde', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toBeFocused();
  await expect(page.locator('.statement')).toHaveAttribute('data-annotation-tool', 'off');
  await page.getByRole('button', { name: 'Mais ações de grifo' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Mais ações de grifo' })).toBeFocused();
  expect(await raw(page)).toBeNull();
  expect(await page.evaluate(() => (window as any).annotationWrites)).toBe(0);
});
test('v1 read/reload zero-write, red first mutation upgrades v2 preserving legacy IDs; red erase and reload', async ({
  page,
}) => {
  const highlights = [
    { id: 'legacy-yellow', start: 0, end: 4, color: 'yellow' },
    { id: 'legacy-green', start: 6, end: 10, color: 'green' },
    { id: 'legacy-blue', start: 12, end: 16, color: 'blue' },
  ];
  const old = ` \n${JSON.stringify({ storageVersion: 1, examId: exam.id, examRevision: exam.revision, questions: { [q.id]: highlights } }, null, 2)}  `;
  await seed(page, old);
  expect(await raw(page)).toBe(old);
  expect(await page.evaluate(() => (window as any).annotationWrites)).toBe(0);
  await page.reload();
  await expect(page.locator('mark.annotation-blue')).toBeVisible();
  expect(await raw(page)).toBe(old);
  expect(await page.evaluate(() => (window as any).annotationWrites)).toBe(0);
  await paint(page, 18, 28, 'Vermelho');
  const value = JSON.parse((await raw(page))!);
  expect(value.storageVersion).toBe(2);
  expect(value.questions[q.id].slice(0, 3)).toEqual(highlights);
  expect(value.questions[q.id][3]).toMatchObject({ start: 18, end: 28, color: 'red' });
  await expect(page.getByRole('button', { name: 'Grifar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await gesture(page, 30, 34);
  await erase(page, 20, 24);
  await expect(page.getByRole('button', { name: 'Borracha', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const saved = await raw(page);
  expect(
    JSON.parse(saved!)
      .questions[q.id].filter((h: any) => h.color === 'red')
      .map((h: any) => [h.start, h.end]),
  ).toEqual([
    [18, 20],
    [24, 28],
    [30, 34],
  ]);
  await page.reload();
  await expect(page.locator('mark.annotation-red').first()).toBeVisible();
  expect(await raw(page)).toBe(saved);
  expect(await page.evaluate(() => (window as any).annotationWrites)).toBe(0);
});
test('red recolor/yellow over red and keyboard individual removal/clear remain local to annotations', async ({
  page,
}) => {
  await seed(page);
  const official = await page.evaluate((key) => localStorage.getItem(key), storageKey(exam));
  await paint(page, 0, 20, 'Amarelo');
  await paint(page, 4, 16, 'Vermelho');
  await paint(page, 8, 10, 'Amarelo');
  expect(
    JSON.parse((await raw(page))!).questions[q.id].map((h: any) => [h.start, h.end, h.color]),
  ).toEqual([
    [0, 4, 'yellow'],
    [4, 8, 'red'],
    [8, 10, 'yellow'],
    [10, 16, 'red'],
    [16, 20, 'yellow'],
  ]);
  await page.getByRole('button', { name: 'Mais ações de grifo' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Remover destaque 1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Mais ações de grifo' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Limpar marcações desta questão', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('mark')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey(exam))).toBe(official);
});
test('bounded secondary panel with 200 highlights remains inside mobile viewport and removal stays accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const richExam = structuredClone(exam);
  richExam.questions[0]!.statement = [{ type: 'text', text: 'ab '.repeat(200) }];
  await page.route(`**/generated/exams/${exam.id}.json`, (route) =>
    route.fulfill({ json: richExam }),
  );
  const highlights = Array.from({ length: 200 }, (_, index) => ({
    id: `dense-${index}`,
    start: index * 3,
    end: index * 3 + 2,
    color: 'red',
  }));
  await seed(
    page,
    JSON.stringify({
      storageVersion: 2,
      examId: exam.id,
      examRevision: exam.revision,
      questions: { [q.id]: highlights },
    }),
  );
  await page.getByRole('button', { name: 'Mais ações de grifo' }).click();
  await fit(page, '.annotation-list');
  expect(
    await page
      .locator('.annotation-list')
      .evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
  await page.getByRole('button', { name: 'Remover destaque 200', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect(JSON.parse((await raw(page))!).questions[q.id]).toHaveLength(199);
  await expect(page.getByRole('button', { name: 'Mais ações de grifo' })).toBeFocused();
});
for (const width of [375, 390, 768, 1024, 1280])
  for (const theme of ['light', 'dark', 'high', 'dark-high'])
    test(`disclosures fit ${width} ${theme} enlarged text; all highlight colors legible`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await seed(page);
      await page.evaluate((theme) => {
        const root = document.documentElement;
        root.dataset.theme = theme.startsWith('dark') ? 'dark' : 'light';
        root.dataset.contrast = theme.includes('high') ? 'high' : 'standard';
        root.dataset.textSize = 'large';
        const style = document.createElement('style');
        style.textContent =
          ':root { --font-body: "DejaVu Sans", sans-serif; --font-display: "DejaVu Sans", sans-serif; }';
        document.head.append(style);
      }, theme);
      for (const [index, name] of ['Amarelo', 'Verde', 'Azul', 'Vermelho'].entries())
        await paint(page, index * 6, index * 6 + 4, name);
      await page.locator('.annotation-toolbar').scrollIntoViewIfNeeded();
      await fit(page, '.annotation-toolbar');
      await trigger(page).click();
      await fit(page, '.annotation-colors');
      for (const label of await page.locator('.annotation-color-name').all()) {
        expect(
          await label.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return range.getClientRects().length;
          }),
        ).toBe(1);
      }
      await expect(page.getByRole('button', { name: 'Vermelho', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      if (testInfo.project.name === 'desktop' && [375, 390].includes(width))
        await page.screenshot({ path: `/tmp/medsim-color-${width}-${theme}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Mais ações de grifo' }).click();
      await fit(page, '.annotation-list');
      if (testInfo.project.name === 'desktop' && width === 375)
        await page.screenshot({ path: `/tmp/medsim-more-${width}-${theme}.png`, fullPage: true });
      const ratios = await page.locator('.statement mark').evaluateAll((marks) => {
        const luminance = (color: string) => {
          const rgb = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((n) => {
              const c = n / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
          return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
        };
        return marks.map((mark) => {
          const style = getComputedStyle(mark),
            a = luminance(style.color),
            b = luminance(style.backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
      });
      expect(ratios).toHaveLength(4);
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
      await page.keyboard.press('Escape');
      await expect(page.locator('.statement')).toHaveAttribute('data-annotation-tool', 'off');
      await fit(page, '.annotation-toolbar');
    });
