import type { Page } from '@playwright/test';
export async function gesture(page: Page, start: number, end: number) {
  await page.locator('.statement').scrollIntoViewIfNeeded();
  const points = await page.evaluate(
    ({ start, end }) => {
      const root = document.querySelector('.statement')!;
      function coordinate(offset: number) {
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
        throw new Error('fixture range');
      }
      return [coordinate(start), coordinate(end)];
    },
    { start, end },
  );
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 8 });
  await page.mouse.up();
}
export async function paint(page: Page, start: number, end: number, color: string) {
  const button = page.getByRole('button', { name: 'Grifar', exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await page.getByRole('button', { name: color, exact: true }).click();
  await gesture(page, start, end);
}
export async function erase(page: Page, start: number, end: number) {
  const button = page.getByRole('button', { name: 'Borracha', exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await gesture(page, start, end);
}
