import { chooseExam } from './attempt-helpers';
import { storageFixtureJson } from '../legacy-fixtures';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseExam } from '../../schema/exam';
import { readExamCatalog } from '../../scripts/catalog';
import type { Backup } from '../../src/engine/backup';
import { createAttempt, transition } from '../../src/engine/exam-state';
import { storageKey, historyStorageKey, summary } from '../../src/engine/persistence';
import { catalogPreferencesKey } from '../../src/engine/catalog-preferences';
import {
  defaultUiPreferences,
  uiPreferencesKey,
  legacyThemeKey,
} from '../../src/engine/ui-preferences';
const poc = parseExam(
  JSON.parse(readFileSync('data/exams/fisiologia-m5-aula-1-2026.json', 'utf8')),
);
function metric(page: Page, label: string) {
  return page
    .locator('.metric')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');
}
function monitor(page: Page) {
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  return () => {
    expect(errors).toEqual([]);
    expect(
      requests.every(
        (url) => url.startsWith('http://127.0.0.1:4173/CHATGPT/') || url.startsWith('blob:'),
      ),
    ).toBe(true);
    return requests;
  };
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
async function snapshot(page: Page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
}
async function seed(page: Page, entries: [string, string][]) {
  await page.evaluate((entries) => {
    for (const [key, value] of entries) localStorage.setItem(key, value);
  }, entries);
  await page.reload();
}
async function tabTo(page: Page, control: Locator) {
  for (let i = 0; i < 120; i++) {
    if (
      await control.evaluate(
        (element) => element === document.activeElement && element.matches(':focus-visible'),
      )
    )
      return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Controle inacessível por teclado.');
}
async function focusProof(page: Page, control: Locator) {
  await control.click();
  expect(await control.evaluate((element) => element.matches(':focus-visible'))).toBe(false);
  expect(await control.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
  expect(
    await control.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('-webkit-tap-highlight-color'),
    ),
  ).toBe('rgba(0, 0, 0, 0)');
  await tabTo(page, control);
  expect(await control.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
  expect(
    await control.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth)),
  ).toBeGreaterThanOrEqual(3);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
}
function inputBackup(current = createAttempt(poc, '2026-10-03T10:00:00.000Z')): Backup {
  return {
    format: 'medsim-backup',
    version: 2,
    exportedAt: '2026-10-04T12:00:00.000Z',
    exams: [{ examId: poc.id, revision: 1, current, history: [], reviewAttempts: [] }],
    catalogPreferences: { storageVersion: 1, favorites: [poc.id] },
    uiPreferences: {
      ...defaultUiPreferences,
      theme: 'dark',
      textSize: 'large',
      setupPrompt: 'completed',
    },
  };
}
async function selectFile(page: Page, input: unknown) {
  await page.getByLabel('Importar progresso', { exact: true }).setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(storageFixtureJson(input)),
  });
}

