import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/app/App';
import { guidedTourSteps } from '../src/app/guided-tour';
import { resolveRoute } from '../src/utils/paths';
import { testCatalog } from './catalog-fixtures';
import { poc } from './fixtures';
import { createAttempt } from '../src/engine/exam-state';
import { storageKey, historyStorageKey, summary } from '../src/engine/persistence';
import { storageFixtureJson } from './legacy-fixtures';
import { session, source, tiny, tinyCatalog } from './phase7b2b-fixtures';
import { reviewSessionStorageKey } from '../src/engine/review-session-storage';
import { reviewStorageKey } from '../src/engine/review-history';
import { defaultUiPreferences, uiPreferencesKey } from '../src/engine/ui-preferences';
import { catalogPreferencesKey } from '../src/engine/catalog-preferences';

const catalog = { ...testCatalog, exams: [testCatalog.exams[0]!] };
beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/CHATGPT/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('exam-index') ? catalog : poc),
    })),
  );
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 30,
    right: 430,
    top: 40,
    bottom: 240,
    width: 400,
    height: 200,
    x: 30,
    y: 40,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const dialog = () => screen.getByRole('dialog');
const start = async () => {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Conhecer o MedSim' }));
  await screen.findByRole('dialog', { name: guidedTourSteps[0].title });
};
async function complete() {
  for (let index = 0; index < guidedTourSteps.length; index++) {
    expect(dialog()).toHaveAccessibleName(guidedTourSteps[index]!.title);
    expect(within(dialog()).getByText(new RegExp(`ETAPA ${index + 1} DE 7`))).toBeInTheDocument();
    expect(resolveRoute(window.location.search).view).not.toBe('exam');
    expect(resolveRoute(window.location.search).view).not.toBe('review-session');
    await userEvent
      .setup()
      .click(within(dialog()).getByRole('button', { name: index === 6 ? 'Concluir' : 'Próximo' }));
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

it.each([
  '',
  '?view=all',
  '?view=dashboard',
  '?view=review',
  '?view=error-notebook',
  '?view=settings',
  `?exam=${poc.id}`,
  '?view=review-session',
])('não inicia automaticamente na rota %s', async (search) => {
  window.history.replaceState(null, '', `/CHATGPT/${search}`);
  render(<App />);
  if (search !== '?view=review-session') await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Conhecer o MedSim' })).toBeVisible();
  expect(window.location.search).toBe(search);
});

it('início explícito, sete páginas reais, saída, restauração da URL e reabertura sem escritas', async () => {
  const original = '/CHATGPT/?view=settings&custom=preserved#main';
  window.history.replaceState({ preserved: true }, '', original);
  localStorage.setItem('academic-sentinel', '{raw-data');
  sessionStorage.setItem('scratch-sentinel', 'preserved');
  const set = vi.spyOn(Storage.prototype, 'setItem');
  const remove = vi.spyOn(Storage.prototype, 'removeItem');
  const clear = vi.spyOn(Storage.prototype, 'clear');
  const historyLength = window.history.length;
  render(<App />);
  await start();
  expect(document.getElementById('app-surface')).toHaveAttribute('inert');
  expect(document.body.style.overflow).toBe('hidden');
  for (let index = 0; index < 7; index++) {
    await waitFor(() =>
      expect(document.querySelector(guidedTourSteps[index]!.target)).not.toBeNull(),
    );
    await waitFor(() => expect(document.querySelector('.tour-spotlight')).not.toBeNull());
    if (index < 6)
      await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Próximo' }));
  }
  await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Concluir' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Conhecer o MedSim' })).toHaveFocus(),
  );
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(original);
  expect(window.history.state).toEqual({
    preserved: true,
    medsimGuidedTour: {
      version: 1,
      step: 6,
      active: false,
      originalUrl: new URL(original, window.location.href).href,
    },
  });
  expect(window.history.length).toBe(historyLength + 1);
  expect(document.body.style.overflow).toBe('');
  await start();
  await complete();
  expect(localStorage.getItem('academic-sentinel')).toBe('{raw-data');
  expect(sessionStorage.getItem('scratch-sentinel')).toBe('preserved');
  expect(set).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
});

