import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseExam } from '../../schema/exam';
import { storageKey, historyStorageKey, summary } from '../../src/engine/persistence';
import { reviewStorageKey } from '../../src/engine/review-history';
import { calculateResult, createAttempt, transition } from '../../src/engine/exam-state';
import type { Exam } from '../../src/types/exam';
import { defaultUiPreferences, uiPreferencesKey } from '../../src/engine/ui-preferences';
import { storageFixtureJson } from '../legacy-fixtures';

const exam = parseExam(
  JSON.parse(readFileSync('data/exams/fisiologia-m5-aula-1-2026.json', 'utf8')),
);
function notebookAttempt(
  outcome: 'incorrect' | 'correct' | 'unanswered',
  id: string,
  day: number,
  mode: 'exam' | 'study',
  input: Exam,
) {
  const date = `2026-10-${String(day).padStart(2, '0')}`;
  let value = createAttempt(input, `${date}T10:00:00.000Z`, id, mode);
  const q = input.questions[0]!;
  if (q.type !== 'multiple-choice') throw new Error('fixture');
  if (outcome !== 'unanswered') {
    value = transition(input, value, {
      type: 'answer',
      questionId: q.id,
      value:
        outcome === 'correct'
          ? q.correctAnswer
          : q.options.find((o) => o.id !== q.correctAnswer)!.id,
    });
    if (mode === 'study')
      value = transition(input, value, { type: 'confirm-answer', questionId: q.id });
  }
  return transition(input, value, { type: 'finish', now: `${date}T11:00:00.000Z` });
}
const attempt = (outcome: 'incorrect' | 'correct' | 'unanswered', id = 'one', day = 1) =>
  notebookAttempt(outcome, id, day, 'exam', exam);