test('7A.2: dashboard vazio, navegação e apenas índice no carregamento normal', async ({
  page,
}) => {
  const check = monitor(page),
    { catalog } = await readExamCatalog();
  await page.goto('?view=dashboard');
  await expect(page.getByRole('heading', { name: 'Meu desempenho' })).toBeVisible();
  await expect(metric(page, 'Provas disponíveis')).toHaveText(String(catalog.exams.length));
  await expect(metric(page, 'Provas concluídas')).toHaveText('0');
  await expect(metric(page, 'Não iniciadas')).toHaveText(String(catalog.exams.length));
  await expect(metric(page, 'Melhor resultado')).toHaveText('—');
  await expect(page.getByText('Nenhuma atividade salva neste navegador.')).toBeVisible();
  await expect(page.locator('.app-nav a[aria-current="page"]')).toHaveText('Dashboard');
  await expect(page.getByRole('heading', { name: 'Desempenho por disciplina' })).toBeVisible();
  await noOverflow(page);
  await page.getByRole('link', { name: 'Ir para catálogo' }).click();
  await expect(page.getByRole('heading', { name: 'Suas matérias' })).toBeVisible();
  await page.locator('.app-nav').getByRole('link', { name: 'Configurações' }).click();
  await expect(page.getByLabel('Tema', { exact: true })).toBeVisible();
  await noOverflow(page);
  expect(check().filter((url) => /generated\/exams\//.test(url))).toEqual([]);
  expect(await snapshot(page)).toEqual({});
});

test('7A.2: rotas desconhecidas caem no catálogo e exam válido prevalece sobre view', async ({
  page,
}) => {
  await page.goto('?view=unknown');
  await expect(page.getByRole('heading', { name: 'Suas matérias' })).toBeVisible();
  await page.goto('?exam=../bad&view=dashboard');
  await expect(page.getByRole('heading', { name: 'Meu desempenho' })).toBeVisible();
  await page.goto(`?exam=${poc.id}&view=settings`);
  await chooseExam(page);
  await expect(page.getByRole('heading', { name: poc.title, exact: true })).toBeVisible();
  await expect(page.locator('.app-nav a[aria-current="page"]')).toHaveCount(0);
});

test('7A.2: dogfood responder, dashboard, concluir, disciplina e atividade recente', async ({
  page,
}, info) => {
  const check = monitor(page);
  await page.goto('?view=all');
  const card = page
    .getByRole('article')
    .filter({ has: page.locator(`a[href="/CHATGPT/?exam=${poc.id}"]`) });
  await card.getByRole('link', { name: /Abrir prova/ }).click();
  await chooseExam(page);
  const first = poc.questions[0]!;
  if (first.type !== 'multiple-choice') throw new Error('Fixture objetiva');
  await page
    .getByRole('radio')
    .nth(first.options.findIndex((option) => option.id === first.correctAnswer))
    .check();
  await page.locator('.app-nav').getByRole('link', { name: 'Dashboard' }).click();
  await expect(metric(page, 'Em andamento')).toHaveText('1');
  await expect(page.locator('.recent-list')).toContainText('Em andamento');
  await expect(metric(page, 'Último resultado')).toHaveText('—');
  await page.getByRole('link', { name: poc.title, exact: true }).click();
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização' }).click();
  await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeVisible();
  await page.locator('.app-nav').getByRole('link', { name: 'Dashboard' }).click();
  await expect(metric(page, 'Provas concluídas')).toHaveText('1');
  await expect(metric(page, 'Tentativas concluídas no total')).toHaveText('1');
  await expect(metric(page, 'Último resultado')).toHaveText('5%');
  await expect(page.locator('.recent-list')).toContainText('Concluída · 5%');
  const subject = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: poc.subject, exact: true }) });
  await expect(subject).toContainText('Média dos melhores');
  await expect(subject).toContainText('5%');
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('dashboard-dogfood.png'), fullPage: true });
  check();
});

test('7A.2: legado light/dark intacto, system acompanha OS e atalho vira explícito', async ({
  page,
}) => {
  for (const theme of ['light', 'dark']) {
    await page.goto('?view=settings');
    const raw = storageFixtureJson({ version: 1, theme });
    await page.evaluate(
      ({ key, raw, uiKey }) => {
        localStorage.removeItem(uiKey);
        localStorage.setItem(key, raw);
      },
      { key: legacyThemeKey, raw, uiKey: uiPreferencesKey },
    );
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByLabel('Tema', { exact: true })).toHaveValue(theme);
    expect((await snapshot(page))[uiPreferencesKey]).toBeUndefined();
    await page.getByLabel('Tema', { exact: true }).selectOption('system');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: /Tema escuro/ }).click();
    await expect(page.getByLabel('Tema', { exact: true })).toHaveValue('dark');
    expect((await snapshot(page))[legacyThemeKey]).toBe(raw);
  }
});

test('7A.2: todas configurações persistem e aplicam em prova e resultado', async ({ page }) => {
  await page.goto('?view=settings');
  await page.getByLabel('Tema', { exact: true }).selectOption('dark');
  await page.getByLabel('Tamanho do texto').selectOption('large');
  await page.getByLabel('Densidade').selectOption('compact');
  await page.getByLabel('Contraste').selectOption('high');
  await page.getByRole('checkbox', { name: /Reduzir movimentos/ }).check();
  await page.getByRole('checkbox', { name: /Indicador de foco reforçado/ }).check();
  await page.reload();
  const attrs = {
    'data-theme': 'dark',
    'data-text-size': 'large',
    'data-density': 'compact',
    'data-contrast': 'high',
    'data-reduced-motion': 'true',
    'data-enhanced-focus': 'true',
  };
  for (const [key, value] of Object.entries(attrs))
    await expect(page.locator('html')).toHaveAttribute(key, value);
  await page.goto(`?exam=${poc.id}`);
  await chooseExam(page);
  await expect(page.getByRole('heading', { name: poc.title, exact: true })).toBeVisible();
  for (const [key, value] of Object.entries(attrs))
    await expect(page.locator('html')).toHaveAttribute(key, value);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização' }).click();
  await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeVisible();
  await noOverflow(page);
});

