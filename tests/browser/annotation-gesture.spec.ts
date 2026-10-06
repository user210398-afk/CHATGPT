import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseExam } from '../../schema/exam';
import { createAttempt } from '../../src/engine/exam-state';
import { storageKey } from '../../src/engine/persistence';
import { annotationStorageKey } from '../../src/engine/question-annotations-storage';
import { emptyAnnotations, mutateAnnotations } from '../../src/engine/question-annotations';
import { gesture } from './annotation-helpers';
const exam = parseExam(
  JSON.parse(readFileSync('data/exams/fisiologia-m5-aula-1-2026.json', 'utf8')),
);
const questionId = exam.questions[0]!.id,
  key = annotationStorageKey(exam);
async function seed(page: Page) {
  await page.goto('?view=review');
  await page.evaluate(
    ([key, raw]) => localStorage.setItem(key!, raw!),
    [
      storageKey(exam),
      JSON.stringify({
        storageVersion: 3,
        current: createAttempt(exam, undefined, 'gesture-test'),
      }),
    ],
  );
  await page.goto(`?exam=${exam.id}`);
  await expect(page.locator('.statement')).toBeVisible();
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (window as any).annotationWrites = 0;
    Storage.prototype.setItem = function (k, v) {
      if (this === localStorage && k === key) (window as any).annotationWrites++;
      return original.call(this, k, v);
    };
  }, key);
}
const writes = (page: Page) => page.evaluate(() => (window as any).annotationWrites);
const raw = (page: Page) => page.evaluate((key) => localStorage.getItem(key), key);
async function coordinates(page: Page) {
  await page.locator('.statement').scrollIntoViewIfNeeded();
  return page.locator('.statement').evaluate((root) => {
    function at(offset: number) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node as Text;
        if (offset <= text.length) {
          const range = document.createRange();
          const atEnd = offset === text.length;
          range.setStart(text, atEnd ? offset - 1 : offset);
          range.setEnd(text, atEnd ? offset : offset + 1);
          const rect = range.getClientRects()[0]!;
          return { x: atEnd ? rect.right : rect.left, y: (rect.top + rect.bottom) / 2 };
        }
        offset -= text.length;
      }
      throw new Error('fixture boundary');
    }
    return { a: at(2), b: at(18) };
  });
}
async function synthetic(
  page: Page,
  type: string,
  point: { x: number; y: number },
  init: Partial<
    Pick<PointerEventInit, 'pointerId' | 'pointerType' | 'isPrimary' | 'button' | 'buttons'>
  > = {},
) {
  await page.locator('.statement').evaluate(
    (root, { type, point, init }) =>
      root.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 71,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: point.x,
          clientY: point.y,
          ...init,
        }),
      ),
    { type, point, init },
  );
}
async function begin(page: Page) {
  await page.getByRole('button', { name: 'Grifar', exact: true }).click();
  const points = await coordinates(page);
  await synthetic(page, 'pointerdown', points.a);
  await synthetic(page, 'pointermove', points.b);
  return points;
}
test('real mouse: hover zero-write, down/move preview zero-write, up exactly once; off native selection', async ({
  page,
}) => {
  await seed(page);
  await expect(page.getByRole('button', { name: 'Grifar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('group', { name: 'Ferramentas de marcação' })).toBeVisible();
  const before = await page.evaluate((key) => localStorage.getItem(key), storageKey(exam));
  await page.getByRole('button', { name: 'Grifar', exact: true }).click();
  const { a, b } = await coordinates(page);
  await page.mouse.move(a.x, a.y);
  await page.mouse.move(b.x, b.y);
  expect(await writes(page)).toBe(0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await writes(page)).toBe(0);
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await expect(page.locator('[data-annotation-preview]').first()).toBeVisible();
  expect(await writes(page)).toBe(0);
  expect(await raw(page)).toBeNull();
  await page.mouse.up();
  expect(await writes(page)).toBe(1);
  await page.keyboard.press('Escape');
  // Mode hint can wrap differently at mobile width; resolve live positions after it changes.
  const off = await coordinates(page);
  await page.mouse.move(off.a.x, off.a.y);
  await page.mouse.down();
  await page.mouse.move(off.b.x, off.b.y, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
  expect(await writes(page)).toBe(1);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey(exam))).toBe(before);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
for (const pointerType of ['touch', 'pen'])
  test(`${pointerType} pointer at 390: no native Selection; one write only on up`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seed(page);
    await page.getByRole('button', { name: 'Grifar', exact: true }).click();
    const { a, b } = await coordinates(page);
    await synthetic(page, 'pointerdown', a, { pointerType });
    expect(await writes(page)).toBe(0);
    await synthetic(page, 'pointermove', b, { pointerType });
    expect(await writes(page)).toBe(0);
    await expect(page.locator('[data-annotation-preview]').first()).toBeVisible();
    await synthetic(page, 'pointerup', b, { pointerType, buttons: 0 });
    expect(await writes(page)).toBe(1);
    expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
  });
for (const reason of [
  'pointercancel',
  'lostpointercapture',
  'switch',
  'question',
  'navigate',
  'outside',
  'corrupt',
  'conflict',
  'tap',
])
  test(`red team ${reason}: zero ghost write`, async ({ page }) => {
    await seed(page);
    const { a, b } = await begin(page);
    expect(await writes(page)).toBe(0);
    let preserved: string | null = null;
    if (reason === 'pointercancel' || reason === 'lostpointercapture')
      await synthetic(page, reason, b);
    else if (reason === 'switch')
      await page.getByRole('button', { name: 'Borracha', exact: true }).click();
    else if (reason === 'question')
      await page.getByRole('button', { name: 'Próxima →', exact: true }).click();
    else if (reason === 'navigate') {
      await page.goto('?view=review');
      expect(await raw(page)).toBeNull();
      return;
    } else if (reason === 'tap') {
      await synthetic(page, 'pointercancel', b);
      await synthetic(page, 'pointerdown', a);
      await synthetic(page, 'pointerup', a);
    } else if (reason === 'corrupt' || reason === 'conflict') {
      preserved =
        reason === 'corrupt'
          ? '{bad'
          : JSON.stringify(
              mutateAnnotations(exam, emptyAnnotations(exam), questionId, {
                type: 'paint',
                start: 30,
                end: 40,
                color: 'blue',
              }),
            );
      await page.evaluate(
        ([key, value]) => {
          localStorage.setItem(key!, value!);
          (window as any).annotationWrites = 0;
        },
        [key, preserved],
      );
    }
    await synthetic(page, 'pointerup', reason === 'outside' ? { x: -10, y: -10 } : b, {
      buttons: 0,
    });
    expect(await writes(page)).toBe(0);
    expect(await raw(page)).toBe(preserved);
    await expect(page.locator('[data-annotation-preview]')).toHaveCount(0);
    if (reason === 'question')
      await expect(page.locator('.statement')).toHaveAttribute('data-annotation-tool', 'off');
  });
test('second finger/nonprimary/right/middle ignored, primary continues; fallback caretRange API', async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(() =>
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: undefined,
    }),
  );
  await page.getByRole('button', { name: 'Grifar', exact: true }).click();
  const { a, b } = await coordinates(page);
  for (const init of [{ isPrimary: false }, { button: 2, buttons: 2 }, { button: 1, buttons: 4 }]) {
    await synthetic(page, 'pointerdown', a, init);
    await synthetic(page, 'pointermove', b, init);
    await synthetic(page, 'pointerup', b, init);
  }
  expect(await writes(page)).toBe(0);
  await synthetic(page, 'pointerdown', a);
  await synthetic(page, 'pointerdown', b, { pointerId: 72, isPrimary: false });
  await synthetic(page, 'pointermove', b, { pointerId: 72 });
  await synthetic(page, 'pointerup', b, { pointerId: 72 });
  expect(await writes(page)).toBe(0);
  await synthetic(page, 'pointermove', b);
  await synthetic(page, 'pointerup', b);
  expect(await writes(page)).toBe(1);
});
test('real mouse captured outside release cancels, lost capture cancels, reverse and multiline commits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await seed(page);
  await page.getByRole('button', { name: 'Grifar', exact: true }).click();
  const { a, b } = await coordinates(page);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.mouse.move(1, b.y);
  await page.mouse.up();
  expect(await writes(page)).toBe(0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.locator('.statement').evaluate((root) => {
    // Chromium mouse pointerId is 1. Explicit release generates real lostpointercapture.
    if (root.hasPointerCapture(1)) root.releasePointerCapture(1);
  });
  await page.mouse.move(b.x + 1, b.y);
  await page.mouse.up();
  expect(await writes(page)).toBe(0);
  await gesture(page, 80, 2);
  expect(await writes(page)).toBe(1);
  const highlights = JSON.parse((await raw(page))!).questions[questionId];
  expect(highlights[0]).toMatchObject({ start: 2, end: 80 });
});
test('Chromium native touch input: active statement owns swipe, off restores scroll; no global lock', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await seed(page);
  const cdp = await context.newCDPSession(page);
  async function swipe(a: { x: number; y: number }, b: { x: number; y: number }) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...a, id: 0 }],
    });
    for (let i = 1; i <= 8; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8, id: 0 }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await page.getByRole('button', { name: 'Grifar', exact: true }).click();
  const { a, b } = await coordinates(page);
  const before = await page.evaluate(() => window.scrollY);
  await swipe(a, b);
  expect(await writes(page)).toBe(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  expect(
    await page.locator('.statement').evaluate((root) => getComputedStyle(root).touchAction),
  ).toBe('none');
  expect(await page.locator('body').evaluate((root) => getComputedStyle(root).touchAction)).toBe(
    'auto',
  );
  // A vertical swipe would scroll the browser without the local active touch-action rule.
  const activeBox = await page.locator('.statement').boundingBox();
  await swipe(
    { x: activeBox!.x + 40, y: activeBox!.y + activeBox!.height - 10 },
    { x: activeBox!.x + 40, y: activeBox!.y + 5 },
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  expect(await writes(page)).toBe(2);
  await page.keyboard.press('Escape');
  expect(
    await page.locator('.statement').evaluate((root) => getComputedStyle(root).touchAction),
  ).toBe('auto');
  expect(
    await page.locator('.statement').evaluate((root) => getComputedStyle(root).userSelect),
  ).not.toBe('none');
  const box = await page.locator('.statement').boundingBox();
  const offBefore = await page.evaluate(() => window.scrollY);
  await swipe({ x: box!.x + 40, y: box!.y + box!.height - 10 }, { x: box!.x + 40, y: box!.y + 5 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(offBefore);
  expect(await writes(page)).toBe(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await cdp.detach();
});