const archived = (attempts = [attempt('incorrect')]): [string, string] => [
  reviewStorageKey(exam),
  JSON.stringify({ storageVersion: 1, attempts }),
];
const prefs = (theme = 'light', contrast = 'standard', textSize = 'normal'): [string, string] => [
  uiPreferencesKey,
  JSON.stringify({ ...defaultUiPreferences, theme, contrast, textSize, setupPrompt: 'dismissed' }),
];
async function setup(page: Page, entries: [string, string][] = []) {
  await page.goto('?view=review');
  await page.getByRole('heading', { name: 'Revisão', exact: true }).waitFor();
  await page.evaluate(
    (entries) => {
      for (const [key, value] of entries) localStorage.setItem(key, value);
    },
    [prefs(), ...entries],
  );
  const before = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.assign(window, { notebookWrites: writes });
    const set = Storage.prototype.setItem,
      remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) {
      writes.push(`set:${this === localStorage ? 'local' : 'session'}:${key}`);
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      writes.push(`remove:${this === localStorage ? 'local' : 'session'}:${key}`);
      return remove.call(this, key);
    };
  });
  const requests: string[] = [],
    errors: string[] = [];
  page.on('request', (r) => {
    if (/generated\/exams\//.test(r.url())) requests.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const check = async () => {
    expect(
      await page.evaluate(() => (window as unknown as { notebookWrites: string[] }).notebookWrites),
    ).toEqual([]);
    expect(
      await page.evaluate(() => ({
        local: Object.fromEntries(Object.entries(localStorage)),
        session: Object.fromEntries(Object.entries(sessionStorage)),
      })),
    ).toEqual(before);
    expect(errors).toEqual([]);
  };
  return { requests, check };
}
async function open(page: Page) {
  await page.goto('?view=error-notebook');
  await expect(page.getByRole('heading', { name: 'Caderno de Erros', exact: true })).toBeVisible();
  await expect(page.getByText('Carregando análise…', { exact: true })).toHaveCount(0);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
test('notebook: zero history/navigation/reload/back/forward are zero-write and zero Exams', async ({
  page,
}) => {
  const { requests, check } = await setup(page);
  await open(page);
  await expect(page.getByText('Nenhuma tentativa detalhada disponível ainda.')).toBeVisible();
  await page.screenshot({
    path: `/tmp/medsim-notebook-zero-history-${test.info().project.name}.png`,
    fullPage: true,
  });
  await expect(page.getByRole('link', { name: 'Erros', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await check();
  await page.reload();
  await expect(page.getByText('Nenhuma tentativa detalhada disponível ainda.')).toBeVisible();
  await check();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meu desempenho' })).toBeVisible();
  await check();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Caderno de Erros', exact: true })).toBeVisible();
  await check();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Meu desempenho' })).toBeVisible();
  await check();
  await page.getByRole('link', { name: 'Erros', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nenhuma tentativa detalhada disponível ainda.')).toBeVisible();
  await check();
  expect(requests).toEqual([]);
  await noOverflow(page);
});
test('notebook: one candidate, keyboard filters, counts, details and no gabarito', async ({
  page,
}) => {
  const { requests, check } = await setup(page, [
    archived([
      attempt('incorrect'),
      attempt('incorrect', 'two', 2),
      attempt('correct', 'three', 3),
    ]),
  ]);
  await open(page);
  const card = page.locator('.notebook-question');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('2 erros em 3 respostas');
  await expect(card).toContainText('Último resultado respondido: Correto');
  await expect(card.locator('.notebook-tags')).toContainText('Recorrente');
  await expect(card.locator('.notebook-tags')).toContainText('Superada');
  await expect(page.locator('.notebook-summary dd')).toHaveText(['1', '0', '1', '0', '1']);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain(`${exam.id}.json`);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.locator('.feedback')).toHaveCount(0);
  await expect(card).not.toContainText('Resposta correta');
  const q = exam.questions[0]!;
  if (q.type !== 'multiple-choice') throw new Error('fixture');
  for (const option of q.options) {
    const text = option.text
      .filter((n) => n.type === 'text')
      .map((n) => n.text)
      .join('');
    if (text.trim()) await expect(card).not.toContainText(text);
  }
  await page.getByRole('button', { name: 'Pendentes', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nenhuma questão corresponde aos filtros atuais.')).toBeVisible();
  await page.getByRole('button', { name: 'Superadas', exact: true }).click();
  await expect(card).toHaveCount(1);
  await page.getByLabel('Matéria', { exact: true }).selectOption(exam.subject);
  await page.getByLabel('Prova', { exact: true }).selectOption(exam.id);
  await expect(card).toHaveCount(1);
  const detail = page.getByText('Ver tentativas disponíveis (3)');
  await detail.focus();
  await page.keyboard.press('Enter');
  await expect(card.locator('details')).toHaveAttribute('open', '');
  await expect(card.locator('details li')).toHaveCount(3);
  await page.keyboard.press('Enter');
  await expect(card.locator('details')).not.toHaveAttribute('open', '');
  await check();
  expect(requests).toHaveLength(1);
  await noOverflow(page);
});
test('notebook: zero errors has distinct empty state', async ({ page }) => {
  const { check } = await setup(page, [archived([attempt('correct')])]);
  await open(page);
  await expect(
    page.getByText('Nenhum erro objetivo foi encontrado nas tentativas detalhadas disponíveis.'),
  ).toBeVisible();
  await expect(page.getByText('Nenhuma tentativa detalhada disponível ainda.')).toHaveCount(0);
  await check();
  await page.screenshot({
    path: `/tmp/medsim-notebook-zero-errors-${test.info().project.name}.png`,
    fullPage: true,
  });
});
for (const kind of ['duplicate-flags', 'index-out-of-range'] as const)
  test(`pre-staging P2: valid same-ID archive survives current ${kind} with zero writes`, async ({
    page,
  }) => {
    const valid = attempt('incorrect', 'same'),
      invalid = {
        ...valid,
        flagged: kind === 'duplicate-flags' ? [exam.questions[0]!.id, exam.questions[0]!.id] : [],
        currentIndex: kind === 'index-out-of-range' ? exam.questions.length : 0,
      };
    const { requests, check } = await setup(page, [
      [storageKey(exam), JSON.stringify({ storageVersion: 3, current: invalid })],
      archived([valid]),
    ]);
    await open(page);
    const card = page.locator('.notebook-question');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('1 erro em 1 resposta');
    await expect(page.locator('.notebook-summary dd')).toHaveText(['1', '1', '0', '1', '0']);
    await expect(page.locator('.notebook-coverage')).toContainText('representação detalhada');
    await expect(page.locator('.notebook-coverage')).toContainText('cobertura é parcial');
    expect(requests).toHaveLength(1);
    await check();
    await noOverflow(page);
  });
for (const kind of ['older-tie', 'latest-divergent-tie'] as const)
  test(`pre-staging P3: ${kind} has the appropriate last-result label with zero writes`, async ({
    page,
  }) => {
    const { check } = await setup(page, [
      archived(
        kind === 'older-tie'
          ? [attempt('incorrect', 'a'), attempt('correct', 'Z'), attempt('correct', 'latest', 5)]
          : [attempt('incorrect', 'a', 5), attempt('correct', 'Z', 5)],
      ),
    ]);
    await open(page);
    const card = page.locator('.notebook-question');
    await expect(card).toHaveCount(1);
    if (kind === 'older-tie') {
      await expect(card).toContainText('Último resultado respondido: Correto');
      await expect(card).not.toContainText('Resultado no desempate por ID');
      await expect(card).not.toContainText('não comprovam uma sequência temporal');
    } else {
      await expect(card).toContainText('Resultado no desempate por ID: Incorreto');
      await expect(card).toContainText('não comprovam uma sequência temporal entre essas tentativas');
      await expect(card).not.toContainText('Último resultado respondido');
    }
    await check();
    await noOverflow(page);
  });
test('notebook: corruption and independent archive warn, preserve raw and do not hide valid errors', async ({
  page,
}) => {
  const { check } = await setup(page, [[storageKey(exam), '{invalid JSON preserved'], archived()]);
  await open(page);
  await expect(page.locator('.notebook-question')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Cobertura do histórico' })).toBeVisible();
  await expect(page.locator('.notebook-coverage')).toContainText('corrompida');
  await check();
  await page.screenshot({
    path: `/tmp/medsim-notebook-partial-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test('notebook: v1 embedded + summary retention, without inaccessible review links', async ({
  page,
}) => {
  const raw = storageFixtureJson({
    storageVersion: 1,
    current: attempt('correct', 'current', 2),
    history: [attempt('incorrect', 'embedded')],
  });
  const { check } = await setup(page, [
    [storageKey(exam), raw],
    [
      historyStorageKey(exam),
      JSON.stringify({
        storageVersion: 3,
        history: [summary(attempt('incorrect', 'summary-only'))],
      }),
    ],
  ]);
  await open(page);
  await expect(page.locator('.notebook-question')).toContainText('1 erro em 2 respostas');
  await expect(page.locator('.notebook-coverage')).toContainText('apenas como resumos');
  await expect(page.locator('a[href*="attempt=embedded"]')).toHaveCount(0);
  await check();
});
test('notebook: summaries and old/removed revisions do not load current content', async ({
  page,
}) => {
  const old = { ...exam, revision: exam.revision + 1 },
    removed = { ...exam, id: 'removed-exam' };
  const { requests, check } = await setup(page, [
    [
      historyStorageKey(exam),
      JSON.stringify({ storageVersion: 3, history: [summary(attempt('incorrect'))] }),
    ],
    [
      storageKey(old),
      JSON.stringify({
        storageVersion: 3,
        current: notebookAttempt('incorrect', 'old', 1, 'exam', old),
      }),
    ],
    [
      storageKey(removed),
      JSON.stringify({
        storageVersion: 3,
        current: notebookAttempt('incorrect', 'removed', 1, 'exam', removed),
      }),
    ],
    [`${storageKey(exam)}:annotations`, '{hostile personal raw}'],
  ]);
  await open(page);
  await expect(
    page.getByText('Há registros que não podem ser analisados por questão.'),
  ).toBeVisible();
  await expect(page.locator('.notebook-coverage')).toContainText('removed-exam');
  await expect(
    page.getByRole('heading', { name: 'Versões históricas sem conteúdo disponível' }),
  ).toBeVisible();
  await expect(page.locator('.notebook-question')).toHaveCount(0);
  expect(requests).toEqual([]);
  await check();
});
test('notebook: pageshow/storage refresh and reset reflect actual raw with zero notebook writes', async ({
  page,
  context,
}) => {
  const { check } = await setup(page, [archived()]);
  await open(page);
  await expect(page.locator('.notebook-question')).toHaveCount(1);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.getByText('Atualizando análise…', { exact: false })).toHaveCount(0);
  await expect(page.locator('.notebook-question')).toHaveCount(1);
  await check();
  const writer = await context.newPage();
  await writer.goto('?view=review');
  await writer.evaluate(
    ([key, raw]) => localStorage.setItem(key!, raw!),
    archived([attempt('incorrect'), attempt('correct', 'new', 2)]),
  );
  await expect(page.locator('.notebook-question')).toContainText('1 erro em 2 respostas');
  // The external writer owns these explicit storage changes; the reader must never write.
  expect(
    await page.evaluate(() => (window as unknown as { notebookWrites: string[] }).notebookWrites),
  ).toEqual([]);
  await writer.evaluate((key) => localStorage.removeItem(key), reviewStorageKey(exam));
  await expect(page.getByText('Nenhuma tentativa detalhada disponível ainda.')).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { notebookWrites: string[] }).notebookWrites),
  ).toEqual([]);
  await writer.close();
});
test('notebook: rapid navigation aborts fetch and leaves all domains intact', async ({ page }) => {
  const { check } = await setup(page, [archived()]);
  let fetched!: () => void;
  const requested = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  await page.route(`**/generated/exams/${exam.id}.json`, async (route) => {
    fetched();
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    try {
      await route.continue();
    } catch {
      /* Document navigation aborted this GET. */
    }
  });
  await page.goto('?view=error-notebook');
  await requested;
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meu desempenho' })).toBeVisible();
  await check();
});
for (const [width, theme, contrast] of [
  [375, 'light', 'standard'],
  [375, 'dark', 'standard'],
  [390, 'light', 'high'],
  [390, 'dark', 'high'],
  [768, 'light', 'standard'],
  [1024, 'light', 'standard'],
  [1280, 'dark', 'standard'],
] as const) {
  test(`notebook: visual ${width} ${theme}/${contrast}, enlarged text and controls`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const { check } = await setup(page, [
      archived([attempt('incorrect'), attempt('incorrect', 'two', 2)]),
      prefs(theme, contrast),
    ]);
    await open(page);
    await expect(page.locator('.notebook-question')).toHaveCount(1);
    await noOverflow(page);
    await check();
    await page.screenshot({
      path: `/tmp/medsim-notebook-${width}-${theme}-${contrast}-${info.project.name}.png`,
      fullPage: true,
    });
    for (const name of ['Todas', 'Pendentes', 'Recorrentes', 'Nunca acertei', 'Superadas']) {
      const button = page.getByRole('button', { name, exact: true });
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      (await page.getByLabel('Matéria', { exact: true }).boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => {
      document.documentElement.dataset.textSize = 'large';
    });
    await noOverflow(page);
    await page.getByRole('button', { name: 'Recorrentes', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Recorrentes', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      await page
        .getByRole('button', { name: 'Recorrentes', exact: true })
        .evaluate((node) => getComputedStyle(node).outlineStyle),
    ).not.toBe('none');
    await check();
    await page.screenshot({
      path: `/tmp/medsim-notebook-${width}-${theme}-${contrast}-large-${info.project.name}.png`,
      fullPage: true,
    });
  });
}
test('notebook: 205 synthetic UI records, long fragmented safe statement, high contrast and pagination', async ({
  page,
}, info) => {
  const q = exam.questions[0]!;
  const synthetic = {
    ...exam,
    questions: Array.from({ length: 205 }, (_, index) => ({
      ...q,
      id: `ui-question-${index}`,
      label: `Questão ${index + 1}`,
      statement: [
        {
          type: 'element' as const,
          tag: 'p' as const,
          children: [
            {
              type: 'text' as const,
              text: 'Enunciado longo para teste de apresentação. '.repeat(15),
            },
            {
              type: 'element' as const,
              tag: 'strong' as const,
              children: [{ type: 'text' as const, text: '<img src=x onerror=alert(1)>' }],
            },
          ],
        },
      ],
    })),
  };
  const value = notebookAttempt('incorrect', 'many', 1, 'exam', synthetic);
  value.answers = Object.fromEntries(
    synthetic.questions.map((question) => [question.id, Object.values(value.answers)[0]!]),
  );
  value.result = calculateResult(synthetic, value);
  await page.route('**/generated/exam-index.json', async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    catalog.exams = catalog.exams.map((entry: { id: string }) =>
      entry.id === exam.id
        ? { ...entry, questionCount: 205, objectiveCount: 205, essayCount: 0 }
        : entry,
    );
    await route.fulfill({ json: catalog });
  });
  await page.route(`**/generated/exams/${exam.id}.json`, (route) =>
    route.fulfill({ json: synthetic }),
  );
  await page.setViewportSize({ width: 375, height: 900 });
  const { requests, check } = await setup(page, [
    [storageKey(synthetic), JSON.stringify({ storageVersion: 3, current: value })],
    prefs('dark', 'high'),
  ]);
  await open(page);
  await expect(page.locator('.notebook-question')).toHaveCount(50);
  await expect(
    page.getByRole('heading', { name: '205 questões com histórico de erro' }),
  ).toBeVisible();
  await expect(page.locator('.notebook-question').first()).toContainText(
    '<img src=x onerror=alert(1)>',
  );
  await expect(page.locator('.notebook-question img')).toHaveCount(0);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Mostrar mais questões (50)' }).click();
  await expect(page.locator('.notebook-question')).toHaveCount(100);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Mostrar mais questões (50)' }).click();
  await expect(page.locator('.notebook-question')).toHaveCount(150);
  await page.getByRole('button', { name: 'Mostrar mais questões (50)' }).click();
  await expect(page.locator('.notebook-question')).toHaveCount(200);
  await page.getByRole('button', { name: 'Mostrar mais questões (5)' }).click();
  await expect(page.locator('.notebook-question')).toHaveCount(205);
  await expect(page.getByRole('button', { name: /Mostrar mais questões/ })).toHaveCount(0);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Superadas', exact: true }).click();
  await expect(page.getByText('Nenhuma questão corresponde aos filtros atuais.')).toBeVisible();
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  await expect(page.locator('.notebook-question')).toHaveCount(50);
  expect(requests).toHaveLength(1);
  await check();
  await page.screenshot({ path: `/tmp/medsim-notebook-205-${info.project.name}.png` });
});

test('notebook: several cards and an explicit theme change preserve official storage', async ({
  page,
}, info) => {
  const value = attempt('incorrect');
  value.answers = Object.fromEntries(
    exam.questions
      .filter((q) => q.type === 'multiple-choice')
      .slice(0, 5)
      .map((q) => {
        if (q.type !== 'multiple-choice') throw new Error('fixture');
        return [q.id, q.options.find((o) => o.id !== q.correctAnswer)!.id];
      }),
  );
  value.result = calculateResult(exam, value);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { requests, check } = await setup(page, [archived([value])]);
  await open(page);
  await expect(page.locator('.notebook-question')).toHaveCount(5);
  await check();
  await noOverflow(page);
  await page.screenshot({
    path: `/tmp/medsim-notebook-several-${info.project.name}.png`,
    fullPage: true,
  });
  const officialRaw = await page.evaluate(
    (key) => localStorage.getItem(key),
    reviewStorageKey(exam),
  );
  await page.getByRole('button', { name: '◐ Tema escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate((key) => localStorage.getItem(key), reviewStorageKey(exam))).toBe(
    officialRaw,
  );
  expect(
    await page.evaluate(() => (window as unknown as { notebookWrites: string[] }).notebookWrites),
  ).toEqual([`set:local:${uiPreferencesKey}`]);
  await page.evaluate(() => {
    (window as unknown as { notebookWrites: string[] }).notebookWrites.length = 0;
  });
  await page.getByRole('button', { name: 'Pendentes', exact: true }).click();
  await expect(page.locator('.notebook-question')).toHaveCount(5);
  await noOverflow(page);
  expect(
    await page.evaluate(() => (window as unknown as { notebookWrites: string[] }).notebookWrites),
  ).toEqual([]);
  expect(requests).toHaveLength(1);
  await page.screenshot({
    path: `/tmp/medsim-notebook-several-dark-${info.project.name}.png`,
    fullPage: true,
  });
});