test('7A.2: 375/390px, três tamanhos, densidade e quatro combinações de contraste', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('?view=settings');
    for (const size of ['normal', 'medium', 'large']) {
      await page.getByLabel('Tamanho do texto').selectOption(size);
      for (const theme of ['light', 'dark']) {
        await page.getByLabel('Tema', { exact: true }).selectOption(theme);
        for (const contrast of ['standard', 'high']) {
          await page.getByLabel('Contraste').selectOption(contrast);
          await noOverflow(page);
          const ratio = await page.evaluate(() => {
            const luminance = (token: string) => {
              const probe = document.createElement('span');
              probe.style.color = `var(--color-${token})`;
              document.body.append(probe);
              const rgb = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? [])
                .slice(0, 3)
                .map(Number)
                .map((v) => v / 255)
                .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
              probe.remove();
              return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
            };
            return [
              ['text', 'surface'],
              ['muted', 'surface'],
              ['on-primary', 'primary'],
              ['success', 'success-bg'],
              ['error', 'error-bg'],
              ['attention', 'attention-bg'],
              ['border', 'surface'],
              ['focus', 'surface'],
            ].map(([a, b]) => {
              const x = luminance(a!),
                y = luminance(b!);
              return { token: a, ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) };
            });
          });
          for (const r of ratio)
            if (r.token !== 'border' || contrast === 'high')
              expect(r.ratio, `${theme}/${contrast} ${r.token}`).toBeGreaterThanOrEqual(
                ['focus', 'border'].includes(r.token!) ? 3 : 4.5,
              );
        }
      }
    }
    await page.getByLabel('Densidade').selectOption('compact');
    for (const control of await page.locator('button, select, .app-nav a, .setting-check').all())
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.locator('.app-nav').getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Meu desempenho' })).toBeVisible();
    await noOverflow(page);
  }
  await page.screenshot({
    path: info.outputPath('dashboard-mobile-large-high.png'),
    fullPage: true,
  });
});

