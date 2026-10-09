import { test, expect, devices, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultUiPreferences, uiPreferencesKey } from '../../src/engine/ui-preferences';
import { installDismissKey } from '../../src/pwa/install';
import { chooseExam } from './attempt-helpers';

const examId = 'fisiologia-m5-aula-1-2026';
async function ready(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Suas matérias' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}
async function home(page: Page) {
  await ready(page);
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key!, value!),
    [uiPreferencesKey, JSON.stringify({ ...defaultUiPreferences, setupPrompt: 'completed' })],
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Leve o MedSim para sua tela inicial' }),
  ).toBeVisible();
}
async function snapshot(page: Page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
}
async function emitInstall(page: Page, outcome: string, fails = false) {
  await page.evaluate(
    ({ outcome, fails }) => {
      const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => {
          document.documentElement.dataset.promptCalls = String(
            Number(document.documentElement.dataset.promptCalls ?? 0) + 1,
          );
          if (fails) throw new Error('unavailable');
        },
        userChoice: Promise.resolve({ outcome }),
      });
      window.dispatchEvent(event);
    },
    { outcome, fails },
  );
}

test('PWA: manifest carregável no Chromium não privado, ícones e worker com escopo real', async ({
  playwright,
}, info) => {
  // Default Playwright contexts are incognito: Chromium prohibits installation there.
  const profile = await mkdtemp(join(tmpdir(), 'medsim-pwa1-'));
  const context = await playwright.chromium.launchPersistentContext(profile, {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    ...(info.project.name === 'mobile' ? devices['Pixel 7'] : devices['Desktop Chrome']),
    baseURL: 'http://127.0.0.1:4173/CHATGPT/',
  });
  const page = await context.newPage();
  try {
    const errors: string[] = [],
      requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => requests.push(request.url()));
    await ready(page);
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.url).toBe('http://127.0.0.1:4173/CHATGPT/manifest.webmanifest');
    expect(manifest.errors).toEqual([]);
    const installability = await cdp.send('Page.getInstallabilityErrors');
    expect(installability.installabilityErrors).toEqual([]);
    const parsed = JSON.parse(manifest.data!);
    for (const icon of [...parsed.icons, { src: '/CHATGPT/icons/apple-touch-icon.png' }]) {
      const dimensions = await page.evaluate(async (src: string) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, icon.src);
      expect(dimensions[0]).toBeGreaterThanOrEqual(180);
      expect(dimensions[0]).toBe(dimensions[1]);
    }
    expect(
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return {
          scope: registration.scope,
          script: registration.active?.scriptURL,
          waiting: !!registration.waiting,
        };
      }),
    ).toEqual({
      scope: 'http://127.0.0.1:4173/CHATGPT/',
      script: 'http://127.0.0.1:4173/CHATGPT/sw.js',
      waiting: false,
    });
    expect(errors).toEqual([]);
    expect(requests.every((url) => url.startsWith('http://127.0.0.1:4173/CHATGPT/'))).toBe(true);
  } finally {
    await context.close();
    await rm(profile, { recursive: true });
  }
});

test('PWA: Home ordena cabeçalho, convite único e matérias sem sobreposição', async ({ page }) => {
  await home(page);
  const header = page.locator('.catalog-heading');
  const card = page.locator('.pwa-install');
  const subjects = page.locator('section[aria-labelledby="subjects-title"]');
  await expect(card).toHaveCount(1);
  await expect(header.getByRole('heading', { level: 1 })).toHaveAccessibleName(
    'Escolha o que você quer estudar.',
  );
  await expect(card).toContainText('É necessária conexão com a internet');
  await expect(card).toContainText('O funcionamento offline ainda não está disponível');
  expect(
    await header.evaluate((element) => [
      element.nextElementSibling?.classList.contains('pwa-install'),
      element.nextElementSibling?.nextElementSibling?.getAttribute('aria-labelledby'),
    ]),
  ).toEqual([true, 'subjects-title']);
  const headingBox = (await header.boundingBox())!;
  const cardBox = (await card.boundingBox())!;
  const subjectsBox = (await subjects.boundingBox())!;
  expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(cardBox.y);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(subjectsBox.y);
});

