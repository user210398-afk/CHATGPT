import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chooseExam } from './attempt-helpers';

test('PWA: worker novo aguarda duas abas, falha de update preserva ativo, ativação não apaga caches alheios', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const source = await readFile('dist/sw.js', 'utf8');
  let version = 1;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/CHATGPT/sw.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(
        version === 3
          ? "throw new Error('test failed worker update');"
          : `${source}\n// test version ${version}`,
      );
      return;
    }
    const relative = path.slice('/CHATGPT/'.length) || 'index.html';
    const filename = resolve('dist', relative);
    if (!path.startsWith('/CHATGPT/') || !filename.startsWith(`${resolve('dist')}/`)) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      response.setHeader(
        'Content-Type',
        (
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.webmanifest': 'application/manifest+json',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
          } as Record<string, string>
        )[extname(filename)] ?? 'application/octet-stream',
      );
      response.end(await readFile(filename));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server');
  const url = `http://127.0.0.1:${address.port}/CHATGPT/`;
  const second = await context.newPage();
  try {
    await page.goto(url);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.goto(`${url}?exam=fisiologia-m5-aula-1-2026`);
    await chooseExam(page);
    await page.getByRole('radio').first().check();
    await page.evaluate(async () => {
      await caches.open('foreign-cache');
      sessionStorage.setItem('foreign-session', 'original');
      document.documentElement.dataset.documentId = 'unchanged';
    });
    const before = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    await second.goto(`${url}?view=settings`);
    await expect(second.getByRole('heading', { name: 'Configurações' })).toBeVisible();
    // A bad update fails installation; the first active worker remains and the page stays mounted.
    version = 3;
    const failed = await page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistration())!;
      const complete = new Promise<string>((done) =>
        registration.addEventListener(
          'updatefound',
          () => {
            const worker = registration.installing!;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'redundant') done(worker.state);
            });
          },
          { once: true },
        ),
      );
      try {
        await registration.update();
      } catch {
        return 'update-rejected';
      }
      return complete;
    });
    expect(['redundant', 'update-rejected']).toContain(failed);
    version = 2;
    await page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistration())!;
      await registration.update();
    });
    await expect
      .poll(() =>
        page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
      )
      .toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-document-id', 'unchanged');
    await expect(page.getByRole('radio').first()).toBeChecked();
    expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))).toEqual(
      before,
    );
    expect(await page.evaluate(() => sessionStorage.getItem('foreign-session'))).toBe('original');
    await second.goto('about:blank');
    expect(
      await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    ).toBe(true);
    await page.goto('about:blank'); // Last controlled document closes; allow default activation.
    await page.goto(url);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = (await navigator.serviceWorker.getRegistration())!;
          return !!registration.active && !registration.waiting;
        }),
      )
      .toBe(true);
    expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))).toEqual(
      before,
    );
    expect(await page.evaluate(() => caches.keys())).toEqual(['foreign-cache']);
    await page.goto(`${url}?exam=fisiologia-m5-aula-1-2026`);
    await expect(page.getByRole('radio').first()).toBeChecked();
    // Removal of this exact registration also keeps local study data and unrelated caches.
    expect(
      await page.evaluate(async () =>
        (await navigator.serviceWorker.getRegistration())!.unregister(),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))).toEqual(
      before,
    );
    expect(await page.evaluate(() => caches.keys())).toEqual(['foreign-cache']);
  } finally {
    await second.close();
    await page.goto('about:blank');
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});
