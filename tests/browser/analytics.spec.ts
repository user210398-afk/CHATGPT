import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseExam } from '../../schema/exam';
import type { Exam } from '../../src/types/exam';
import { createAttempt, transition } from '../../src/engine/exam-state';
import { historyStorageKey, storageKey, summary } from '../../src/engine/persistence';
import { defaultUiPreferences, uiPreferencesKey } from '../../src/engine/ui-preferences';
import { readExamCatalog } from '../../scripts/catalog';
const now = Date.parse('2026-10-07T12:00:00.000Z');
const exam = parseExam(
  JSON.parse(readFileSync('data/exams/fisiologia-m5-aula-1-2026.json', 'utf8')),
);
const visualDirectory = '/tmp/medsim-analytics-visual';
mkdirSync(visualDirectory, { recursive: true });
function officialAttempt(
  input: Exam,
  i: number,
  mode: 'exam' | 'study' = 'exam',
  at = now - i * 86_400_000,
) {
  let attempt = createAttempt(input, new Date(at - 60_000).toISOString(), `analytics-${i}`, mode);
  for (const question of input.questions.slice(0, (i % input.questions.length) + 1)) {
    attempt = transition(input, attempt, {
      type: 'answer',
      questionId: question.id,
      value: question.type === 'multiple-choice' ? question.correctAnswer : 'Resposta de estudo',
    });
    if (mode === 'study')
      attempt = transition(input, attempt, { type: 'confirm-answer', questionId: question.id });
  }
  return transition(input, attempt, { type: 'finish', now: new Date(at).toISOString() });
}
function history(count = 8, input = exam): [string, string] {
  return [
    historyStorageKey(input),
    JSON.stringify({
      storageVersion: 3,
      history: Array.from({ length: count }, (_, i) =>
        summary(officialAttempt(input, i, i % 2 ? 'study' : 'exam')),
      ),
    }),
  ];
}
async function setup(page: Page, entries: [string, string][] = [], prefs = {}) {
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/generated\/exams\//.test(request.url())) requests.push(request.url());
  });
  await page.addInitScript(
    ({ entries, now }) => {
      Date.now = () => now;
      for (const [key, value] of entries) localStorage.setItem(key, value);
      const before = {
        local: Object.fromEntries(Object.entries(localStorage)),
        session: Object.fromEntries(Object.entries(sessionStorage)),
      };
      const writes: string[] = [],
        set = Storage.prototype.setItem,
        remove = Storage.prototype.removeItem;
      Object.assign(window, { analyticsWrites: writes, analyticsBefore: before });
      Storage.prototype.setItem = function (key, value) {
        writes.push(`set:${key}`);
        return set.call(this, key, value);
      };
      Storage.prototype.removeItem = function (key) {
        writes.push(`remove:${key}`);
        return remove.call(this, key);
      };
    },
    {
      entries: [
        [
          uiPreferencesKey,
          JSON.stringify({
            ...defaultUiPreferences,
            theme: 'light',
            setupPrompt: 'dismissed',
            ...prefs,
          }),
        ],
        ...entries,
      ] as [string, string][],
      now,
    },
  );
  await page.goto('?view=dashboard');
  await expect(page.getByRole('heading', { name: 'Meu desempenho' })).toBeVisible();
  return async () => {
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as { analyticsWrites: string[] }).analyticsWrites,
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(() => ({
        local: Object.fromEntries(Object.entries(localStorage)),
        session: Object.fromEntries(Object.entries(sessionStorage)),
      })),
    ).toEqual(
      await page.evaluate(
        () => (window as unknown as { analyticsBefore: unknown }).analyticsBefore,
      ),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  };
}
async function screenshot(page: Page, name: string, project: string) {
  const bounds = await page.locator('.analytics-evolution').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  });
  await page.screenshot({ path: `${visualDirectory}/${project}-${name}.png`, fullPage: true });
  // Keep the unmodified full-page image and bounds for inspection of actual pixels.
  writeFileSync(`${visualDirectory}/${project}-${name}-bounds.json`, JSON.stringify(bounds));
}
test('Analytics vazio: hierarquia, controles locais e nenhuma falsa nota', async ({
  page,
}, info) => {
  const check = await setup(page);
  await expect(page.getByRole('heading', { name: 'Panorama geral' })).toBeVisible();
  await expect(page.getByText('Nenhum resultado com nota automática neste recorte.')).toBeVisible();
  await expect(page.locator('.analytics-summary div').last().locator('dd')).toHaveText('—');
  await expect(page.getByText('Dados insuficientes para avaliar tendência')).toBeVisible();
  await screenshot(page, 'empty', info.project.name);
  await check();
});
test('Analytics com um resultado: seleção touch/mouse, foco e dados equivalentes', async ({
  page,
}, info) => {
  const check = await setup(page, [history(1)]);
  const point = page.locator('.performance-point');
  await expect(point).toHaveCount(1);
  if (info.project.name === 'mobile') await point.tap();
  else await point.hover();
  await expect(page.locator('.chart-selection')).toContainText(exam.title);
  await point.focus();
  await expect(point).toBeFocused();
  await page.getByText('Ver dados do gráfico').click();
  await expect(page.getByRole('table')).toContainText(exam.title);
  await screenshot(page, 'single-result', info.project.name);
  await check();
});
test('Analytics misto: filtros combinados, teclado, limpar e Panorama global', async ({
  page,
}, info) => {
  const check = await setup(page, [history()]);
  const overview = await page.locator('.metrics-grid').textContent();
  await page.getByRole('button', { name: 'Últimos 7 dias', exact: true }).click();
  await page.getByRole('button', { name: 'Estudo', exact: true }).click();
  await page.getByLabel('Disciplina', { exact: true }).selectOption(exam.subject);
  await expect(page.getByRole('button', { name: 'Estudo', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.chart-selection')).toContainText('Modo Estudo');
  await expect(page.getByLabel('Resultado selecionado').locator('option')).toHaveCount(4);
  await page.locator('.performance-point[tabindex="0"]').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.performance-point').first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.performance-point').nth(1)).toBeFocused();
  expect(
    await page
      .locator('.performance-point')
      .nth(1)
      .evaluate((node) => node.matches(':focus-visible')),
  ).toBe(true);
  expect(
    await page
      .locator('.performance-point')
      .nth(1)
      .evaluate((node) => getComputedStyle(node).outlineStyle),
  ).toBe('solid');
  await page.getByText('Ver dados do gráfico').click();
  await expect(page.getByRole('row')).toHaveCount(5);
  await page.getByRole('button', { name: new RegExp(`^Filtrar ${exam.subject}`) }).click();
  expect(await page.locator('.metrics-grid').textContent()).toBe(overview);
  expect(new URL(page.url()).search).toBe('?view=dashboard');
  await screenshot(page, 'filters-active', info.project.name);
  await page.getByLabel('Disciplina', { exact: true }).selectOption('Farmacologia');
  await expect(page.getByText('Nenhum resultado com nota automática neste recorte.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByRole('button', { name: 'Limpar filtros' })).toHaveCount(0);
  await expect(page.getByLabel('Resultado selecionado').locator('option')).toHaveCount(8);
  await check();
});
test('Analytics partial warning mantém history válido e raws intactos', async ({ page }, info) => {
  const check = await setup(page, [history(4), [storageKey(exam), '{bad']]);
  await expect(page.getByText('Cobertura parcial')).toBeVisible();
  await expect(page.locator('.performance-point')).toHaveCount(4);
  await screenshot(page, 'partial-warning', info.project.name);
  await check();
});
test('Analytics storage bloqueado mostra indisponibilidade, sem zeros analíticos', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
  });
  await page.goto('?view=dashboard');
  await expect(page.getByText(/Analytics indisponível/)).toContainText('Resultados: —');
  await expect(page.locator('.performance-point')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Leituras do seu desempenho' })).toHaveCount(0);
});
for (const variant of [
  { width: 375, theme: 'light', contrast: 'standard' },
  { width: 375, theme: 'dark', contrast: 'standard' },
  { width: 390, theme: 'light', contrast: 'high' },
  { width: 390, theme: 'dark', contrast: 'high' },
  { width: 768, theme: 'light', contrast: 'standard' },
  { width: 1024, theme: 'light', contrast: 'standard' },
  { width: 1280, theme: 'dark', contrast: 'standard' },
]) {
  test(`Analytics visual ${variant.width} ${variant.theme} ${variant.contrast}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: variant.width, height: 900 });
    const check = await setup(page, [history()], {
      theme: variant.theme,
      contrast: variant.contrast,
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
    await expect(page.locator('html')).toHaveAttribute('data-contrast', variant.contrast);
    expect(
      await page
        .locator('.performance-point')
        .first()
        .evaluate((node) => node.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(44);
    const bar = await page.locator('.subject-performance-bar').first().boundingBox();
    const track = await page.locator('.subject-bar-track').first().boundingBox();
    expect(track!.width).toBeGreaterThanOrEqual(bar!.width - 1);
    await screenshot(
      page,
      `${variant.width}-${variant.theme}-${variant.contrast}`,
      info.project.name,
    );
    await check();
  });
}
test('Analytics texto grande e densidade compacta a 375 sem overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const check = await setup(page, [history()], {
    textSize: 'large',
    density: 'compact',
    contrast: 'high',
    theme: 'dark',
  });
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'large');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await page.getByLabel('Disciplina', { exact: true }).selectOption(exam.subject);
  await screenshot(page, 'large-text-compact', info.project.name);
  await check();
});
test('Analytics perto do limite: 20 resultados oficiais por prova, todos acessíveis sem overflow', async ({
  page,
}, info) => {
  const { catalog } = await readExamCatalog();
  const entries = catalog.exams.map((item) => {
    const input = parseExam(JSON.parse(readFileSync(`data/exams/${item.id}.json`, 'utf8')));
    return history(20, input);
  });
  const check = await setup(page, entries);
  const scoredCount = catalog.exams.filter((item) => item.objectiveCount > 0).length * 20;
  await expect(page.locator('.performance-point')).toHaveCount(scoredCount);
  await expect(page.locator('.analytics-summary div').first().locator('dd')).toHaveText(
    String(entries.length * 20),
  );
  await expect(page.getByLabel('Resultado selecionado').locator('option')).toHaveCount(scoredCount);
  await page.getByLabel('Resultado selecionado').selectOption('0');
  await page.getByRole('button', { name: 'Próximo resultado', exact: true }).click();
  await page.getByText('Ver dados do gráfico').click();
  await expect(page.getByRole('row')).toHaveCount(scoredCount + 1);
  await page.getByText('Ver dados do gráfico').click();
  await screenshot(page, 'many-results', info.project.name);
  await check();
});
test('Backup refinado e History danger zone mantêm preview, foco e literal ZERAR', async ({
  page,
}, info) => {
  const check = await setup(page, [history(2)]);
  await expect(page.getByRole('heading', { name: 'Guardar uma cópia' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Restaurar uma cópia' })).toBeVisible();
  await expect(page.getByLabel('Importar progresso')).toHaveAttribute('type', 'file');
  await page
    .locator('.backup-controls')
    .screenshot({ path: `${visualDirectory}/${info.project.name}-backup.png` });
  await page.getByRole('button', { name: 'Zerar histórico e estatísticas' }).click();
  const heading = page.getByRole('heading', { name: 'Confirmar remoção do histórico' });
  await expect(heading).toBeFocused();
  const confirm = page.getByRole('button', { name: 'Confirmar reset do histórico' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Digite ZERAR para confirmar').fill('zerar');
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Digite ZERAR para confirmar').fill('ZERAR');
  await expect(confirm).toBeEnabled();
  await page
    .locator('.history-reset')
    .screenshot({ path: `${visualDirectory}/${info.project.name}-history-danger.png` });
  await page.getByRole('button', { name: 'Cancelar reset' }).click();
  await expect(page.getByRole('button', { name: 'Zerar histórico e estatísticas' })).toBeFocused();
  await check();
});

test('Analytics essay-only: null contribui ao ritmo e não vira ponto ou média 0%', async ({
  page,
}, info) => {
  const { catalog } = await readExamCatalog();
  const item = catalog.exams.find((item) => item.objectiveCount === 0)!;
  const input = parseExam(JSON.parse(readFileSync(`data/exams/${item.id}.json`, 'utf8')));
  const completion = officialAttempt(input, 0, 'study');
  const check = await setup(page, [
    [
      historyStorageKey(input),
      JSON.stringify({ storageVersion: 3, history: [summary(completion)] }),
    ],
  ]);
  await expect(page.locator('.performance-point')).toHaveCount(0);
  await expect(page.locator('.analytics-summary div').first().locator('dd')).toHaveText('1');
  await expect(page.locator('.analytics-summary div').last().locator('dd')).toHaveText('—');
  await expect(page.getByText('0 Prova · 1 Estudo')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Filtrar Fisiologia: sem nota automática/ }),
  ).toContainText('—');
  await screenshot(page, 'essay-only', info.project.name);
  await check();
});

for (const textSize of ['medium', 'large']) {
  test(`Analytics texto ${textSize} com densidade confortável`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const check = await setup(page, [history()], { textSize, density: 'comfortable' });
    await expect(page.locator('html')).toHaveAttribute('data-text-size', textSize);
    await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
    await screenshot(page, `text-${textSize}-comfortable`, info.project.name);
    await check();
  });
}