it('teclado mantém foco, percorre etapas nos dois sentidos e Escape devolve o foco', async () => {
  render(<App />);
  const user = userEvent.setup();
  await start();
  expect(within(dialog()).getByRole('heading')).toHaveFocus();
  expect(within(dialog()).getByRole('button', { name: 'Anterior' })).toBeDisabled();
  await user.tab({ shift: true });
  expect(within(dialog()).getByRole('button', { name: 'Sair' })).toHaveFocus();
  await user.tab();
  expect(within(dialog()).getByRole('button', { name: 'Próximo' })).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(dialog()).toHaveAccessibleName(guidedTourSteps[1].title);
  expect(within(dialog()).getByRole('heading')).toHaveFocus();
  await user.tab();
  expect(within(dialog()).getByRole('button', { name: 'Anterior' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(within(dialog()).getByRole('button', { name: 'Sair' })).toHaveFocus();
  await user.keyboard('{ArrowLeft}');
  expect(dialog()).toHaveAccessibleName(guidedTourSteps[0].title);
  await user.keyboard('{Escape}');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Conhecer o MedSim' })).toHaveFocus(),
  );
  expect(document.getElementById('app-surface')).not.toHaveAttribute('inert');
});

it('Sair encerra uma etapa intermediária e recomeça do início', async () => {
  render(<App />);
  await start();
  await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Próximo' }));
  await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Sair' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await start();
  expect(dialog()).toHaveAccessibleName(guidedTourSteps[0].title);
});

it('alvo removido não trava o fluxo', async () => {
  render(<App />);
  await start();
  document.querySelector('.brand')!.remove();
  await screen.findByText(/O destaque desta etapa está indisponível/);
  await complete();
});

it('uma página lenta não impede navegação ou saída', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
  render(<App />);
  await start();
  await complete();
});

it('catálogo vazio e armazenamento indisponível permitem completar sem escritas', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ schemaVersion: 1, exams: [] }) })),
  );
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('unexpected write');
  });
  render(<App />);
  await start();
  await complete();
  expect(write).not.toHaveBeenCalled();
});

it('erro de carregamento mantém saída e navegação acessíveis', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline');
    }),
  );
  render(<App />);
  await start();
  await complete();
});

it('preserva a prova montada e a tentativa ao percorrer e sair', async () => {
  localStorage.setItem(
    storageKey(poc),
    storageFixtureJson({ storageVersion: 2, current: createAttempt(poc), history: [] }),
  );
  const raw = localStorage.getItem(storageKey(poc));
  window.history.replaceState(null, '', `/CHATGPT/?exam=${poc.id}`);
  render(<App />);
  const question = await screen.findByRole('heading', { name: 'Questão 1 de 30' });
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  await start();
  expect(question).toBeInTheDocument();
  expect(question).not.toBeVisible();
  await complete();
  expect(screen.getByRole('heading', { name: 'Questão 1 de 30' })).toBe(question);
  expect(window.location.search).toBe(`?exam=${poc.id}`);
  expect(localStorage.getItem(storageKey(poc))).toBe(raw);
  expect(writes).not.toHaveBeenCalled();
});

it('preserva a sessão de revisão montada, sua URL e todos os registros', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('exam-index') ? tinyCatalog : tiny),
    })),
  );
  localStorage.setItem(storageKey(tiny), JSON.stringify({ storageVersion: 3, current: source() }));
  localStorage.setItem(
    reviewSessionStorageKey(tiny),
    JSON.stringify({ storageVersion: 1, session: session() }),
  );
  const before = { ...localStorage };
  window.history.replaceState(null, '', `/CHATGPT/?view=review-session&reviewExam=${tiny.id}`);
  render(<App />);
  const question = await screen.findByRole('heading', { name: 'Questão 1 de 3 da sessão' });
  const original = window.location.href;
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  await start();
  await complete();
  expect(screen.getByRole('heading', { name: 'Questão 1 de 3 da sessão' })).toBe(question);
  expect(window.location.href).toBe(original);
  expect({ ...localStorage }).toEqual(before);
  expect(writes).not.toHaveBeenCalled();
});