test('7A.2: mouse/touch sem retângulo, Tab/Shift+Tab com foco no header, favorito, ação e setting', async ({
  page,
}) => {
  await page.goto('?view=all');
  await focusProof(page, page.getByRole('button', { name: /Tema escuro|Tema claro/ }));
  await focusProof(page, page.locator('.favorite-button').first());
  await page.locator('.exam-card-footer .primary').first().click();
  await chooseExam(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await focusProof(page, page.getByRole('button', { name: 'Próxima →' }));
  await page.goto('?view=settings');
  await focusProof(page, page.getByRole('button', { name: 'Exportar progresso' }));
  await page.getByRole('checkbox', { name: /Indicador de foco reforçado/ }).check();
  await page.getByLabel('Contraste').selectOption('high');
  const exportButton = page.getByRole('button', { name: 'Exportar progresso' });
  await tabTo(page, exportButton);
  expect(await exportButton.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe(
    '5px',
  );
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(exportButton).toBeFocused();
});

test('7A.2: movimento do OS prevalece com opção desligada; active fornece feedback', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('?view=settings');
  await expect(page.getByRole('checkbox', { name: /Reduzir movimentos/ })).not.toBeChecked();
  const button = page.getByRole('button', { name: 'Exportar progresso' });
  expect(await button.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
    '0s',
  );
  expect(await button.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('checkbox', { name: /Reduzir movimentos/ }).check();
  expect(await button.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
    '0s',
  );
  await page.goto('./');
  const nav = page.locator('.app-nav').getByRole('link', { name: 'Dashboard' });
  const before = await nav.evaluate((element) => getComputedStyle(element).backgroundColor);
  const box = (await nav.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  expect(await nav.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    before,
  );
  await page.mouse.up();
});

test('7A.2: convite opcional não bloqueia e não reaparece depois de decisão válida', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Suas matérias' })).toBeVisible();
  await page.getByRole('link', { name: 'Configurar agora' }).click();
  await expect(page.getByLabel('Tema', { exact: true })).toBeVisible();
  expect((await snapshot(page))[uiPreferencesKey]).toBeUndefined();
  await page.goto('./');
  await page.getByRole('button', { name: 'Agora não' }).click();
  await expect(page.getByRole('complementary', { name: 'Personalização opcional' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Agora não' })).toHaveCount(0);
});

test('7A.2: storage bloqueado mantém settings e banner dispensável na sessão', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Agora não' }).click();
  await expect(page.getByRole('complementary', { name: 'Personalização opcional' })).toHaveCount(0);
  await page.goto('?view=settings');
  await page.getByLabel('Tamanho do texto').selectOption('medium');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'medium');
  await expect(page.getByRole('status')).toContainText(
    'Aplicada nesta sessão, mas não pôde ser salva',
  );
  await noOverflow(page);
});

test('7A.2: backup roundtrip real em contexto limpo com progresso, histórico, favoritos e settings', async ({
  page,
  browser,
}, info) => {
  const check = monitor(page);
  await page.goto(`?exam=${poc.id}`);
  await chooseExam(page);
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização' }).click();
  await page.locator('.app-nav').getByRole('link', { name: 'Matérias' }).click();
  await page.getByRole('link', { name: 'Ver todos os simulados' }).click();
  await page
    .getByRole('article')
    .filter({ has: page.locator(`a[href="/CHATGPT/?exam=${poc.id}"]`) })
    .getByRole('button', { name: /Adicionar .* aos favoritos/ })
    .click();
  await page.locator('.app-nav').getByRole('link', { name: 'Configurações' }).click();
  await page.getByLabel('Tema', { exact: true }).selectOption('dark');
  await page.getByLabel('Tamanho do texto').selectOption('large');
  const before = await snapshot(page),
    downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar progresso' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^medsim-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  if (!file) throw new Error('Download ausente');
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
    format: 'medsim-backup',
    version: 2,
  });
  const context = await browser.newContext({
    ...info.project.use,
    baseURL: 'http://127.0.0.1:4173/CHATGPT/',
    acceptDownloads: true,
  });
  try {
    const restored = await context.newPage();
    await restored.goto('?view=settings');
    await restored.getByLabel('Importar progresso', { exact: true }).setInputFiles(file);
    await expect(restored.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
    expect(await snapshot(restored)).toEqual({});
    await expect(
      restored.getByRole('checkbox', {
        name: 'Aplicar preferências de aparência e acessibilidade do backup',
      }),
    ).toBeChecked();
    await restored.getByRole('button', { name: 'Confirmar importação' }).click();
    await expect(restored.getByRole('status')).toContainText('Importação concluída');
    await restored.getByRole('button', { name: 'Recarregar para aplicar' }).click();
    const after = await snapshot(restored);
    for (const key of [
      storageKey(poc),
      historyStorageKey(poc),
      catalogPreferencesKey,
      uiPreferencesKey,
    ])
      expect(JSON.parse(after[key]!)).toEqual(JSON.parse(before[key]!));
    await expect(restored.locator('html')).toHaveAttribute('data-theme', 'dark');
    await restored.locator('.app-nav').getByRole('link', { name: 'Dashboard' }).click();
    await expect(metric(restored, 'Provas concluídas')).toHaveText('1');
    await restored.locator('.app-nav').getByRole('link', { name: 'Matérias' }).click();
    await restored.getByRole('link', { name: 'Ver todos os simulados' }).click();
    await expect(
      restored.getByRole('button', { name: `Remover ${poc.title} dos favoritos` }),
    ).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await context.close();
  }
  expect(await snapshot(page)).toEqual(before);
  check();
});

test('7A.2: current diferente preservado, histórico/favoritos mesclados e UI desmarcada', async ({
  page,
}) => {
  await page.goto('?view=settings');
  const local = createAttempt(poc, '2026-10-03T10:00:00.000Z'),
    prefs = { ...defaultUiPreferences, theme: 'light' };
  await seed(page, [
    [storageKey(poc), storageFixtureJson({ storageVersion: 2, current: local })],
    [uiPreferencesKey, storageFixtureJson(prefs)],
  ]);
  const incoming = inputBackup();
  const completed = transition(poc, incoming.exams[0]!.current!, {
    type: 'finish',
    now: '2026-10-03T11:00:00.000Z',
  });
  incoming.exams[0]!.current = completed;
  incoming.exams[0]!.history.push(summary(completed));
  const before = await snapshot(page);
  await selectFile(page, incoming);
  await expect(page.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
  await expect(page.getByText(/Tentativa atual local preservada por conflito/)).toBeVisible();
  await expect(
    page.getByRole('checkbox', {
      name: 'Aplicar preferências de aparência e acessibilidade do backup',
    }),
  ).not.toBeChecked();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByRole('status')).toContainText('1 conflitos preservados');
  const after = await snapshot(page);
  expect(after[storageKey(poc)]).toBe(before[storageKey(poc)]);
  expect(after[uiPreferencesKey]).toBe(before[uiPreferencesKey]);
  expect(JSON.parse(after[historyStorageKey(poc)]!).history).toHaveLength(1);
  expect(after[catalogPreferencesKey]).toContain(poc.id);
});

test('7A.2: corrupção, adulteração, desconhecidos e tamanho são reportados sem writes', async ({
  page,
}) => {
  await page.goto('?view=settings');
  await seed(page, [
    [storageKey(poc), '{bad-current'],
    [uiPreferencesKey, '{bad-prefs'],
  ]);
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Exportar progresso' }).click();
  await expect(page.getByRole('alert')).toContainText(poc.title);
  expect(await snapshot(page)).toEqual(before);
  await selectFile(page, { ...inputBackup(), unknown: true });
  await expect(page.getByRole('alert')).toContainText('Backup inválido');
  const input = inputBackup();
  input.exams[0]!.current!.answers = { absent: '1' };
  await selectFile(page, input);
  await expect(page.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
  await expect(page.getByText(/item importado incompatível rejeitado/)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Cancelar' }).click();
  const unknown = inputBackup();
  unknown.exams[0]!.examId = 'fake-exam';
  await selectFile(page, unknown);
  await expect(page.getByText(/Prova desconhecida rejeitada/)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.getByLabel('Importar progresso', { exact: true }).setInputFiles({
    name: 'large.json',
    mimeType: 'application/json',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 'a'),
  });
  await expect(page.getByRole('alert')).toContainText('10 MiB');
  expect(await snapshot(page)).toEqual(before);
});

test('7A.2: alteração depois de preview aborta e falha de escrita reverte sem falso sucesso', async ({
  page,
}) => {
  await page.goto('?view=settings');
  await selectFile(page, inputBackup());
  await expect(page.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
  await page.evaluate((key) => localStorage.setItem(key, 'changed'), storageKey(poc));
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByRole('alert')).toContainText('concorrência');
  expect((await snapshot(page))[storageKey(poc)]).toBe('changed');
  await page.evaluate((key) => localStorage.removeItem(key), storageKey(poc));
  await selectFile(page, inputBackup());
  await expect(page.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, value) {
      if (k === key) throw new DOMException('quota', 'QuotaExceededError');
      original.call(this, k, value);
    };
  }, catalogPreferencesKey);
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByRole('alert')).toContainText('foram restauradas');
  expect(await snapshot(page)).toEqual({});
  await expect(page.getByText(/Importação concluída/)).toHaveCount(0);
});

test('7A.2: importação de history v2 ao lado de current v1 sobrevive a abrir e salvar prova', async ({
  page,
}) => {
  await page.goto('?view=settings');
  const current = createAttempt(poc, '2026-10-03T10:00:00.000Z');
  const past = transition(
    poc,
    { ...current, id: 'local-old' },
    { type: 'finish', now: '2026-10-03T11:00:00.000Z' },
  );
  const raw = storageFixtureJson({ storageVersion: 1, current, history: [past] });
  await seed(page, [[storageKey(poc), raw]]);
  const incoming = inputBackup();
  incoming.exams[0]!.current = transition(
    poc,
    { ...current, id: 'imported' },
    { type: 'finish', now: '2026-10-03T12:00:00.000Z' },
  );
  await selectFile(page, incoming);
  await expect(page.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByRole('status')).toContainText('Importação concluída');
  expect((await snapshot(page))[storageKey(poc)]).toBe(raw);
  await page.goto(`?exam=${poc.id}`);
  await chooseExam(page);
  await expect(page.getByText('✓ Tentativa restaurada neste navegador.')).toBeVisible();
  expect((await snapshot(page))[storageKey(poc)]).toBe(raw);
  await page.getByRole('button', { name: 'Próxima →' }).click();
  expect(JSON.parse((await snapshot(page))[historyStorageKey(poc)]!).history).toHaveLength(2);
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização' }).click();
  await page.getByText('Histórico local · 3 tentativa(s)').click();
  await expect(page.locator('.history li')).toHaveCount(3);
});

test('7A.2: backup apenas com histórico é mantido ao abrir e concluir uma nova tentativa', async ({
  page,
}) => {
  const check = monitor(page);
  await page.goto('?view=settings');
  const input = inputBackup();
  input.exams[0]!.history = [
    summary(
      transition(poc, input.exams[0]!.current!, {
        type: 'finish',
        now: '2026-10-03T11:00:00.000Z',
      }),
    ),
  ];
  input.exams[0]!.current = null;
  await selectFile(page, input);
  await expect(page.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
  expect(await snapshot(page)).toEqual({});
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByRole('status')).toContainText('Importação concluída');
  expect((await snapshot(page))[storageKey(poc)]).toBeUndefined();
  await page.goto(`?exam=${poc.id}`);
  await chooseExam(page);
  await expect(page.getByRole('heading', { name: 'Questão 1 de 30', exact: true })).toBeVisible();
  expect(JSON.parse((await snapshot(page))[historyStorageKey(poc)]!).history).toHaveLength(1);
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização' }).click();
  await page.getByText('Histórico local · 2 tentativa(s)').click();
  await expect(page.locator('.history li')).toHaveCount(2);
  check();
});

test('F1: import/load/restart/save preservam as 20 conclusões posteriores e melhor 100%', async ({
  page,
}) => {
  await page.goto('?view=settings');
  const old = transition(
    poc,
    { ...createAttempt(poc, '2026-10-01T10:00:00.000Z'), id: 'old-current' },
    {
      type: 'finish',
      now: '2026-10-01T11:00:00.000Z',
    },
  );
  const correctAnswers = Object.fromEntries(
    poc.questions.flatMap((q) => (q.type === 'multiple-choice' ? [[q.id, q.correctAnswer]] : [])),
  );
  const history = Array.from({ length: 20 }, (_, i) =>
    summary(
      transition(
        poc,
        {
          ...createAttempt(poc, '2026-10-02T10:00:00.000Z'),
          id: `recent-${i}`,
          answers: i === 0 ? correctAnswers : {},
        },
        { type: 'finish', now: `2026-10-03T10:${String(i).padStart(2, '0')}:00.000Z` },
      ),
    ),
  );
  const input = inputBackup(old);
  input.exams[0]!.history = history;
  input.catalogPreferences.favorites = [];
  input.uiPreferences = null;
  await selectFile(page, input);
  await expect(page.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
  expect(await snapshot(page)).toEqual({});
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  const expected = [...history].reverse();
  const checkHistory = async () =>
    expect(JSON.parse((await snapshot(page))[historyStorageKey(poc)]!).history).toEqual(expected);
  await checkHistory();
  await page.goto('?view=dashboard');
  await expect(metric(page, 'Melhor resultado')).toHaveText('100%');
  await page.getByRole('link', { name: poc.title, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeVisible();
  await page.getByText('Histórico local · 20 tentativa(s)').click();
  await expect(page.locator('.history li')).toHaveCount(20);
  await checkHistory();
  await page.getByRole('button', { name: 'Nova tentativa' }).click();
  await chooseExam(page);
  await page.getByRole('button', { name: 'Próxima →' }).click();
  await checkHistory();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Questão 2 de 30', exact: true })).toBeVisible();
  await checkHistory();
  await page.locator('.app-nav').getByRole('link', { name: 'Dashboard' }).click();
  await expect(metric(page, 'Melhor resultado')).toHaveText('100%');
});

test('F2: preview sinaliza colisão com current aberto e export continua válido após finalizar', async ({
  page,
}) => {
  await page.goto('?view=settings');
  const current = { ...createAttempt(poc, '2026-10-01T10:00:00.000Z'), id: 'collision' };
  const raw = storageFixtureJson({ storageVersion: 2, current });
  await seed(page, [[storageKey(poc), raw]]);
  const objective = poc.questions.filter((q) => q.type === 'multiple-choice');
  const historyCurrent = {
    ...current,
    answers: Object.fromEntries(
      objective
        .slice(0, objective.length / 2)
        .flatMap((q) => (q.type === 'multiple-choice' ? [[q.id, q.correctAnswer]] : [])),
    ),
  };
  const incoming = inputBackup();
  incoming.exams[0]!.current = null;
  incoming.exams[0]!.history = [
    summary(transition(poc, historyCurrent, { type: 'finish', now: '2026-10-01T11:00:00.000Z' })),
  ];
  const before = await snapshot(page);
  await selectFile(page, incoming);
  await expect(page.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
  await expect(
    page.getByText('Histórico collision: tentativa atual preservada por conflito.', {
      exact: false,
    }),
  ).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByRole('status')).toContainText('1 conflitos preservados');
  const after = await snapshot(page);
  expect(after[storageKey(poc)]).toBe(raw);
  expect(after[historyStorageKey(poc)]).toBeUndefined();
  expect(JSON.parse(after[catalogPreferencesKey]!).favorites).toEqual([poc.id]);
  expect(JSON.parse(after[uiPreferencesKey]!)).toEqual(incoming.uiPreferences);
  await page.goto(`?exam=${poc.id}`);
  await chooseExam(page);
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização' }).click();
  await page.getByRole('button', { name: 'Nova tentativa' }).click();
  await chooseExam(page);
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização' }).click();
  await page.locator('.app-nav').getByRole('link', { name: 'Configurações' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar progresso' }).click();
  const path = await (await downloadPromise).path();
  if (!path) throw new Error('Download ausente');
  const exported = JSON.parse(readFileSync(path, 'utf8')) as Backup;
  expect(exported.exams[0]!.history).toHaveLength(2);
  expect(exported.exams[0]!.history.filter((item) => item.id === 'collision')).toMatchObject([
    { result: { percentage: 0 } },
  ]);
});

for (const width of [1024, 1280, 390, 375]) {
  test(`F3: mapa 44x44, sem overflow e com foco real em ${width}px`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const measurements: {
      textSize: string;
      density: string;
      minWidth: number;
      minHeight: number;
    }[] = [];
    for (const textSize of ['normal', 'medium', 'large']) {
      for (const density of ['comfortable', 'compact']) {
        await page.goto('?view=settings');
        await page.getByLabel('Tamanho do texto').selectOption(textSize);
        await page.getByLabel('Densidade').selectOption(density);
        await page.goto(`?exam=${poc.id}`);
        await chooseExam(page);
        const buttons = page.locator('.question-number');
        await expect(buttons).toHaveCount(30);
        const boxes = await buttons.evaluateAll((elements) =>
          elements.map((element) => {
            const { width, height } = element.getBoundingClientRect();
            return { width, height };
          }),
        );
        for (const box of boxes) {
          expect(box.width, `${width}/${textSize}/${density}`).toBeGreaterThanOrEqual(44);
          expect(box.height, `${width}/${textSize}/${density}`).toBeGreaterThanOrEqual(44);
        }
        measurements.push({
          textSize,
          density,
          minWidth: Math.min(...boxes.map((b) => b.width)),
          minHeight: Math.min(...boxes.map((b) => b.height)),
        });
        await noOverflow(page);
        await page.getByRole('button', { name: 'Ir para questão 2', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Questão 2 de 30', exact: true }),
        ).toBeVisible();
      }
    }
    await info.attach(`question-map-${width}-measurements`, {
      body: storageFixtureJson(measurements, null, 2),
      contentType: 'application/json',
    });
    const currentButton = page.getByRole('button', { name: 'Ir para questão 2', exact: true });
    await focusProof(page, currentButton);
    await page.goto('?view=settings');
    await page.getByLabel('Contraste').selectOption('high');
    await page.getByRole('checkbox', { name: /Indicador de foco reforçado/ }).check();
    await page.goto(`?exam=${poc.id}`);
    await chooseExam(page);
    const enhanced = page.getByRole('button', { name: 'Ir para questão 2', exact: true });
    await focusProof(page, enhanced);
    expect(await enhanced.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe(
      '5px',
    );
    await noOverflow(page);
  });
}