test('PWA: convite aguarda SetupPrompt, dispensa persiste sem alterar dados e instruções continuam', async ({
  page,
}) => {
  await ready(page);
  await expect(page.locator('.setup-prompt')).toBeVisible();
  await expect(page.locator('.pwa-install')).toHaveCount(0);
  await page.getByRole('button', { name: 'Agora não' }).click();
  const card = page.locator('.pwa-install');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Instalar MedSim' })).toHaveCount(0);
  await card.getByText('Como instalar', { exact: true }).click();
  await expect(card.locator('ol')).toBeVisible();
  const before = await snapshot(page);
  await card.getByRole('button', { name: 'Agora não' }).click();
  expect(await snapshot(page)).toEqual({ ...before, [installDismissKey]: 'dismissed' });
  await page.reload();
  await expect(card).toHaveCount(0);
  await page.goto('?view=settings');
  await expect(page.getByRole('heading', { name: 'MedSim no celular' })).toBeVisible();
  await expect(page.locator('.pwa-guide ol')).toBeVisible();
  expect(await snapshot(page)).toEqual({ ...before, [installDismissKey]: 'dismissed' });
});

for (const outcome of ['accepted', 'dismissed', 'failure']) {
  test(`PWA: evento progressivo simulado, clique explícito e resultado ${outcome}`, async ({
    page,
  }) => {
    await home(page);
    await emitInstall(page, outcome, outcome === 'failure');
    await expect(page.getByRole('button', { name: 'Instalar MedSim' })).toBeVisible();
    expect(await page.locator('html').getAttribute('data-prompt-calls')).toBeNull();
    await page.getByRole('button', { name: 'Instalar MedSim' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-prompt-calls', '1');
    await expect(page.getByRole('button', { name: 'Instalar MedSim' })).toHaveCount(0);
    await expect(page.locator('.pwa-install')).toContainText(
      outcome === 'accepted'
        ? 'Solicitação aceita'
        : outcome === 'failure'
          ? 'não está disponível agora'
          : 'Instalação não confirmada',
    );
    if (outcome === 'accepted') {
      await expect(page.locator('.pwa-install')).not.toContainText('Instalação confirmada');
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
      await expect(page.locator('.pwa-install')).toHaveCount(0);
    }
  });
}

test('PWA: standalone iOS sem convite e guia manual adequado no Safari/Samsung', async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await ready(page);
  await page.getByRole('button', { name: 'Agora não' }).click();
  await expect(page.locator('.pwa-install')).toHaveCount(0);
  await page.goto('?view=settings');
  await expect(page.locator('.pwa-install')).toContainText('já está aberto em modo aplicativo');
  await expect(page.getByRole('button', { name: 'Instalar MedSim' })).toHaveCount(0);
});

for (const [ua, guide, step] of [
  ['Mozilla/5.0 (iPhone) AppleWebKit Safari', 'iPhone e iPad', 'Adicionar à Tela de Início'],
  ['Mozilla/5.0 Android SamsungBrowser/27 Chrome/130', 'Samsung Internet', 'Adicionar página a'],
]) {
  test(`PWA: instruções manuais ${guide}`, async ({ page }) => {
    await page.addInitScript(
      (ua) => Object.defineProperty(navigator, 'userAgent', { value: ua }),
      ua,
    );
    await page.goto('?view=settings');
    await expect(page.locator('.pwa-guide')).toContainText(guide!);
    await expect(page.locator('.pwa-guide')).toContainText(step!);
    await expect(page.getByRole('button', { name: 'Instalar MedSim' })).toHaveCount(0);
    await expect(page.locator('.pwa-install')).toContainText('exporte um backup');
  });
}

test('PWA: offline preserva prova carregada, navegação falha com aviso; zero caches e legado intacto', async ({
  page,
  context,
}) => {
  await ready(page);
  await page.goto(`?exam=${examId}`);
  await chooseExam(page);
  await page.getByRole('radio').first().check();
  const before = await snapshot(page);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  await context.setOffline(true);
  await expect(
    page.getByRole('status').filter({ hasText: 'Sem conexão com a internet' }),
  ).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeChecked();
  await expect(page.getByRole('radio').first()).toBeEnabled();
  expect(await snapshot(page)).toEqual(before);
  expect(
    await page.evaluate(async () => {
      try {
        await fetch('/CHATGPT/generated/exam-index.json');
        return 'unexpected';
      } catch {
        return 'network-failure';
      }
    }),
  ).toBe('network-failure');
  await context.setOffline(false);
  await expect(
    page.getByRole('status').filter({ hasText: 'Sem conexão com a internet' }),
  ).toHaveCount(0);
  await context.setOffline(true);
  const response = await page.goto('./');
  expect(response?.status()).toBe(503);
  await expect(page.getByRole('heading', { name: 'MedSim precisa de internet' })).toBeVisible();
  await expect(page.getByText(/O funcionamento offline ainda não está disponível/)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Tentar novamente com conexão' }).click();
  await expect(page.getByRole('heading', { name: 'Suas matérias' })).toBeVisible();
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  await page.goto('legacy/index.html');
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(0);
});

test('PWA: erro de requisição com onLine=true e HTTP 404 conservam dados; CSP bloqueia JS/recursos indevidos', async ({
  page,
  context,
}) => {
  await home(page);
  await context.route('**/generated/exams/*.json', (route) => route.abort('failed'));
  const before = await snapshot(page);
  await page.goto(`?exam=${examId}`);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.getByRole('alert')).toContainText('Sem conexão com a internet');
  expect(await snapshot(page)).toEqual(before);
  await context.unroute('**/generated/exams/*.json');
  // Vite preview has SPA fallback for missing files; explicitly exercise an HTTP failure.
  await context.route('**/generated/exams/not-found.json', (route) =>
    route.fulfill({ status: 404, body: 'Not found' }),
  );
  await page.goto('?exam=not-found');
  await expect(page.getByRole('alert')).toContainText('HTTP 404');
  await page.goto('./');
  await page.evaluate(() => {
    const violations: string[] = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(event.effectiveDirective);
      document.documentElement.dataset.cspViolations = JSON.stringify(violations);
    });
    document.documentElement.dataset.xss = 'safe';
    const script = document.createElement('script');
    script.textContent = "document.documentElement.dataset.xss='executed'";
    document.body.append(script);
    const image = document.createElement('img');
    image.setAttribute('onerror', "document.documentElement.dataset.xss='executed'");
    image.src = '/CHATGPT/not-found.png';
    document.body.append(image);
  });
  const result = await page.evaluate(async () => {
    try {
      await fetch('https://external.invalid/collect');
      return 'unexpected';
    } catch {
      return 'blocked';
    }
  });
  expect(result).toBe('blocked');
  await expect
    .poll(async () =>
      JSON.parse((await page.locator('html').getAttribute('data-csp-violations')) ?? '[]'),
    )
    .toEqual(expect.arrayContaining(['script-src-elem', 'script-src-attr', 'connect-src']));
  await expect(page.locator('html')).toHaveAttribute('data-xss', 'safe');
  expect(
    await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'),
  ).toContain("style-src-attr 'none'");
});