it('desmontagem restaura estilos e popstate encerra sem reabrir o tour', async () => {
  document.body.style.overflow = 'auto';
  const view = render(<App />);
  await start();
  window.history.replaceState(null, '', '/CHATGPT/?view=dashboard');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(window.location.search).toBe('?view=dashboard');
  await start();
  view.unmount();
  expect(document.body.style.overflow).toBe('auto');
  document.body.style.overflow = '';
});

it('push inicial preserva o estado original e replace de etapas não cria entradas extras', async () => {
  const existing = {
    navigation: { position: 7, resume: ['keep'] },
    otherNamespace: { active: true },
  };
  window.history.replaceState(existing, '', '/CHATGPT/?view=settings&reviewPosition=2#appearance');
  const originalUrl = window.location.href;
  const length = window.history.length;
  const push = vi.spyOn(window.history, 'pushState');
  render(<App />);
  await start();
  expect(push).toHaveBeenCalledTimes(1);
  expect(window.history.length).toBe(length + 1);
  expect(window.history.state).toEqual({
    ...existing,
    medsimGuidedTour: { version: 1, step: 0, active: true, originalUrl },
  });
  // A consumer may update its own state while this entry is active.
  window.history.replaceState(
    { ...window.history.state, otherNamespace: { active: false, preserved: 'new' } },
    '',
    window.location.href,
  );
  await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Próximo' }));
  expect(window.history.state.navigation).toEqual(existing.navigation);
  expect(window.history.state.otherNamespace).toEqual({ active: false, preserved: 'new' });
  expect(window.history.state.medsimGuidedTour.step).toBe(1);
  expect(push).toHaveBeenCalledTimes(1);
  expect(window.history.length).toBe(length + 1);
});

it('reload remonta na etapa intermediária e restaura pathname, query e hash ao sair', async () => {
  const original =
    '/CHATGPT/?view=settings&reviewPosition=2&reviewResume=%5B%5D&custom=a%2Bb#appearance';
  window.history.replaceState({ resume: { preserved: true } }, '', original);
  const originalUrl = window.location.href;
  const view = render(<App />);
  await start();
  await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Próximo' }));
  await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Próximo' }));
  const length = window.history.length;
  view.unmount();
  render(<App />);
  expect(dialog()).toHaveAccessibleName(guidedTourSteps[2].title);
  expect(window.location.search).toBe('?view=all');
  expect(window.history.state.medsimGuidedTour.originalUrl).toBe(originalUrl);
  expect(window.history.length).toBe(length);
  await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Sair' }));
  expect(window.location.href).toBe(originalUrl);
  await screen.findByRole('heading', { name: 'Configurações' });
  expect(window.history.state.resume).toEqual({ preserved: true });
});

it('Back volta à entrada original e Forward recupera a última etapa sem loops', async () => {
  const existing = { resume: { token: 'preserved' } };
  window.history.replaceState(existing, '', '/CHATGPT/?view=settings&custom=keep#main');
  const originalUrl = window.location.href;
  const length = window.history.length;
  render(<App />);
  await start();
  await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Próximo' }));
  await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Próximo' }));
  for (let cycle = 0; cycle < 2; cycle++) {
    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.href).toBe(originalUrl);
    expect(window.history.state).toEqual(existing);
    await screen.findByRole('heading', { name: 'Configurações' });
    window.history.forward();
    await screen.findByRole('dialog', { name: guidedTourSteps[2].title });
    expect(window.location.search).toBe('?view=all');
    expect(window.history.state.resume).toEqual(existing.resume);
    expect(window.history.length).toBe(length + 1);
  }
});

