import { useCallback } from 'react';
import { loadCatalog, loadExam } from '../engine/exam-loader';
import { ExamPage } from '../components/exam/ExamPage';
import { sitePath, dashboardUrl, settingsUrl, resolveRoute } from '../utils/paths';
import { CatalogPage } from './CatalogPage';
import { useResource } from './useResource';
import { useUiPreferences, type UiPreferencesState } from './useUiPreferences';
import { DashboardPage } from './DashboardPage';
import { SettingsPage } from './SettingsPage';
import { SetupPrompt } from '../components/common/SetupPrompt';
const catalogLoader = (signal: AbortSignal) => loadCatalog(fetch, signal);
function LoadMessage({ error }: { error?: string }) {
  return error ? (
    <section className="card" role="alert">
      <h1>Não foi possível abrir esta página</h1>
      <p>{error}</p>
      <a href={sitePath('')}>Voltar ao catálogo</a>
    </section>
  ) : (
    <p role="status">Carregando…</p>
  );
}
function CatalogRoute({ view, ui }: { view: string; ui: UiPreferencesState }) {
  const { data, error } = useResource(catalogLoader);
  return data ? (
    <>
      {view !== 'settings' && <SetupPrompt ui={ui} />}
      {view === 'dashboard' ? (
        <DashboardPage catalog={data} />
      ) : view === 'settings' ? (
        <SettingsPage catalog={data} ui={ui} />
      ) : (
        <CatalogPage catalog={data} />
      )}
    </>
  ) : (
    <LoadMessage error={error} />
  );
}
function ExamRoute({ id }: { id: string }) {
  const loader = useCallback((signal: AbortSignal) => loadExam(id, fetch, signal), [id]);
  const { data, error } = useResource(loader);
  return data ? (
    <ExamPage key={`${data.id}:${data.revision}`} exam={data} />
  ) : (
    <LoadMessage error={error} />
  );
}
export function App() {
  const route = resolveRoute(window.location.search);
  const ui = useUiPreferences();
  const { theme, toggleTheme } = ui;
  const warning = ui.warning ?? (route.view === 'settings' ? ui.readWarning : null);
  return (
    <>
      <a className="skip-link" href="#main">
        Pular para o conteúdo
      </a>
      <header className="app-header">
        <div className="header-inner">
          <a href={sitePath('')} className="brand">
            <span className="brand-mark" aria-hidden="true">
              M
            </span>
            <span>
              MedSim<small>PRÁTICA MÉDICA</small>
            </span>
          </a>
          <nav className="app-nav" aria-label="Navegação principal">
            {(
              [
                ['catalog', 'Catálogo', sitePath('')],
                ['dashboard', 'Dashboard', dashboardUrl()],
                ['settings', 'Configurações', settingsUrl()],
              ] as const
            ).map(([view, label, href]) => (
              <a key={view} href={href} aria-current={route.view === view ? 'page' : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <span className="muted small header-caption">Seu tempo. Seu aprendizado.</span>
            <button aria-pressed={theme === 'dark'} onClick={toggleTheme}>
              {theme === 'dark' ? '☀ Tema claro' : '◐ Tema escuro'}
            </button>
          </div>
        </div>
      </header>
      {warning && (
        <p role="status" className="notice">
          {warning}
        </p>
      )}
      <main id="main" className="main-container" tabIndex={-1}>
        {route.view === 'exam' ? (
          <ExamRoute id={route.id!} />
        ) : (
          <CatalogRoute view={route.view} ui={ui} />
        )}
      </main>
      <footer className="app-footer">
        <span>MedSim · Aprender é uma prática contínua.</span>
        <a href={sitePath('legacy/index.html')}>Acervo legado</a>
      </footer>
    </>
  );
}
