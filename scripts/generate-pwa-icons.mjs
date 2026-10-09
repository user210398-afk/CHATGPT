// Explicit authoring utility, never called by build/CI. Uses existing Playwright.
// Rasterizes the existing blue + serif M motif with a locally available font.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
try {
  const page = await browser.newPage();
  await mkdir('public/icons', { recursive: true });
  for (const [name, size, maskable] of [
    ['medsim-192.png', 192, false],
    ['medsim-512.png', 512, false],
    ['apple-touch-icon.png', 180, false],
    ['medsim-maskable-512.png', 512, true],
  ]) {
    const png = await page.evaluate(
      ({ size, maskable }) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas indisponível');
        // Opaque background is suitable for iOS and maskable safe-zone cropping.
        context.fillStyle = '#174ea6';
        context.fillRect(0, 0, size, size);
        context.fillStyle = '#ffffff';
        context.font = `${size * (maskable ? 0.52 : 0.7)}px Georgia, serif`;
        const metrics = context.measureText('M');
        context.fillText(
          'M',
          (size - metrics.width) / 2,
          (size + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2,
        );
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { size, maskable },
    );
    await writeFile(`public/icons/${name}`, Buffer.from(png, 'base64'));
  }
} finally {
  await browser.close();
}
