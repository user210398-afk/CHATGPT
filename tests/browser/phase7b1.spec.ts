import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseExam } from '../../schema/exam';
import { storageKey, historyStorageKey } from '../../src/engine/persistence';
import { reviewStorageKey } from '../../src/engine/review-history';
import { uiPreferencesKey } from '../../src/engine/ui-preferences';
import { createAttempt, transition } from '../../src/engine/exam-state';
const exam = parseExam(
  JSON.parse(readFileSync('data/exams/fisiologia-m5-aula-1-2026.json', 'utf8')),
);
async function snapshot(page: Page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
}
async function current(page: Page) {
  return JSON.parse((await snapshot(page))[storageKey(exam)]!).current;
}
async function start(page: Page, mode: 'exam' | 'study') {
  await page.goto(`?exam=${exam.id}`);
  await page
    .getByRole('button', {
      name: mode === 'exam' ? 'Iniciar em Modo Prova' : 'Iniciar em Modo Estudo',
    })
    .click();
}
async function finish(page: Page) {
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização' }).click();
  await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeVisible();
}
async function map(page: Page, index: number) {
  await page
    .locator('.question-number')
    .filter({ hasText: new RegExp(`^${index}(?:✓|…|•)?$`) })
    .click();
}
function watch(page: Page) {
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => requests.push(r.url()));
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
function academic(value: Record<string, unknown>) {
  const { flagged: _flags, ...rest } = value;
  return rest;
}
test('7B.1: chooser zero write, keyboard choice and preferences only affect future attempts', async ({
  page,
}) => {
  const check = watch(page);
  await page.goto(`?exam=${exam.id}`);
  await expect(
    page.getByRole('heading', { name: 'Como deseja fazer esta tentativa?' }),
  ).toBeFocused();
  expect(await snapshot(page)).toEqual({});
  await page.reload();
  await expect(page.getByRole('button', { name: 'Iniciar em Modo Estudo' })).toBeVisible();
  expect(await snapshot(page)).toEqual({});
  await page.getByRole('button', { name: 'Iniciar em Modo Estudo' }).focus();
  await page.keyboard.press('Enter');
  expect((await current(page)).mode).toBe('study');
  await page.goto('?view=settings');
  await page.getByLabel('Modo padrão para novas tentativas').selectOption('exam');
  await page.goto(`?exam=${exam.id}`);
  await expect(page.getByText('Confirme cada resposta para liberar o feedback.')).toBeVisible();
  expect((await current(page)).mode).toBe('study');
  await finish(page);
  await page.getByRole('button', { name: 'Nova tentativa' }).click();
  await expect(page.getByRole('heading', { name: 'Questão 1 de 30', exact: true })).toBeVisible();
  expect((await current(page)).mode).toBe('exam');
  expect(JSON.parse((await snapshot(page))[uiPreferencesKey]!)).toMatchObject({
    storageVersion: 2,
    attemptModePreference: 'exam',
  });
  check();
});
test('7B.1: Exam hides feedback, preserves answer changes and post-completion flags after reload', async ({
  page,
}) => {
  const check = watch(page);
  await start(page, 'exam');
  const radios = page.getByRole('radio');
  await radios.nth(0).check();
  await radios.nth(1).check();
  await expect(radios.nth(1)).toBeChecked();
  await expect(page.locator('.feedback')).toHaveCount(0);
  await expect(page.getByText('Resposta correta', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '⚑ Marcar para revisão' }).click();
  await finish(page);
  await page.getByRole('button', { name: 'Revisar respostas' }).click();
  const before = await current(page);
  await expect(page.getByRole('radio').first()).toBeDisabled();
  await page.getByRole('button', { name: '⚑ Desmarcar da revisão' }).click();
  expect(academic(await current(page))).toEqual(academic(before));
  expect((await current(page)).flagged).toEqual([]);
  await page.getByRole('button', { name: '⚑ Marcar para revisão' }).click();
  const marked = await current(page);
  expect(academic(marked)).toEqual(academic(before));
  expect(JSON.parse((await snapshot(page))[reviewStorageKey(exam)]!).attempts[0].flagged).toEqual(
    marked.flagged,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Revisar respostas' }).click();
  await expect(page.getByRole('button', { name: '⚑ Desmarcar da revisão' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  check();
});
test('7B.1: Study draft, wrong feedback, essay comparison, finish guard and detailed historical review', async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const check = watch(page);
  await start(page, 'study');
  const q = exam.questions[0]!;
  if (q.type !== 'multiple-choice') throw new Error('fixture');
  const correct = q.options.findIndex((o) => o.id === q.correctAnswer),
    wrong = correct === 0 ? 1 : 0;
  await page.getByRole('radio').nth(wrong).check();
  await page.getByRole('radio').nth(correct).check();
  await page.getByRole('radio').nth(wrong).check();
  await expect(page.locator('.feedback')).toHaveCount(0);
  await expect(page.locator('.answer-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmar resposta' }).click();
  await expect(page.getByRole('status')).toHaveText('Resposta incorreta');
  await expect(page.getByRole('heading', { name: 'Explicação' })).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Questão 1 de 30', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '⚑ Marcar para revisão' }).click();
  await page.getByRole('button', { name: '⚑ Desmarcar da revisão' }).click();
  await map(page, 2);
  await page.getByRole('radio').first().check();
  await map(page, 21);
  const box = page.getByRole('textbox', { name: 'Sua resposta' });
  await box.fill('Draft inicial');
  await box.fill('Minha resposta para comparar.');
  await expect(page.getByRole('heading', { name: 'Resposta-modelo' })).toHaveCount(0);
  await expect(page.locator('.feedback')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmar e comparar' }).click();
  await expect(box).toHaveAttribute('readonly', '');
  await expect(page.getByText('Resposta confirmada', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resposta-modelo' })).toBeVisible();
  await expect(page.getByText('Resposta incorreta', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Existem 1 respostas ainda não confirmadas.');
  await page.getByRole('button', { name: 'Ir para primeira resposta pendente' }).click();
  await expect(page.getByRole('heading', { name: 'Questão 2 de 30', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar resposta' }).click();
  await finish(page);
  const old = await current(page);
  await page.getByRole('button', { name: 'Revisar respostas' }).click();
  await page.getByLabel('Respostas', { exact: true }).selectOption('incorrect');
  await page.getByRole('button', { name: '⚑ Marcar para revisão' }).click();
  await page.screenshot({ path: info.outputPath('study-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Voltar ao resultado' }).click();
  await page.getByRole('button', { name: 'Nova tentativa' }).click();
  await page.getByRole('button', { name: 'Iniciar em Modo Prova' }).click();
  const newRaw = (await snapshot(page))[storageKey(exam)],
    historyRaw = (await snapshot(page))[historyStorageKey(exam)];
  await page.locator('.app-nav').getByRole('link', { name: 'Revisão', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revisão', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Revisar tentativa de/ }).click();
  await page.getByLabel('Respostas', { exact: true }).selectOption('incorrect');
  await page.getByLabel('Marcação').selectOption('flagged');
  await page.getByRole('button', { name: '⚑ Desmarcar da revisão' }).click();
  await expect(page.getByText('Nenhuma questão corresponde aos filtros.')).toBeVisible();
  expect((await snapshot(page))[storageKey(exam)]).toBe(newRaw);
  expect((await snapshot(page))[historyStorageKey(exam)]).toBe(historyRaw);
  await page.reload();
  await page.getByLabel('Marcação').selectOption('flagged');
  await expect(page.getByText('Nenhuma questão corresponde aos filtros.')).toBeVisible();
  const archived = JSON.parse((await snapshot(page))[reviewStorageKey(exam)]!).attempts[0];
  expect(archived.id).toBe(old.id);
  expect(archived.answers).toEqual(old.answers);
  expect(archived.result).toEqual(old.result);
  check();
});
test('7B.1: reload keeps confirmed answers locked and objective/essay drafts editable', async ({
  page,
}) => {
  await start(page, 'study');
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Confirmar resposta' }).click();
  await map(page, 2);
  await page.getByRole('radio').nth(1).check();
  await page.reload();
  await expect(page.getByRole('radio').nth(1)).toBeChecked();
  await expect(page.getByRole('radio').nth(1)).toBeEnabled();
  await map(page, 1);
  await expect(page.getByRole('radio').first()).toBeDisabled();
  await map(page, 21);
  await page.getByRole('textbox').fill('Texto pendente');
  await map(page, 22);
  await page.reload();
  await map(page, 21);
  await expect(page.getByRole('textbox')).toHaveValue('Texto pendente');
  await expect(page.getByRole('textbox')).not.toHaveAttribute('readonly');
  expect((await current(page)).mode).toBe('study');
  expect((await current(page)).confirmedQuestionIds).toEqual([exam.questions[0]!.id]);
});
test('7B.1: review navigation/filter writes zero; flag writes only current/review and rolls back failure', async ({
  page,
}) => {
  await start(page, 'exam');
  await page.getByRole('radio').first().check();
  await finish(page);
  await page.getByRole('button', { name: 'Revisar respostas' }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { writes: string[] }).writes = [];
    Storage.prototype.setItem = function (key, value) {
      (window as unknown as { writes: string[] }).writes.push(key);
      original.call(this, key, value);
    };
  });
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Próxima →' }).click();
  await page.getByRole('button', { name: '← Anterior' }).click();
  await page.getByLabel('Respostas', { exact: true }).selectOption('unanswered');
  await page.getByLabel('Categoria').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as { writes: string[] }).writes)).toEqual([]);
  await page.getByRole('button', { name: '⚑ Marcar para revisão' }).click();
  expect(await page.evaluate(() => (window as unknown as { writes: string[] }).writes)).toEqual([
    storageKey(exam),
    reviewStorageKey(exam),
  ]);
  const marked = await snapshot(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, value) {
      if (k === key) throw new DOMException('quota', 'QuotaExceededError');
      original.call(this, k, value);
    };
  }, reviewStorageKey(exam));
  await page.getByRole('button', { name: '⚑ Desmarcar da revisão' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Não foi possível alterar a marcação de revisão.',
  );
  expect(await snapshot(page)).toEqual(marked);
  await expect(page.getByRole('button', { name: '⚑ Desmarcar da revisão' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
test('7B.1: capture failure keeps result and blocks destructive restart', async ({ page }) => {
  await start(page, 'exam');
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, value) {
      if (k === key) throw new DOMException('quota', 'QuotaExceededError');
      original.call(this, k, value);
    };
  }, reviewStorageKey(exam));
  await finish(page);
  await expect(page.getByRole('alert')).toContainText(
    'histórico detalhado de revisão não pôde ser salvo',
  );
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Nova tentativa' }).click();
  await expect(page.getByRole('alert')).toContainText('nova tentativa não foi iniciada');
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByRole('heading', { name: 'Seu resultado' })).toBeVisible();
});
test('7B.1 audit: restart never replaces a current changed after capture', async ({ page }) => {
  await start(page, 'exam');
  await finish(page);
  await page.getByRole('button', { name: 'Nova tentativa' }).click();
  const foreign = createAttempt(exam, '2026-10-04T10:00:00.000Z', 'foreign-tab', 'study');
  const before = await snapshot(page);
  await page.evaluate(
    ({ key, foreign }) => {
      const uuid = crypto.randomUUID.bind(crypto);
      crypto.randomUUID = () => {
        localStorage.setItem(key, JSON.stringify({ storageVersion: 3, current: foreign }));
        return uuid();
      };
    },
    { key: storageKey(exam), foreign },
  );
  await page.getByRole('button', { name: 'Iniciar em Modo Prova' }).click();
  await expect(page.getByRole('alert')).toContainText('concorrência');
  expect(await current(page)).toEqual(foreign);
  const after = await snapshot(page);
  expect(after[reviewStorageKey(exam)]).toBe(before[reviewStorageKey(exam)]);
  expect(after[historyStorageKey(exam)]).toBe(before[historyStorageKey(exam)]);
  await expect(
    page.getByRole('heading', { name: 'Como deseja fazer esta tentativa?' }),
  ).toBeVisible();
});
for (const width of [375, 390, 1024, 1280]) {
  test(`7B.1 audit: Study/review keyboard, 44px targets and overflow at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const check = watch(page);
    const measurements: {
      state: string;
      targets: { name: string; width: number; height: number }[];
    }[] = [];
    const measure = async (state: string, selector: string) => {
      const targets = await page.locator(selector).evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            name: element.getAttribute('aria-label') ?? element.textContent ?? '',
            width: rect.width,
            height: rect.height,
          };
        }),
      );
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      measurements.push({ state, targets });
    };
    await page.goto('?view=dashboard');
    await expect(page.getByRole('heading', { name: 'Meu desempenho' })).toBeVisible();
    await expect(
      page.getByText('As métricas atuais incluem tentativas em Modo Prova e Modo Estudo.'),
    ).toHaveCount(0);
    await page.goto('?view=settings');
    await page.getByLabel('Tamanho do texto').selectOption('large');
    await page.getByLabel('Contraste').selectOption('high');
    await page.getByRole('checkbox', { name: /Indicador de foco reforçado/ }).check();
    const beforeChoice = await snapshot(page);
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      const uuid = crypto.randomUUID.bind(crypto);
      const audit = { writes: 0, uuids: 0 };
      (window as unknown as { audit: typeof audit }).audit = audit;
      Storage.prototype.setItem = function (key, value) {
        audit.writes++;
        original.call(this, key, value);
      };
      crypto.randomUUID = () => {
        audit.uuids++;
        return uuid();
      };
    });
    await page.goto(`?exam=${exam.id}`);
    await expect(
      page.getByRole('heading', { name: 'Como deseja fazer esta tentativa?' }),
    ).toBeFocused();
    expect(await snapshot(page)).toEqual(beforeChoice);
    expect(
      await page.evaluate(
        () => (window as unknown as { audit: { writes: number; uuids: number } }).audit,
      ),
    ).toEqual({ writes: 0, uuids: 0 });
    await measure('chooser', '.settings-grid button');
    const choose = page.getByRole('button', { name: 'Iniciar em Modo Estudo' });
    await choose.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('radio').first().check();
    await expect(page.locator('.feedback, .answer-note')).toHaveCount(0);
    await measure('study draft', '.flag-button, .study-confirmation button, .question-number');
    const confirm = page.getByRole('button', { name: 'Confirmar resposta' });
    await confirm.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    expect(await confirm.evaluate((e) => getComputedStyle(e).outlineWidth)).toBe('5px');
    await page.keyboard.press('Enter');
    await expect(page.locator('.feedback')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('radio').first()).toBeDisabled();
    await measure(
      'objective feedback',
      '.flag-button, .question-number, .question-controls button',
    );
    await map(page, 21);
    await page.getByRole('textbox').fill('Raciocínio para comparação. '.repeat(100));
    await expect(page.getByRole('heading', { name: 'Resposta-modelo' })).toHaveCount(0);
    await measure('essay draft', '.flag-button, .study-confirmation button, .question-number');
    await page.getByRole('button', { name: 'Confirmar e comparar' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox')).toHaveAttribute('readonly', '');
    await measure('essay feedback', '.flag-button, .question-number, .question-controls button');
    await finish(page);
    await page.getByRole('button', { name: 'Revisar respostas' }).click();
    await measure('review filters', '.setting-field select, .flag-button, .question-number');
    await page.getByRole('button', { name: '⚑ Marcar para revisão' }).click();
    await page.getByLabel('Marcação').selectOption('flagged');
    const marked = await current(page);
    const flag = page.getByRole('button', { name: '⚑ Desmarcar da revisão' });
    await flag.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(flag).toBeFocused();
    expect(await flag.evaluate((e) => getComputedStyle(e).outlineWidth)).toBe('5px');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Nenhuma questão corresponde aos filtros.')).toBeVisible();
    expect(academic(await current(page))).toEqual(academic(marked));
    await page.goto('?view=review');
    await expect(page.getByRole('heading', { name: 'Revisão', exact: true })).toBeVisible();
    await measure('review hub', '.review-attempt-list a');
    const link = page.getByRole('link', { name: /Revisar tentativa de/ });
    await link.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(link).toBeFocused();
    expect(await link.evaluate((e) => getComputedStyle(e).outlineWidth)).toBe('5px');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Respostas', { exact: true })).toBeVisible();
    await measure('historical review', '.setting-field select, .flag-button, .question-number');
    const beforeFilter = await snapshot(page);
    await page.getByLabel('Respostas', { exact: true }).selectOption('essay');
    await page.getByLabel('Categoria').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    expect(await snapshot(page)).toEqual(beforeFilter);
    await info.attach(`audit-${width}px-measurements`, {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    });
    check();
  });
}
test('7B.1: global hub avoids fetching all Exams; legacy current and invalid archive stay read-only', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('?view=review');
  await expect(page.getByRole('heading', { name: 'Revisão', exact: true })).toBeVisible();
  expect(requests.filter((url) => /generated\/exams\//.test(url))).toEqual([]);
  const complete = transition(
    exam,
    createAttempt(exam, '2026-10-03T10:00:00.000Z', 'legacy', 'exam'),
    { type: 'finish', now: '2026-10-03T11:00:00.000Z' },
  );
  const { mode: _mode, confirmedQuestionIds: _confirmed, ...legacy } = complete;
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: storageKey(exam),
    raw: JSON.stringify({ storageVersion: 2, current: legacy }),
  });
  await page.reload();
  await expect(page.getByRole('link', { name: /Revisar tentativa de/ })).toBeVisible();
  const before = await snapshot(page);
  await page.getByRole('link', { name: /Revisar tentativa de/ }).click();
  await expect(page.getByRole('heading', { name: 'Questão 1 de 30', exact: true })).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  expect(requests.filter((url) => /generated\/exams\//.test(url))).toHaveLength(1);
  await page.evaluate((key) => localStorage.setItem(key, '{bad'), reviewStorageKey(exam));
  const corrupted = await snapshot(page);
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await snapshot(page)).toEqual(corrupted);
});
test('7B.1: real Study backup v2 roundtrip preserves answers, confirmations and post-completion flag', async ({
  page,
  browser,
}, info) => {
  const check = watch(page);
  await start(page, 'study');
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Confirmar resposta' }).click();
  await map(page, 2);
  const q = exam.questions[1]!;
  if (q.type !== 'multiple-choice') throw new Error('fixture');
  await page
    .getByRole('radio')
    .nth(q.options.findIndex((o) => o.id === q.correctAnswer))
    .check();
  await page.getByRole('button', { name: 'Confirmar resposta' }).click();
  await finish(page);
  await page.getByRole('button', { name: 'Revisar respostas' }).click();
  await page.getByRole('button', { name: '⚑ Marcar para revisão' }).click();
  const original = await current(page);
  await page.goto('?view=settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar progresso' }).click();
  const file = await (await download).path();
  if (!file) throw new Error('download');
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
    format: 'medsim-backup',
    version: 3,
  });
  const context = await browser.newContext({
    ...info.project.use,
    baseURL: 'http://127.0.0.1:4173/CHATGPT/',
  });
  try {
    const restored = await context.newPage();
    await restored.goto('?view=settings');
    await restored.getByLabel('Importar progresso', { exact: true }).setInputFiles(file);
    await expect(restored.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
    expect(await snapshot(restored)).toEqual({});
    await restored.getByRole('button', { name: 'Confirmar importação' }).click();
    await expect(restored.getByRole('status')).toContainText('Importação concluída');
    await restored.goto(
      `?view=review&reviewExam=${encodeURIComponent(exam.id)}&attempt=${encodeURIComponent(original.id)}`,
    );
    await expect(restored.getByRole('button', { name: '⚑ Desmarcar da revisão' })).toBeVisible();
    expect(await current(restored)).toEqual(original);
    await restored.reload();
    await expect(restored.getByRole('button', { name: '⚑ Desmarcar da revisão' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  } finally {
    await context.close();
  }
  check();
});
for (const id of ['farmaco-p2-2025', 'imunologia-b4-2023', 'imunologia-b4-2024']) {
  test(`7B.1: ${id} affected explanation renders clean after normal production build`, async ({
    page,
  }) => {
    const baseline = JSON.parse(
      execFileSync(
        'git',
        ['show', `d1d9fc3fac7a99f6ad51ccf4153b25e263b07a93:data/exams/${id}.json`],
        { encoding: 'utf8' },
      ),
    );
    const index = baseline.questions.findIndex((q: unknown) =>
      /start_span|end_span/.test(JSON.stringify(q)),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    await page.goto(`?exam=${id}`);
    await page.getByRole('button', { name: 'Iniciar em Modo Estudo' }).click();
    await map(page, index + 1);
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Confirmar resposta' }).click();
    await expect(page.getByRole('heading', { name: 'Explicação' })).toBeVisible();
    expect(await page.locator('body').textContent()).not.toMatch(
      /start_span|end_span|\[span_[0-9]+\]/,
    );
  });
}
test('7B.1: Review Hub respects theme, high contrast, text and motion preferences without overflow', async ({
  page,
}, info) => {
  await page.goto('?view=settings');
  await page.getByLabel('Tema', { exact: true }).selectOption('dark');
  await page.getByLabel('Contraste').selectOption('high');
  await page.getByLabel('Tamanho do texto').selectOption('large');
  await page.getByRole('checkbox', { name: /Indicador de foco reforçado/ }).check();
  await page.goto(`?exam=${exam.id}`);
  await page.getByRole('button', { name: 'Iniciar em Modo Prova' }).click();
  await finish(page);
  await page.goto('?view=review');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('review-hub-dark.png'), fullPage: true });
  await page.getByRole('link', { name: /Revisar tentativa de/ }).click();
  await expect(page.getByLabel('Respostas', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const link = page.getByRole('button', { name: '⚑ Marcar para revisão' });
  await link.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(link).toBeFocused();
  expect(await link.evaluate((e) => getComputedStyle(e).outlineWidth)).toBe('5px');
});
