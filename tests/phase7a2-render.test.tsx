import { storageFixtureJson } from './legacy-fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardPage } from '../src/app/DashboardPage';
import { SettingsPage } from '../src/app/SettingsPage';
import { useUiPreferences } from '../src/app/useUiPreferences';
import { SetupPrompt } from '../src/components/common/SetupPrompt';
import { App } from '../src/app/App';
import { storageKey, historyStorageKey } from '../src/engine/persistence';
import {
  defaultUiPreferences,
  legacyThemeKey,
  uiPreferencesKey,
} from '../src/engine/ui-preferences';
import { completedAttempt, testCatalog } from './catalog-fixtures';
import { resolveRoute, dashboardUrl, settingsUrl } from '../src/utils/paths';
import { poc } from './fixtures';
function SettingsFixture() {
  const ui = useUiPreferences();
  return (
    <>
      <SetupPrompt ui={ui} />
      <SettingsPage catalog={testCatalog} ui={ui} />
      {ui.warning && <p role="status">{ui.warning}</p>}
    </>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});
describe('dashboard renderizado', () => {
  it('sem progresso apresenta 8 métricas, disciplinas e ausência de atividade', () => {
    render(<DashboardPage catalog={testCatalog} />);
    expect(screen.getByRole('heading', { name: 'Meu desempenho' })).toBeInTheDocument();
    expect(document.querySelectorAll('.metric')).toHaveLength(8);
    expect(screen.getByText('Nenhuma atividade salva neste navegador.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para catálogo' })).toHaveAttribute(
      'href',
      '/CHATGPT/',
    );
    expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute(
      'href',
      settingsUrl(),
    );
    expect(localStorage.length).toBe(0);
  });
  it('pageshow reflete progresso salvo e atividade, sem ler Exams', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<DashboardPage catalog={testCatalog} />);
    localStorage.setItem(
      storageKey(poc),
      storageFixtureJson({ storageVersion: 2, current: completedAttempt() }),
    );
    fireEvent(window, new Event('pageshow'));
    expect(document.querySelector('.recent-list')).toHaveTextContent('Concluída · 5%');
    expect(screen.getByRole('link', { name: poc.title })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe('configurações e primeiro uso opcional', () => {
  it('labels nativos e ações de backup/file input', () => {
    render(<SettingsFixture />);
    for (const label of ['Tema', 'Tamanho do texto', 'Densidade', 'Contraste'])
      expect(screen.getByLabelText(label)).toHaveAccessibleName(label);
    expect(screen.getByRole('button', { name: 'Exportar progresso' })).toBeInTheDocument();
    expect(screen.getByLabelText('Importar progresso')).toHaveAttribute(
      'accept',
      '.json,application/json',
    );
    expect(screen.getByRole('link', { name: 'Configurar agora' })).toHaveAttribute(
      'href',
      settingsUrl(),
    );
  });
  it.each([
    ['Tema', 'dark', 'theme'],
    ['Tamanho do texto', 'large', 'textSize'],
    ['Densidade', 'compact', 'density'],
    ['Contraste', 'high', 'contrast'],
  ])('controle %s aplica globalmente, salva e conclui convite', async (label, value, key) => {
    render(<SettingsFixture />);
    await userEvent.setup().selectOptions(screen.getByLabelText(label), value);
    expect(document.documentElement.dataset[key]).toBe(value);
    expect(JSON.parse(localStorage.getItem(uiPreferencesKey)!)[key]).toBe(value);
    expect(JSON.parse(localStorage.getItem(uiPreferencesKey)!).setupPrompt).toBe('completed');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
  it.each([
    ['Reduzir movimentos', 'reducedMotion', 'reduceMotion'],
    ['Indicador de foco reforçado', 'enhancedFocus', 'enhancedFocus'],
  ])('checkbox %s aplica e salva', async (name, attribute, key) => {
    render(<SettingsFixture />);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: new RegExp(name) }));
    expect(document.documentElement.dataset[attribute]).toBe('true');
    expect(JSON.parse(localStorage.getItem(uiPreferencesKey)!)[key]).toBe(true);
  });
  it('Agora não oculta banner e persiste decisão; remount não reaparece', async () => {
    const view = render(<SettingsFixture />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Agora não' }));
    expect(
      screen.queryByText('Quer personalizar aparência e acessibilidade?'),
    ).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(uiPreferencesKey)!).setupPrompt).toBe('dismissed');
    view.unmount();
    render(<SettingsFixture />);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
  it('storage bloqueado aplica em memória e convite dispensa durante a sessão', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    render(<SettingsFixture />);
    await userEvent.setup().selectOptions(screen.getByLabelText('Tamanho do texto'), 'medium');
    expect(document.documentElement.dataset.textSize).toBe('medium');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Aplicada nesta sessão, mas não pôde ser salva',
    );
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
  it('UI corrompida preservada enquanto escolhas funcionam na sessão', async () => {
    localStorage.setItem(uiPreferencesKey, '{bad');
    render(<SettingsFixture />);
    await userEvent.setup().selectOptions(screen.getByLabelText('Tema'), 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(uiPreferencesKey)).toBe('{bad');
    expect(screen.getByRole('status')).toHaveTextContent('registro existente foi preservado');
  });
  it('Seguir sistema acompanha mudança do OS e escolha explícita passa a prevalecer', async () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      addEventListener: vi.fn((_event, listener) => listeners.add(listener)),
      removeEventListener: vi.fn((_event, listener) => listeners.delete(listener)),
    };
    vi.stubGlobal('matchMedia', () => media);
    const view = render(<SettingsFixture />);
    act(() => {
      media.matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    await userEvent.setup().selectOptions(screen.getByLabelText('Tema'), 'light');
    act(() => {
      media.matches = false;
      listeners.forEach((listener) => listener());
      media.matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    view.unmount();
    expect(listeners.size).toBe(0);
  });
  it('preview/cancelar não escrevem; só confirmação restaura e oferece reload', async () => {
    render(<SettingsFixture />);
    const input = {
      format: 'medsim-backup',
      version: 2,
      exportedAt: '2026-10-04T12:00:00.000Z',
      exams: [
        {
          examId: poc.id,
          revision: 1,
          current: null,
          reviewAttempts: [],
          history: [
            {
              id: 'old',
              mode: 'exam',
              startedAt: '2026-10-03T10:00:00.000Z',
              completedAt: '2026-10-03T11:00:00.000Z',
              result: completedAttempt().result,
            },
          ],
        },
      ],
      catalogPreferences: { storageVersion: 1, favorites: [poc.id] },
      uiPreferences: defaultUiPreferences,
    };
    const file = new File([storageFixtureJson(input)], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => storageFixtureJson(input) });
    fireEvent.change(screen.getByLabelText('Importar progresso'), { target: { files: [file] } });
    await screen.findByRole('heading', { name: 'Prévia da importação' });
    expect(localStorage.length).toBe(0);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(localStorage.length).toBe(0);
    fireEvent.change(screen.getByLabelText('Importar progresso'), { target: { files: [file] } });
    await screen.findByRole('heading', { name: 'Prévia da importação' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar importação' }));
    expect(screen.getByRole('status')).toHaveTextContent('Importação concluída');
    expect(screen.getByRole('button', { name: 'Recarregar para aplicar' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(historyStorageKey(poc))!).history).toHaveLength(1);
  });
  it('erro de arquivo aparece como alert e não grava storage', async () => {
    render(<SettingsFixture />);
    const file = new File(['{bad'], 'bad.json');
    Object.defineProperty(file, 'text', { value: async () => '{bad' });
    fireEvent.change(screen.getByLabelText('Importar progresso'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Backup inválido');
    expect(localStorage.length).toBe(0);
  });
});
describe('rotas e shell', () => {
  it.each([
    ['', 'catalog'],
    ['?view=other', 'catalog'],
    ['?view=dashboard', 'dashboard'],
    ['?view=settings', 'settings'],
    ['?exam=valid-id&view=settings', 'exam'],
    ['?exam=../bad&view=dashboard', 'dashboard'],
  ])('precedência/fallback de %s', (search, view) => expect(resolveRoute(search).view).toBe(view));
  it('paths respeitam Pages e aria-current apenas da página correspondente', async () => {
    expect(dashboardUrl()).toBe('/CHATGPT/?view=dashboard');
    expect(settingsUrl()).toBe('/CHATGPT/?view=settings');
    window.history.replaceState({}, '', dashboardUrl());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(storageFixtureJson(testCatalog))),
    );
    render(<App />);
    await screen.findByRole('heading', { name: 'Meu desempenho' });
    const nav = within(screen.getByRole('navigation', { name: 'Navegação principal' }));
    expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Catálogo' })).not.toHaveAttribute('aria-current');
  });
  it('atalho de tema sai de system para oposto efetivo e preserva legacy', async () => {
    localStorage.setItem(legacyThemeKey, storageFixtureJson({ version: 1, theme: 'dark' }));
    window.history.replaceState({}, '', settingsUrl());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(storageFixtureJson(testCatalog))),
    );
    render(<App />);
    await screen.findByRole('heading', { name: 'Configurações', level: 1 });
    await userEvent.setup().selectOptions(screen.getByLabelText('Tema'), 'system');
    const current = document.documentElement.dataset.theme;
    await userEvent.setup().click(screen.getByRole('button', { name: /Tema claro|Tema escuro/ }));
    expect(JSON.parse(localStorage.getItem(uiPreferencesKey)!).theme).toBe(
      current === 'dark' ? 'light' : 'dark',
    );
    expect(localStorage.getItem(legacyThemeKey)).toContain('dark');
  });
});
