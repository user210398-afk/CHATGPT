import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseExam } from '../../schema/exam';
import { createAttempt, transition } from '../../src/engine/exam-state';
import { storageKey } from '../../src/engine/persistence';
import { annotationStorageKey } from '../../src/engine/question-annotations-storage';
import { mutateAnnotations } from '../../src/engine/question-annotations';
import { scratchStorageKey } from '../../src/engine/solver-scratch';
import { reviewSessionStorageKey } from '../../src/engine/review-session-storage';
import { createReviewSession } from '../../src/engine/review-session';
const exam = parseExam(
  JSON.parse(readFileSync('data/exams/fisiologia-m5-aula-1-2026.json', 'utf8')),
);
const q = exam.questions[0]!;
if (q.type !== 'multiple-choice') throw new Error('fixture');
const a = q.options[0]!.id,
  b = q.options[1]!.id;
const scope = { kind: 'attempt' as const, id: 'phase8a-browser' };
async function seed(page: Page, mode: 'exam' | 'study' = 'exam') {
  await page.goto('?view=review');
  const current = createAttempt(exam, '2026-10-05T16:00:00.000Z', scope.id, mode);
  await page.evaluate(
    ([key, raw]) => localStorage.setItem(key!, raw!),
    [storageKey(exam), JSON.stringify({ storageVersion: 3, current })],
  );
  await page.goto(`?exam=${exam.id}`);
  await expect(page.locator('.statement')).toBeVisible();
}
async function select(page: Page, start: number, end: number) {
  await page.locator('.statement').scrollIntoViewIfNeeded();
  await page.evaluate(
    ({ start, end }) => {
      const root = document.querySelector('.statement')!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
        texts: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) texts.push(node as Text);
      function point(offset: number): [Text, number] {
        for (const text of texts) {
          if (offset <= text.length) return [text, offset];
          offset -= text.length;
        }
        throw new Error('Fixture range exceeds statement');
      }
      const range = document.createRange();
      range.setStart(...point(start));
      range.setEnd(...point(end));
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    },
    { start, end },
  );
  await expect(page.getByRole('group', { name: 'Ferramentas de marcação' })).toBeVisible();
}
const current = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).current, storageKey(exam));
const annotations = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), annotationStorageKey(exam));
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    })),
  ).toEqual(expect.objectContaining({ client: expect.any(Number) }));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const toolbar = page.getByRole('group', { name: 'Ferramentas de marcação' });
  if (await toolbar.count()) {
    const box = await toolbar.boundingBox();
    expect(box).toBeTruthy();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  }
}
test('three colors, selection on fragmented DOM, recolor, eraser, reload, individual removal and clear', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seed(page);
  const before = await current(page);
  await select(page, 2, 28);
  await page.getByRole('button', { name: 'Amarelo', exact: true }).click();
  await select(page, 7, 22);
  await page.getByRole('button', { name: 'Verde', exact: true }).click();
  await select(page, 10, 18);
  await page.getByRole('button', { name: 'Azul', exact: true }).click();
  await expect(page.locator('mark.annotation-yellow').first()).toBeVisible();
  await expect(page.locator('mark.annotation-green').first()).toBeVisible();
  await expect(page.locator('mark.annotation-blue').first()).toBeVisible();
  const raw = await annotations(page);
  await page.reload();
  expect(await annotations(page)).toBe(raw);
  await select(page, 12, 15);
  await page.getByRole('button', { name: 'Borracha', exact: true }).click();
  expect(
    JSON.parse((await annotations(page))!).questions[q.id].some(
      (h: { start: number; end: number }) => h.start <= 13 && h.end > 13,
    ),
  ).toBe(false);
  await page.getByText(/^Marcações deste enunciado/).click();
  await page.getByRole('button', { name: 'Remover destaque 1', exact: true }).click();
  await page.getByRole('button', { name: 'Limpar marcações desta questão', exact: true }).click();
  await expect(page.locator('mark')).toHaveCount(0);
  expect(await current(page)).toEqual(before);
  expect(errors).toEqual([]);
});
test('body single/double/triple, restore, no intermediate answer persistence', async ({ page }) => {
  await seed(page);
  const original = await current(page),
    body = page.locator('.option-content > .rich-content').first();
  await body.dblclick();
  await expect(page.locator('.option.eliminated')).toHaveCount(1);
  expect(await current(page)).toEqual(original);
  await page.waitForTimeout(620);
  await body.dblclick();
  await expect(page.locator('.option.eliminated')).toHaveCount(0);
  expect(await current(page)).toEqual(original);
  await page.waitForTimeout(620);
  await body.click({ clickCount: 3 });
  await page.waitForTimeout(650);
  expect(await current(page)).toEqual(original);
  await page.waitForTimeout(620);
  await body.click();
  await expect(page.getByRole('radio').first()).toBeChecked();
  expect((await current(page)).answers[q.id]).toBe(a);
});
test('red team: slow 450ms double click cannot persist an intermediate answer', async ({
  page,
}) => {
  await seed(page);
  const original = await current(page);
  const body = page.locator('.option-content > .rich-content').first();
  await body.scrollIntoViewIfNeeded();
  const box = (await body.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await page.waitForTimeout(450);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await page.waitForTimeout(650);
  expect(await current(page)).toEqual(original);
  await expect(page.locator('.option.eliminated')).toHaveCount(1);
});
test('radio and accessible explicit button: selected cannot be eliminated, eliminated selection wins', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('radio').first().dblclick();
  expect((await current(page)).answers[q.id]).toBe(a);
  await page.getByRole('button', { name: 'Eliminar alternativa 1', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Selecione outra');
  await page.getByRole('radio').nth(1).check();
  const button = page.locator('.option').first().getByRole('button');
  await button.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.option.eliminated')).toHaveCount(1);
  await page.getByRole('radio').first().check();
  await expect(page.locator('.option.selected.eliminated')).toHaveCount(0);
  await expect(page.locator('.option.eliminated')).toHaveCount(0);
  expect((await current(page)).answers[q.id]).toBe(a);
  expect(
    await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!).questions,
      scratchStorageKey(exam, scope),
    ),
  ).toEqual({});
});
test('touch explicit controls, comfortable target, Enter restore, body timer cancelled by navigation', async ({
  page,
}) => {
  await seed(page);
  const button = page.locator('.option').first().getByRole('button');
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.option-content > .rich-content').first().click();
  await page.getByRole('button', { name: 'Próxima →', exact: true }).click();
  await page.waitForTimeout(650);
  expect((await current(page)).answers).toEqual({});
  await page.getByRole('button', { name: '← Anterior', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar alternativa 1', exact: true }).click();
  await page.reload();
  await expect(page.locator('.option.eliminated')).toHaveCount(1);
});
test('Study confirmation hides elimination and feedback dominates; highlights remain editable', async ({
  page,
}) => {
  await seed(page, 'study');
  await page.getByRole('button', { name: 'Eliminar alternativa 1', exact: true }).click();
  await page.getByRole('radio').nth(1).check();
  await expect(page.locator('.feedback')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmar resposta', exact: true }).click();
  await expect(page.locator('.feedback')).toBeVisible();
  await expect(page.locator('.option.eliminated')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Eliminar alternativa/ })).toHaveCount(0);
  await select(page, 0, 5);
  await page.getByRole('button', { name: 'Azul', exact: true }).click();
  await expect(page.locator('mark.annotation-blue')).toHaveCount(1);
});
test('annotations shared by new attempt, historical review and subset ReviewSession; scopes isolated', async ({
  page,
}) => {
  await seed(page);
  await select(page, 0, 8);
  await page.getByRole('button', { name: 'Amarelo', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar alternativa 1', exact: true }).click();
  const raw = await annotations(page);
  let historical = createAttempt(exam, '2026-10-05T16:00:00.000Z', 'historical');
  historical = transition(exam, historical, { type: 'flag', questionId: q.id });
  historical = transition(exam, historical, { type: 'finish', now: '2026-10-05T17:00:00.000Z' });
  const review = createReviewSession(
    exam,
    historical,
    { kind: 'flagged' },
    'exam',
    '2026-10-05T18:00:00.000Z',
    'review-scope',
  );
  const other = mutateAnnotations(exam, JSON.parse(raw!), exam.questions[1]!.id, {
    type: 'paint',
    start: 0,
    end: 3,
    color: 'blue',
  });
  await page.evaluate(
    (entries) => {
      for (const [key, raw] of entries) localStorage.setItem(key!, raw!);
    },
    [
      [storageKey(exam), JSON.stringify({ storageVersion: 3, current: historical })],
      [annotationStorageKey(exam), JSON.stringify(other)],
      [reviewSessionStorageKey(exam), JSON.stringify({ storageVersion: 1, session: review })],
    ],
  );
  await page.goto(`?view=review&reviewExam=${exam.id}&attempt=historical`);
  await expect(page.locator('mark.annotation-yellow')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Eliminar alternativa/ })).toHaveCount(0);
  const official = await current(page);
  await select(page, 0, 8);
  await page.getByRole('button', { name: 'Verde', exact: true }).click();
  expect(await current(page)).toEqual(official);
  await page.goto(`?view=review-session&reviewExam=${exam.id}`);
  await expect(page.locator('mark.annotation-green')).toHaveCount(1);
  await expect(page.locator('.option.eliminated')).toHaveCount(0);
  await page.getByRole('button', { name: 'Eliminar alternativa 1', exact: true }).click();
  expect(
    await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!).scopeId,
      scratchStorageKey(exam, { kind: 'review-session', id: 'review-scope' }),
    ),
  ).toBe('review-scope');
  expect(JSON.parse((await annotations(page))!).questions[exam.questions[1]!.id]).toBeTruthy();
  await page.evaluate(
    ([key, raw]) => localStorage.setItem(key!, raw!),
    [
      storageKey(exam),
      JSON.stringify({ storageVersion: 3, current: createAttempt(exam, undefined, 'fresh') }),
    ],
  );
  await page.goto(`?exam=${exam.id}`);
  await expect(page.locator('mark.annotation-green')).toHaveCount(1);
  await expect(page.locator('.option.eliminated')).toHaveCount(0);
});
test('corrupt annotations preserve academic response; storage event conflict stays read-only', async ({
  page,
}) => {
  await seed(page);
  await select(page, 0, 5);
  await page.getByRole('button', { name: 'Amarelo', exact: true }).click();
  const good = await annotations(page);
  await page.evaluate((key) => {
    localStorage.setItem(key, '{bad');
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: '{bad', storageArea: localStorage }),
    );
  }, annotationStorageKey(exam));
  await expect(page.locator('mark.annotation-yellow')).toHaveCount(1);
  await expect(page.getByRole('status')).toContainText('bloqueada');
  await page.getByRole('radio').nth(1).check();
  expect((await current(page)).answers[q.id]).toBe(b);
  expect(await annotations(page)).toBe('{bad');
  await page.evaluate(
    ([key, raw]) => {
      localStorage.setItem(key!, raw!);
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue: raw, storageArea: localStorage }),
      );
    },
    [annotationStorageKey(exam), good],
  );
  await expect(page.getByText(/edição bloqueada/)).toHaveCount(0);
});
test('rich repeated leaves, Unicode, backward selection and one logical highlight across tags after reload/split', async ({
  page,
}) => {
  const richExam = structuredClone(exam);
  richExam.questions[0]!.statement = [
    { type: 'text', text: 'igual á ' },
    { type: 'element', tag: 'strong', children: [{ type: 'text', text: 'igual 😀' }] },
    { type: 'element', tag: 'br', children: [] },
    { type: 'element', tag: 'em', children: [{ type: 'text', text: ' e\u0301' }] },
    { type: 'element', tag: 'sub', children: [{ type: 'text', text: '𐐀' }] },
    { type: 'element', tag: 'sup', children: [{ type: 'text', text: ' fim' }] },
  ];
  await page.route(`**/generated/exams/${exam.id}.json`, (route) =>
    route.fulfill({ json: richExam }),
  );
  await seed(page);
  await select(page, 4, 24);
  await page.getByRole('button', { name: 'Azul', exact: true }).click();
  await expect(page.locator('.statement mark')).toHaveCount(5);
  expect(
    await page
      .locator('.statement mark')
      .evaluateAll(
        (marks) => new Set(marks.map((mark) => mark.getAttribute('data-highlight-id'))).size,
      ),
  ).toBe(1);
  await page.reload();
  await select(page, 8, 12);
  await page.getByRole('button', { name: 'Verde', exact: true }).click();
  await select(page, 10, 11);
  await page.getByRole('button', { name: 'Borracha', exact: true }).click();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.locator('.statement mark').first().click();
  const firstId = await page.locator('.statement mark').first().getAttribute('data-highlight-id');
  await page.getByRole('button', { name: 'Remover destaque', exact: true }).click();
  expect(
    await page
      .locator('.statement mark')
      .evaluateAll(
        (marks, id) => marks.some((mark) => mark.getAttribute('data-highlight-id') === id),
        firstId,
      ),
  ).toBe(false);
  await select(page, 0, 14);
  await page.evaluate(() => {
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(
      selection.focusNode!,
      selection.focusOffset,
      selection.anchorNode!,
      selection.anchorOffset,
    );
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: 'Amarelo', exact: true }).click();
  expect(
    JSON.parse((await annotations(page))!).questions[q.id].some(
      (h: { start: number; end: number }) => h.start === 0 && h.end === 14,
    ),
  ).toBe(true);
});
test('native cross-tab storage synchronization and same-tab stale writer preserve raw without writes', async ({
  page,
  context,
}) => {
  await seed(page);
  await select(page, 0, 5);
  await page.getByRole('button', { name: 'Amarelo', exact: true }).click();
  const good = await annotations(page),
    peer = await context.newPage();
  await peer.goto('?view=review');
  await peer.evaluate((key) => localStorage.setItem(key, '{bad'), annotationStorageKey(exam));
  await expect(page.getByRole('status')).toContainText('bloqueada');
  await expect(page.locator('.statement mark')).toHaveCount(1);
  await peer.evaluate(
    ([key, raw]) => localStorage.setItem(key!, raw!),
    [annotationStorageKey(exam), good],
  );
  await expect(page.getByText(/edição bloqueada/)).toHaveCount(0);
  expect(await annotations(page)).toBe(good);
  const concurrent = JSON.stringify(
    mutateAnnotations(exam, JSON.parse(good!), q.id, {
      type: 'paint',
      start: 8,
      end: 12,
      color: 'blue',
    }),
  );
  await page.evaluate(
    ([key, raw]) => localStorage.setItem(key!, raw!),
    [annotationStorageKey(exam), concurrent],
  );
  await select(page, 2, 4);
  await page.getByRole('button', { name: 'Verde', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('mudaram em outra aba');
  expect(await annotations(page)).toBe(concurrent);
  await peer.close();
});
for (const width of [375, 390, 768, 1024, 1280])
  for (const theme of ['light', 'dark', 'high', 'dark-high']) {
    test(`responsive ${width} ${theme} enlarged Linux font, toolbar and explicit targets fit`, async ({
      page,
    }) => {
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
      await page.getByRole('button', { name: 'Eliminar alternativa 1', exact: true }).click();
      await expect(page.locator('.option.eliminated')).toHaveCount(1);
      await select(page, 0, 20);
      await noOverflow(page);
      for (const button of await page
        .getByRole('group', { name: 'Ferramentas de marcação' })
        .getByRole('button')
        .all()) {
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await page
        .getByRole('button', { name: 'Focar ferramentas de marcação', exact: true })
        .click();
      await expect(page.getByRole('button', { name: 'Amarelo', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: 'Focar ferramentas de marcação', exact: true }),
      ).toBeFocused();
      await noOverflow(page);
    });
  }