it.each(['Sair', 'Concluir'])(
  '%s desativa a entrada e impede recuperação por Forward ou reload',
  async (action) => {
    window.history.replaceState(
      { navigation: 'preserved' },
      '',
      '/CHATGPT/?view=settings&custom=keep#main',
    );
    const originalUrl = window.location.href;
    const view = render(<App />);
    await start();
    if (action === 'Concluir') {
      for (let index = 0; index < 6; index++)
        await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Próximo' }));
    } else await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Próximo' }));
    await userEvent.setup().click(within(dialog()).getByRole('button', { name: action }));
    expect(window.location.href).toBe(originalUrl);
    expect(window.history.state.medsimGuidedTour.active).toBe(false);
    const length = window.history.length;
    window.history.back();
    await waitFor(() => expect(window.history.state).toEqual({ navigation: 'preserved' }));
    window.history.forward();
    await waitFor(() => expect(window.history.state.medsimGuidedTour?.active).toBe(false));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.history.length).toBe(length);
    view.unmount();
    render(<App />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.href).toBe(originalUrl);
    expect(window.history.state.navigation).toBe('preserved');
  },
);

const validContext = () => ({
  version: 1,
  step: 2,
  originalUrl: new URL('/CHATGPT/?view=settings#main', window.location.href).href,
  active: true,
});
it.each([
  ['ausente', null],
  ['primitivo', 'invalid'],
  ['array', []],
  ['campo nulo', { medsimGuidedTour: null }],
  ['encerrado', { medsimGuidedTour: { ...validContext(), active: false } }],
  ['versão desconhecida', { medsimGuidedTour: { ...validContext(), version: 2 } }],
  ['versão string', { medsimGuidedTour: { ...validContext(), version: '1' } }],
  ['ativo string', { medsimGuidedTour: { ...validContext(), active: 'true' } }],
  ['etapa negativa', { medsimGuidedTour: { ...validContext(), step: -1 } }],
  ['etapa fora do limite', { medsimGuidedTour: { ...validContext(), step: 7 } }],
  ['etapa fracionária', { medsimGuidedTour: { ...validContext(), step: 2.5 } }],
  ['etapa string', { medsimGuidedTour: { ...validContext(), step: '2' } }],
  ['campo extra', { medsimGuidedTour: { ...validContext(), unexpected: true } }],
  [
    'origem externa',
    { medsimGuidedTour: { ...validContext(), originalUrl: 'https://example.com/CHATGPT/' } },
  ],
  [
    'origem com credenciais',
    {
      medsimGuidedTour: {
        ...validContext(),
        originalUrl: 'http://user:password@localhost:3000/CHATGPT/',
      },
    },
  ],
  [
    'origem fora do aplicativo',
    { medsimGuidedTour: { ...validContext(), originalUrl: 'http://localhost:3000/legacy/' } },
  ],
  ['origem relativa', { medsimGuidedTour: { ...validContext(), originalUrl: '/CHATGPT/' } }],
  [
    'origem script',
    { medsimGuidedTour: { ...validContext(), originalUrl: 'javascript:alert(1)' } },
  ],
  ['origem malformada', { medsimGuidedTour: { ...validContext(), originalUrl: 'not a URL' } }],
])('contexto %s não inicia nem altera histórico ou storage', async (_name, state) => {
  window.history.replaceState(state, '', '/CHATGPT/?view=all');
  const push = vi.spyOn(window.history, 'pushState');
  const replace = vi.spyOn(window.history, 'replaceState');
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  render(<App />);
  await screen.findByRole('heading', { name: 'Todos os simulados' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(window.history.state).toEqual(state);
  expect(push).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
});

it.each(['?view=dashboard', '?view=all&extra=adulterated', '?view=all#injected'])(
  'URL %s incompatível com a etapa não recupera contexto',
  async (search) => {
    window.history.replaceState({ medsimGuidedTour: validContext() }, '', `/CHATGPT/${search}`);
    render(<App />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.search + window.location.hash).toBe(search);
  },
);

it('parâmetros recebidos em links não iniciam nem recuperam o tour', async () => {
  window.history.replaceState(
    null,
    '',
    '/CHATGPT/?view=all&medsimGuidedTour=active&step=2&originalUrl=https%3A%2F%2Fexample.com',
  );
  render(<App />);
  await screen.findByRole('heading', { name: 'Todos os simulados' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('trocar etapa reinicia o scroll do painel e mantém foco no título', async () => {
  render(<App />);
  await start();
  const panel = dialog();
  panel.scrollTop = 300;
  panel.scrollLeft = 20;
  await userEvent.setup().click(within(panel).getByRole('button', { name: 'Próximo' }));
  expect(dialog()).toBe(panel);
  expect(panel.scrollTop).toBe(0);
  expect(panel.scrollLeft).toBe(0);
  expect(within(panel).getByRole('heading')).toHaveFocus();
  panel.scrollTop = 120;
  await userEvent.setup().keyboard('{ArrowLeft}');
  expect(panel.scrollTop).toBe(0);
  expect(within(panel).getByRole('heading')).toHaveFocus();
});

it('reload, Back, Forward e saída preservam tentativas, histórico, resultados, sessões e preferências', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('exam-index') ? tinyCatalog : tiny),
    })),
  );
  localStorage.setItem(storageKey(tiny), JSON.stringify({ storageVersion: 3, current: source() }));
  localStorage.setItem(
    historyStorageKey(tiny),
    JSON.stringify({ storageVersion: 2, history: [summary(source())] }),
  );
  localStorage.setItem(
    reviewStorageKey(tiny),
    JSON.stringify({ storageVersion: 1, attempts: [source()] }),
  );
  localStorage.setItem(
    reviewSessionStorageKey(tiny),
    JSON.stringify({ storageVersion: 1, session: session() }),
  );
  localStorage.setItem(
    uiPreferencesKey,
    JSON.stringify({ ...defaultUiPreferences, setupPrompt: 'dismissed' }),
  );
  localStorage.setItem(
    catalogPreferencesKey,
    JSON.stringify({ storageVersion: 1, favorites: [tiny.id] }),
  );
  sessionStorage.setItem('scratch-sentinel', 'unchanged');
  const before = { local: { ...localStorage }, session: { ...sessionStorage } };
  const set = vi.spyOn(Storage.prototype, 'setItem');
  const remove = vi.spyOn(Storage.prototype, 'removeItem');
  const clear = vi.spyOn(Storage.prototype, 'clear');
  window.history.replaceState(
    { positions: { keep: true } },
    '',
    `/CHATGPT/?view=review-session&reviewExam=${tiny.id}&reviewPosition=1#main`,
  );
  const originalUrl = window.location.href;
  const view = render(<App />);
  await screen.findByRole('heading', { name: 'Questão 2 de 3 da sessão' });
  await start();
  for (let index = 0; index < 4; index++)
    await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Próximo' }));
  view.unmount();
  render(<App />);
  expect(dialog()).toHaveAccessibleName(guidedTourSteps[4].title);
  window.history.back();
  await screen.findByRole('heading', { name: 'Questão 2 de 3 da sessão' });
  expect(window.location.href).toBe(originalUrl);
  window.history.forward();
  await screen.findByRole('dialog', { name: guidedTourSteps[4].title });
  await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Sair' }));
  await screen.findByRole('heading', { name: 'Questão 2 de 3 da sessão' });
  expect(window.history.state.positions).toEqual({ keep: true });
  expect({ local: { ...localStorage }, session: { ...sessionStorage } }).toEqual(before);
  expect(set).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
});