test('PWA: convite não entra em provas, revisão, matérias ou tour; tour preserva estado', async ({
  page,
}) => {
  await home(page);
  for (const route of [
    '?view=dashboard',
    '?view=error-notebook',
    '?view=review',
    '?view=review-session',
    '?area=fisiologia',
    '?view=all',
    `?exam=${examId}`,
  ]) {
    await page.goto(route);
    await expect(page.locator('.pwa-install')).toHaveCount(0);
  }
  await page.goto('./');
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Conhecer o MedSim' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.pwa-install')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('.pwa-install')).toBeVisible();
});

for (const theme of ['light', 'dark']) {
  test(`PWA: acessível ${theme}, contraste alto, texto ampliado, compacta e movimento reduzido`, async ({
    page,
  }) => {
    await home(page);
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key!, value!),
      [
        uiPreferencesKey,
        JSON.stringify({
          ...defaultUiPreferences,
          setupPrompt: 'completed',
          theme,
          contrast: 'high',
          textSize: 'large',
          density: 'compact',
          reduceMotion: true,
          enhancedFocus: true,
        }),
      ],
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const guide = page.locator('.pwa-guide summary');
    await guide.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.pwa-guide ol')).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
    }
    await expect(guide).toBeFocused();
    expect(await guide.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    expect((await guide.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const width of [375, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
    expect(
      await page.locator('.pwa-install').evaluate((element) => getComputedStyle(element).position),
    ).toBe('static');
  });
}
