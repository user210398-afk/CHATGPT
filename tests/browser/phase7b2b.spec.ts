import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseExam } from '../../schema/exam';
import { createAttempt, transition, type Attempt } from '../../src/engine/exam-state';
import { storageKey, historyStorageKey, summary } from '../../src/engine/persistence';
import { reviewStorageKey } from '../../src/engine/review-history';
import {
  createReviewSession,
  selectReviewQuestions,
  type ReviewSelection,
} from '../../src/engine/review-session';
import { reviewSessionStorageKey } from '../../src/engine/review-session-storage';
import { catalogPreferencesKey } from '../../src/engine/catalog-preferences';
import { defaultUiPreferences, uiPreferencesKey } from '../../src/engine/ui-preferences';
const exam = parseExam(
  JSON.parse(readFileSync('data/exams/fisiologia-m5-aula-1-2026.json', 'utf8')),
);
const other = parseExam(JSON.parse(readFileSync('data/exams/farmaco-p2-2025.json', 'utf8')));
const objectives = exam.questions.filter((q) => q.type === 'multiple-choice'),
  essay = exam.questions.find((q) => q.type === 'essay')!;
const now = '2026-10-05T18:00:00.000Z';
const all: ReviewSelection = {
  kind: 'filtered',
  filters: { status: 'all', flaggedOnly: false, category: '', tag: '' },
};
function source(id = 'source'): Attempt {
  let state = createAttempt(exam, '2026-10-05T16:00:00.000Z', id, 'exam');
  for (const q of objectives.slice(0, 2)) {
    state = transition(exam, state, {
      type: 'answer',
      questionId: q.id,
      value: q.options.find((o) => o.id !== q.correctAnswer)!.id,
    });
    state = transition(exam, state, { type: 'flag', questionId: q.id });
  }
  state = transition(exam, state, { type: 'flag', questionId: essay.id });
  return transition(exam, state, { type: 'finish', now: '2026-10-05T17:00:00.000Z' });
}
const snapshot = (page: Page) =>
  page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
async function seed(page: Page, entries: [string, string][] = [], current = source()) {
  await page.goto('?view=review');
  await page.evaluate(
    (entries) => {
      for (const [key, value] of entries) localStorage.setItem(key, value);
    },
    [
      [storageKey(exam), JSON.stringify({ storageVersion: 3, current })],
      [
        historyStorageKey(exam),
        JSON.stringify({
          storageVersion: 3,
          history: [summary(source()), summary(source('older'))],
        }),
      ],
      [
        reviewStorageKey(exam),
        JSON.stringify({ storageVersion: 1, attempts: [source(), source('older')] }),
      ],
      ...entries,
    ] as [string, string][],
  );
}
async function historical(page: Page) {
  await page.goto(`?view=review&reviewExam=${exam.id}&attempt=source`);
  await expect(page.getByLabel('Respostas', { exact: true })).toBeVisible();
}
async function choose(page: Page, action = 'Refazer erradas', mode = 'Estudo') {
  await page.getByRole('button', { name: new RegExp(`^${action}`) }).click();
  await page.getByRole('button', { name: `Iniciar sessão em Modo ${mode}` }).click();
  await expect(page).toHaveURL(/view=review-session/);
  await expect(page.getByRole('heading', { name: 'Mapa da sessão' })).toBeVisible();
}
async function finish(page: Page) {
  await page.getByRole('button', { name: 'Finalizar sessão', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar finalização da sessão' }).click();
  await expect(
    page.getByRole('heading', { name: 'Resultado desta sessão de revisão' }),
  ).toBeVisible();
}
const currentSession = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).session,
    reviewSessionStorageKey(exam),
  );
function monitor(page: Page) {
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  return {
    requests,
    check: () => {
      expect(errors).toEqual([]);
      expect(
        requests.every(
          (url) => url.startsWith('http://127.0.0.1:4173/CHATGPT/') || url.startsWith('blob:'),
        ),
      ).toBe(true);
    },
  };
}
async function metrics(page: Page) {
  await page.goto('?view=dashboard');
  await expect(page.getByRole('heading', { name: 'Meu desempenho' })).toBeVisible();
  return page.locator('.metrics-grid, .subject-metrics, .recent-list').allTextContents();
}

