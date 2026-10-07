import { lazy, Suspense, useCallback, useEffect } from 'react';
import { loadCatalog, loadExam } from '../engine/exam-loader';
import { ExamPage } from '../components/exam/ExamPage';
import {
  sitePath,
  dashboardUrl,
  settingsUrl,
  reviewUrl,
  resolveRoute,
  withReviewResume,
  errorNotebookUrl,
} from '../utils/paths';
import { CatalogPage } from './CatalogPage';
import { useResource } from './useResource';
import { useUiPreferences, type UiPreferencesState } from './useUiPreferences';
import { DashboardPage } from './DashboardPage';
import { ReviewSessionPage } from './ReviewSessionPage';
import { ReviewPage } from './ReviewPage';
import { SettingsPage } from './SettingsPage';
import { SetupPrompt } from '../components/common/SetupPrompt';
const catalogLoader = (signal: AbortSignal) => loadCatalog(fetch, signal);
const ErrorNotebookPage = lazy(() => import('./ErrorNotebookPage'));
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
      ) : view === 'error-notebook' ? (
        <Suspense fallback={<LoadMessage />}>
          <ErrorNotebookPage catalog={data} />
        </Suspense>
      ) : view === 'review' ? (
        <ReviewPage
          catalog={data}
          examId={resolveRoute(window.location.search).reviewExam}
          attemptId={resolveRoute(window.location.search).attempt}
        />
      ) : view === 'settings' ? (
        <SettingsPage catalog={data} ui={ui} />
      ) : (
        <CatalogPage
          catalog={data}
          area={resolveRoute(window.location.search).area}
          mode={resolveRoute(window.location.search).allExams ? 'all' : 'hub'}
        />
      )}
    </>
  ) : (
    <LoadMessage error={error} />
  );
}
function ExamRoute({
  id,
  ui,
  reviewSession = false,
}: {
  id: string;
  ui: UiPreferencesState;
  reviewSession?: boolean;
}) {
  const loader = useCallback((signal: AbortSignal) => loadExam(id, fetch, signal), [id]);
  const { data, error } = useResource(loader);
  return data ? (
    reviewSession ? (
      <ReviewSessionPage key={`${data.id}:${data.revision}`} exam={data} />
    ) : (
      <ExamPage
        key={`${data.id}:${data.revision}`}
        exam={data}
        preference={ui.preferences.attemptModePreference}
      />
    )
  ) : (
    <LoadMessage error={error} />
  );
}
export function App() {
  useEffect(() => {
    // Carry read-only positions across native document navigation, including keyboard links.
    function carryPosition(event: MouseEvent) {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.getAttribute('href')?.startsWith('#'))
        return;
      const url = new URL(anchor.href);
      if (
        url.origin === window.location.origin &&
        url.pathname === new URL(sitePath(''), window.location.href).pathname
      )
        anchor.href = withReviewResume(anchor.href);
    }
    document.addEventListener('click', carryPosition, true);
    document.addEventListener('auxclick', carryPosition, true);
    return () => {
      document.removeEventListener('click', carryPosition, true);
      document.removeEventListener('auxclick', carryPosition, true);
    };
  }, []);
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
                ['catalog', 'Matérias', sitePath('')],
                ['dashboard', 'Dashboard', dashboardUrl()],
                ['review', 'Revisão', reviewUrl()],
                ['error-notebook', 'Erros', errorNotebookUrl()],
                ['settings', 'Configurações', settingsUrl()],
              ] as const
            ).map(([view, label, href]) => (
              <a
                key={view}
                href={href}
                aria-current={
                  route.view === view || (view === 'review' && route.view === 'review-session')
                    ? 'page'
                    : undefined
                }
              >
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
        {route.view === 'review-session' ? (
          route.reviewExam ? (
            <ExamRoute id={route.reviewExam} ui={ui} reviewSession />
          ) : (
            <LoadMessage error="Prova de revisão inválida. O registro local foi preservado." />
          )
        ) : route.view === 'exam' ? (
          <ExamRoute id={route.id!} ui={ui} />
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