test('7B.2B: wrong-question Study session confirms, reloads, resumes, completes without affecting Dashboard', async ({
  page,
}) => {
  const audit = monitor(page);
  await seed(page);
  const official = await snapshot(page),
    before = await metrics(page);
  await page.goto('?view=review');
  await page
    .getByRole('link', { name: /Revisar tentativa de/ })
    .first()
    .click();
  await choose(page);
  const selected = await currentSession(page);
  expect(selected.questionIds).toEqual(objectives.slice(0, 2).map((q) => q.id));
  await page.getByRole('radio').first().check();
  await expect(page.locator('.feedback')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmar resposta' }).click();
  await expect(page.locator('.feedback')).toBeVisible();
  await page.getByRole('button', { name: 'Próxima →' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Questão 2 de 2 da sessão' })).toBeVisible();
  await page.goto('?view=review');
  await page.getByRole('link', { name: 'Continuar sessão de revisão' }).click();
  await page.getByRole('button', { name: /^Ir para questão 1/ }).click();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  await page.getByRole('button', { name: 'Próxima →' }).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Confirmar resposta' }).click();
  await finish(page);
  expect((await currentSession(page)).result.total).toBe(2);
  expect(await metrics(page)).toEqual(before);
  const after = await snapshot(page);
  for (const [key, value] of Object.entries(official)) expect(after[key]).toBe(value);
  audit.check();
});
test('7B.2B: Exam session feedback is absent until finish; own feedback available after', async ({
  page,
}) => {
  const audit = monitor(page);
  await seed(page);
  await historical(page);
  await choose(page, 'Refazer erradas', 'Prova');
  await page.getByRole('radio').first().check();
  await expect(page.locator('.feedback, .answer-note')).toHaveCount(0);
  await page.getByRole('radio').nth(1).check();
  await finish(page);
  await page.getByRole('button', { name: 'Revisar respostas da sessão' }).click();
  await expect(page.locator('.feedback')).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  audit.check();
});
test('7B.2B: filtered AND subset exactly matches historical filters and frozen selection', async ({
  page,
}) => {
  await seed(page);
  await historical(page);
  const q = objectives[0]!,
    filters = {
      status: 'incorrect' as const,
      flaggedOnly: true,
      category: q.category,
      tag: q.tags[0] ?? '',
    };
  await page.getByLabel('Respostas', { exact: true }).selectOption(filters.status);
  await page.getByLabel('Marcação').selectOption('flagged');
  await page.getByLabel('Categoria').selectOption(filters.category);
  await page.getByLabel('Tópico/tag').selectOption(filters.tag);
  const expected = selectReviewQuestions(exam, source(), { kind: 'filtered', filters });
  await expect(
    page.getByRole('button', { name: `Iniciar sessão com filtros atuais (${expected.length})` }),
  ).toBeEnabled();
  await choose(page, 'Iniciar sessão com filtros atuais', 'Prova');
  expect((await currentSession(page)).questionIds).toEqual(expected);
  expect((await currentSession(page)).selection).toEqual({ kind: 'filtered', filters });
});
test('7B.2B: active session cannot be silently replaced, continue and explicit discard remain available', async ({
  page,
}) => {
  await seed(page);
  await historical(page);
  await choose(page);
  const active = await currentSession(page);
  await historical(page);
  await page.getByRole('button', { name: /^Refazer marcadas/ }).click();
  await expect(page.getByRole('button', { name: 'Iniciar sessão em Modo Estudo' })).toBeDisabled();
  expect((await currentSession(page)).id).toBe(active.id);
  await page.getByRole('link', { name: 'Continuar sessão atual' }).click();
  await page.getByRole('button', { name: 'Descartar sessão de revisão' }).click();
  expect((await currentSession(page)).id).toBe(active.id);
  await page.getByRole('button', { name: 'Confirmar descarte da sessão' }).click();
  await expect(page).toHaveURL(/view=review$/);
  expect((await snapshot(page))[reviewSessionStorageKey(exam)]).toBeUndefined();
});
test('7B.2B: confirmed replacement creates new session only after explicit consent', async ({
  page,
}) => {
  await seed(page);
  await historical(page);
  await choose(page);
  const active = await currentSession(page);
  await historical(page);
  await page.getByRole('button', { name: /^Refazer marcadas/ }).click();
  await page.getByRole('checkbox', { name: 'Descartar sessão atual e iniciar nova' }).check();
  await page.getByRole('button', { name: 'Iniciar sessão em Modo Prova' }).click();
  await expect(page.getByRole('heading', { name: 'Mapa da sessão' })).toBeVisible();
  const replaced = await currentSession(page);
  expect(replaced.id).not.toBe(active.id);
  expect(replaced.questionIds).toContain(essay.id);
});
test('7B.2B: flagged essay debounces, reloads, explicitly compares and pending drafts block finish', async ({
  page,
}) => {
  await seed(page);
  await historical(page);
  await choose(page, 'Refazer marcadas');
  await page.getByRole('button', { name: /^Ir para questão 3/ }).click();
  await page.getByRole('textbox').fill('Raciocínio salvo para comparar.');
  await expect
    .poll(async () => (await currentSession(page)).answers[essay.id])
    .toBe('Raciocínio salvo para comparar.');
  await page.reload();
  await expect(page.getByRole('textbox')).toHaveValue('Raciocínio salvo para comparar.');
  await expect(page.getByRole('heading', { name: 'Resposta-modelo' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Finalizar sessão', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Confirmar finalização da sessão' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Ir para primeira resposta pendente' }).click();
  await page.getByRole('button', { name: 'Confirmar e comparar' }).click();
  await expect(page.getByRole('textbox')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('heading', { name: 'Resposta-modelo' })).toBeVisible();
  await finish(page);
  expect((await currentSession(page)).result.essayAnswered).toBe(1);
});
test('7B.2B: source flags synchronize without modifying academic answers/results or session', async ({
  page,
}) => {
  await seed(page);
  await historical(page);
  await choose(page);
  const before = await snapshot(page);
  await page.getByRole('button', { name: '⚑ Desmarcar da revisão' }).click();
  const after = await snapshot(page);
  expect(after[reviewSessionStorageKey(exam)]).toBe(before[reviewSessionStorageKey(exam)]);
  const original = JSON.parse(before[storageKey(exam)]!).current,
    changed = JSON.parse(after[storageKey(exam)]!).current;
  const { flagged: _before, ...academicBefore } = original,
    { flagged: _after, ...academicAfter } = changed;
  expect(academicAfter).toEqual(academicBefore);
  expect(changed.flagged).not.toContain(objectives[0]!.id);
});
test('7B.2B: orphan session remains answerable without recreating missing official source', async ({
  page,
}) => {
  const state = createReviewSession(exam, source(), { kind: 'incorrect' }, 'exam', now, 'orphan');
  await seed(page, [
    [reviewSessionStorageKey(exam), JSON.stringify({ storageVersion: 1, session: state })],
  ]);
  await page.evaluate(
    (keys) => {
      for (const key of keys) localStorage.removeItem(key);
    },
    [storageKey(exam), historyStorageKey(exam), reviewStorageKey(exam)],
  );
  await page.goto(`?view=review-session&reviewExam=${exam.id}`);
  await expect(page.getByText(/A tentativa fonte não está disponível/)).toBeVisible();
  await page.getByRole('radio').first().check();
  expect((await currentSession(page)).answers[objectives[0]!.id]).toBeTruthy();
  expect((await snapshot(page))[storageKey(exam)]).toBeUndefined();
});
test('7B.2B: reset removes two completions/archive/session and preserves exact in-progress/favorites/settings', async ({
  page,
}) => {
  const state = createReviewSession(exam, source(), all, 'study', now),
    ongoing = createAttempt(other, now, 'ongoing', 'study');
  const q = other.questions[0]!;
  if (q.type !== 'multiple-choice') throw new Error('fixture');
  ongoing.answers[q.id] = q.options[0]!.id;
  await seed(page, [
    [reviewSessionStorageKey(exam), JSON.stringify({ storageVersion: 1, session: state })],
    [storageKey(other), JSON.stringify({ storageVersion: 3, current: ongoing })],
    [catalogPreferencesKey, JSON.stringify({ storageVersion: 1, favorites: [exam.id] })],
    [
      uiPreferencesKey,
      JSON.stringify({
        ...defaultUiPreferences,
        attemptModePreference: 'study',
        setupPrompt: 'completed',
      }),
    ],
    ['foreign', 'untouched'],
  ]);
  const before = await snapshot(page);
  await page.goto('?view=dashboard');
  await page.getByRole('button', { name: 'Zerar histórico e estatísticas' }).click();
  const confirm = page.getByRole('button', { name: 'Confirmar reset do histórico' });
  await expect(confirm).toBeDisabled();
  for (const text of ['zerar', 'Zerar', 'ZERAR ']) {
    await page.getByLabel('Digite ZERAR para confirmar').fill(text);
    await expect(confirm).toBeDisabled();
  }
  await page.getByLabel('Digite ZERAR para confirmar').fill('ZERAR');
  await confirm.click();
  await expect(page.getByRole('status')).toContainText(
    'Histórico zerado com sucesso. 2 tentativas concluídas removidas',
  );
  const after = await snapshot(page);
  for (const key of [
    storageKey(exam),
    historyStorageKey(exam),
    reviewStorageKey(exam),
    reviewSessionStorageKey(exam),
  ])
    expect(after[key]).toBeUndefined();
  for (const key of [storageKey(other), catalogPreferencesKey, uiPreferencesKey, 'foreign'])
    expect(after[key]).toBe(before[key]);
  await expect(
    page
      .locator('.metric')
      .filter({ has: page.locator('dt', { hasText: /^Tentativas concluídas no total$/ }) })
      .locator('dd'),
  ).toHaveText('0');
  await expect(
    page
      .locator('.metric')
      .filter({ has: page.locator('dt', { hasText: /^Em andamento$/ }) })
      .locator('dd'),
  ).toHaveText('1');
  await page.goto('?view=review');
  await expect(page.getByRole('link', { name: /Revisar tentativa de/ })).toHaveCount(0);
  await page.goto(`?exam=${other.id}`);
  await expect(page.getByRole('radio').first()).toBeChecked();
});
test('7B.2B: corrupted current aborts reset without deleting any local state', async ({ page }) => {
  await seed(page, [[storageKey(other), '{bad']]);
  await page.goto('?view=dashboard');
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Zerar histórico e estatísticas' }).click();
  await expect(page.getByRole('alert')).toContainText('Reset abortado');
  expect(await snapshot(page)).toEqual(before);
});
test('7B.2B: active review session backup v3 roundtrip and import preview zero-write', async ({
  page,
}) => {
  await seed(page);
  await historical(page);
  await choose(page);
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Confirmar resposta' }).click();
  const active = await currentSession(page),
    beforeMetrics = await metrics(page);
  await page.goto('?view=settings');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar progresso' }).click();
  const path = await (await downloading).path();
  if (!path) throw new Error('download');
  const backup = JSON.parse(readFileSync(path, 'utf8'));
  expect(backup.version).toBe(3);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByLabel('Importar progresso', { exact: true }).setInputFiles(path);
  await expect(page.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
  expect(await snapshot(page)).toEqual({});
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  expect(await currentSession(page)).toEqual(active);
  expect(await metrics(page)).toEqual(beforeMetrics);
  await page.goto(`?view=review-session&reviewExam=${exam.id}`);
  await expect(page.getByRole('radio').first()).toBeDisabled();
});
test('7B.2B: read-only routes and historical filters have zero writes and bounded full Exam requests', async ({
  page,
}) => {
  const audit = monitor(page);
  await seed(page);
  const before = await snapshot(page);
  for (const [route, ready] of [
    ['./', 'Suas matérias'],
    ['?area=fisiologia', 'Fisiologia'],
    ['?view=all', 'Todos os simulados'],
    ['?view=dashboard', 'Meu desempenho'],
    ['?view=review', 'Revisão'],
    ['?view=settings', 'Configurações'],
  ]) {
    const offset = audit.requests.length;
    await page.goto(route!);
    await expect(page.getByRole('heading', { name: ready!, exact: true })).toBeVisible();
    expect(await snapshot(page)).toEqual(before);
    expect(
      audit.requests.slice(offset).filter((url) => /generated\/exams\//.test(url)),
    ).toHaveLength(0);
  }
  let offset = audit.requests.length;
  await historical(page);
  expect(audit.requests.slice(offset).filter((url) => /generated\/exams\//.test(url))).toHaveLength(
    1,
  );
  await page.getByLabel('Respostas', { exact: true }).selectOption('incorrect');
  await page.getByLabel('Marcação').selectOption('flagged');
  await page.getByRole('button', { name: 'Próxima →' }).click();
  await page.getByRole('button', { name: /^Iniciar sessão com filtros atuais/ }).click();
  expect(await snapshot(page)).toEqual(before);
  offset = audit.requests.length;
  await page.getByRole('button', { name: 'Iniciar sessão em Modo Prova' }).click();
  await expect(page.getByRole('heading', { name: 'Mapa da sessão' })).toBeVisible();
  expect(audit.requests.slice(offset).filter((url) => /generated\/exams\//.test(url))).toHaveLength(
    1,
  );
  const started = await snapshot(page);
  offset = audit.requests.length;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mapa da sessão' })).toBeVisible();
  expect(audit.requests.slice(offset).filter((url) => /generated\/exams\//.test(url))).toHaveLength(
    1,
  );
  expect(await snapshot(page)).toEqual(started);
  audit.check();
});
for (const width of [375, 390, 768, 1024, 1280]) {
  test(`7B.2B: ${width}px keyboard focus, 200% text, preferences, tap targets and confirmations fit`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page, [
      [
        uiPreferencesKey,
        JSON.stringify({
          ...defaultUiPreferences,
          theme: 'dark',
          textSize: 'large',
          contrast: 'high',
          density: 'compact',
          reduceMotion: true,
          enhancedFocus: true,
          setupPrompt: 'completed',
        }),
      ],
    ]);
    await historical(page);
    await page.getByRole('button', { name: /^Refazer marcadas/ }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Como deseja fazer esta sessão de revisão?' }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Iniciar sessão em Modo Estudo' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Mapa da sessão' })).toBeVisible();
    await page.getByRole('radio').first().check();
    const confirm = page.getByRole('button', { name: 'Confirmar resposta' });
    await confirm.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    expect(await confirm.evaluate((e) => getComputedStyle(e).outlineWidth)).toBe('5px');
    await page.keyboard.press('Enter');
    await expect(page.locator('.feedback')).toBeVisible();
    await page.getByRole('button', { name: /^Ir para questão 3/ }).click();
    await page.getByRole('textbox').fill('Texto de comparação. '.repeat(100));
    await page.getByRole('button', { name: 'Confirmar e comparar' }).click();
    await expect(page.getByRole('heading', { name: 'Resposta-modelo' })).toBeVisible();
    async function measure(label: string) {
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll('body *')]
          .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
          .map((e) => ({
            tag: e.tagName,
            class: e.className,
            right: e.getBoundingClientRect().right,
          })),
      );
      expect(overflow, label).toEqual([]);
      const sizes = await page
        .locator(
          '.flag-button, .question-number, .question-controls button, .confirmation-region button, .history-reset button',
        )
        .evaluateAll((items) =>
          items.map((e) => ({
            width: e.getBoundingClientRect().width,
            height: e.getBoundingClientRect().height,
          })),
        );
      for (const size of sizes) {
        expect(size.width, label).toBeGreaterThanOrEqual(44);
        expect(size.height, label).toBeGreaterThanOrEqual(44);
      }
    }
    await measure('session');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    await measure('200% zoom equivalent');
    await page.screenshot({ path: info.outputPath(`session-${width}-zoom.png`), fullPage: true });
    if (width >= 1024) {
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
        document.documentElement.style.zoom = '2';
      });
      await measure('session 200% layout zoom');
    }
    await page.goto('?view=dashboard');
    await page.getByRole('button', { name: 'Zerar histórico e estatísticas' }).click();
    await expect(
      page.getByRole('heading', { name: 'Confirmar remoção do histórico' }),
    ).toBeFocused();
    await page.getByLabel('Digite ZERAR para confirmar').fill('ZERAR');
    await measure('reset');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    await measure('reset 200% text');
    if (width >= 1024) {
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
        document.documentElement.style.zoom = '2';
      });
      await measure('reset 200% layout zoom');
    }
    await page.getByRole('button', { name: 'Cancelar reset' }).click();
    await expect(
      page.getByRole('button', { name: 'Zerar histórico e estatísticas' }),
    ).toBeFocused();
  });
}

test('red team: navigation-only position survives Dashboard, Hub, back/forward with zero storage changes', async ({
  page,
}) => {
  await seed(page);
  await historical(page);
  await choose(page);
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Próxima →' }).click();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('link', { name: 'Revisão', exact: true }).click();
  await page.getByRole('link', { name: 'Continuar sessão de revisão' }).click();
  await expect(page.getByRole('heading', { name: /Questão 2 de 2/ })).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Revisão', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: /Questão 2 de 2/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Questão 2 de 2/ })).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});

test('red team: exact destructive confirmation rejects line breaks and accidental Enter', async ({
  page,
}) => {
  await seed(page);
  await page.goto('?view=dashboard');
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Zerar histórico e estatísticas' }).click();
  const field = page.getByLabel('Digite ZERAR para confirmar');
  const button = page.getByRole('button', { name: 'Confirmar reset do histórico' });
  for (const value of ['zerar', 'Zerar', ' ZERAR', 'ZERAR ', 'ZERAR\n']) {
    await field.fill(value);
    await expect(button).toBeDisabled();
    await field.press('Enter');
    expect(await snapshot(page)).toEqual(before);
  }
  await field.fill('ZERAR');
  await expect(button).toBeEnabled();
  await field.press('Enter');
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Cancelar reset' }).click();
});

test('red team: all active-session actions require consent; stale chooser in another tab cannot replace the new session', async ({
  page,
  context,
}) => {
  await seed(page);
  await historical(page);
  await choose(page);
  const original = await snapshot(page);
  await historical(page);
  for (const action of [
    'Refazer erradas',
    'Refazer marcadas',
    'Iniciar sessão com filtros atuais',
  ]) {
    await page.getByRole('button', { name: new RegExp(`^${action}`) }).click();
    await expect(page.getByRole('button', { name: 'Iniciar sessão em Modo Prova' })).toBeDisabled();
    expect(await snapshot(page)).toEqual(original);
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  }
  await page.getByRole('button', { name: /^Refazer erradas/ }).click();
  await page.getByRole('checkbox', { name: 'Descartar sessão atual e iniciar nova' }).check();
  const concurrent = await context.newPage();
  await historical(concurrent);
  await concurrent.getByRole('button', { name: /^Refazer marcadas/ }).click();
  await concurrent.getByRole('checkbox', { name: 'Descartar sessão atual e iniciar nova' }).check();
  await concurrent.getByRole('button', { name: 'Iniciar sessão em Modo Prova' }).click();
  await expect(concurrent.getByRole('heading', { name: 'Mapa da sessão' })).toBeVisible();
  const replacement = await currentSession(concurrent);
  await page.getByRole('button', { name: 'Iniciar sessão em Modo Estudo' }).click();
  await expect(page.getByRole('alert')).toContainText('concorrência');
  expect((await currentSession(page)).id).toBe(replacement.id);
  await concurrent.close();
});

test('red team: pending essay flushes on immediate reload, Exam never shows model or explanation', async ({
  page,
}) => {
  await seed(page);
  await historical(page);
  await choose(page, 'Refazer marcadas', 'Prova');
  await page.getByRole('button', { name: /^Ir para questão 3/ }).click();
  await expect(page.getByRole('textbox')).toHaveValue('');
  await page.getByRole('textbox').fill('Draft before the debounce deadline');
  await page.reload();
  await expect(page.getByRole('textbox')).toHaveValue('Draft before the debounce deadline');
  await expect(
    page.locator('.feedback, .answer-note, .option.correct, .option.incorrect'),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Resposta-modelo|Explicação/ })).toHaveCount(0);
  await finish(page);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Resultado desta sessão de revisão' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Revisar respostas da sessão' }).click();
  await expect(page.getByRole('heading', { name: 'Resposta-modelo' })).toBeVisible();
});

test('red team: real export -> ZERAR -> zero-write preview -> import restores the session and official metrics', async ({
  page,
}) => {
  await seed(page);
  await historical(page);
  await choose(page);
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Confirmar resposta' }).click();
  const state = await currentSession(page),
    beforeMetrics = await metrics(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar progresso' }).click();
  const file = await (await download).path();
  if (!file) throw new Error('download missing');
  await page.getByRole('button', { name: 'Zerar histórico e estatísticas' }).click();
  await page.getByLabel('Digite ZERAR para confirmar').fill('ZERAR');
  await page.getByRole('button', { name: 'Confirmar reset do histórico' }).click();
  await expect(page.getByText(/Histórico zerado com sucesso/)).toBeVisible();
  const resetBytes = await snapshot(page);
  await page.getByLabel('Importar progresso', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Prévia da importação' })).toBeVisible();
  expect(await snapshot(page)).toEqual(resetBytes);
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  expect(await currentSession(page)).toEqual(state);
  expect(await metrics(page)).toEqual(beforeMetrics);
});

test('red team: an official attempt open in another tab cannot bring back reset completions', async ({
  page,
  context,
}) => {
  const ongoing = createAttempt(other, now, 'ongoing');
  const old = transition(other, createAttempt(other, '2026-10-05T16:00:00.000Z', 'old'), {
    type: 'finish',
    now: '2026-10-05T17:00:00.000Z',
  });
  await seed(page, [
    [storageKey(other), JSON.stringify({ storageVersion: 3, current: ongoing })],
    [historyStorageKey(other), JSON.stringify({ storageVersion: 3, history: [summary(old)] })],
    [reviewStorageKey(other), JSON.stringify({ storageVersion: 1, attempts: [old] })],
  ]);
  const official = await context.newPage();
  await official.goto(`?exam=${other.id}`);
  await expect(official.getByRole('radio').first()).toBeVisible();
  await page.goto('?view=dashboard');
  await page.getByRole('button', { name: 'Zerar histórico e estatísticas' }).click();
  await page.getByLabel('Digite ZERAR para confirmar').fill('ZERAR');
  await page.getByRole('button', { name: 'Confirmar reset do histórico' }).click();
  await expect(page.getByText(/Histórico zerado com sucesso/)).toBeVisible();
  await official.getByRole('radio').first().check();
  expect((await snapshot(official))[historyStorageKey(other)]).toBeUndefined();
  await official.getByRole('button', { name: 'Finalizar tentativa', exact: true }).click();
  await official.getByRole('button', { name: 'Confirmar finalização', exact: true }).click();
  await expect(
    official.getByRole('button', { name: 'Revisar respostas', exact: true }),
  ).toBeVisible();
  const result = await snapshot(official);
  expect(
    JSON.parse(result[historyStorageKey(other)]!).history.map((h: { id: string }) => h.id),
  ).toEqual(['ongoing']);
  expect(
    JSON.parse(result[reviewStorageKey(other)]!).attempts.map((a: { id: string }) => a.id),
  ).toEqual(['ongoing']);
  await official.close();
});
