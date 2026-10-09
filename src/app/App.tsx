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
import { GuidedTour } from '../components/common/GuidedTour';
import { useGuidedTour } from './useGuidedTour';
import { usePwaInstall, type PwaInstallState } from '../pwa/usePwaInstall';
import { PwaInstallPrompt } from '../components/common/PwaInstallPrompt';
import { ConnectivityNotice } from '../pwa/ConnectivityNotice';
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
function CatalogRoute({
  route,
  ui,
  pwa,
  touring = false,
}: {
  route: ReturnType<typeof resolveRoute>;
  ui: UiPreferencesState;
  pwa: PwaInstallState;
  touring?: boolean;
}) {
  const { view } = route;
  const { data, error } = useResource(catalogLoader);
  return data ? (
    <>
      {view !== 'settings' && !touring && <SetupPrompt ui={ui} />}
      {view === 'dashboard' ? (
        <DashboardPage catalog={data} />
      ) : view === 'error-notebook' ? (
        <Suspense fallback={<LoadMessage />}>
          <ErrorNotebookPage catalog={data} />
        </Suspense>
      ) : view === 'review' ? (
        <ReviewPage catalog={data} examId={route.reviewExam} attemptId={route.attempt} />
      ) : view === 'settings' ? (
        <SettingsPage catalog={data} ui={ui} pwa={touring ? undefined : pwa} />
      ) : (
        <CatalogPage
          catalog={data}
          area={route.area}
          mode={route.allExams ? 'all' : 'hub'}
          homePrompt={
            view === 'catalog' &&
            !route.area &&
            !route.allExams &&
            !touring &&
            ui.preferences.setupPrompt !== 'pending' && <PwaInstallPrompt pwa={pwa} />
          }
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
  const pwa = usePwaInstall();
  const tour = useGuidedTour();
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
  const route = resolveRoute(tour.pageSearch);
  const visibleRoute = tour.route ?? route;
  const ui = useUiPreferences();
  const { theme, toggleTheme } = ui;
  const warning = ui.warning ?? (route.view === 'settings' ? ui.readWarning : null);
  return (
    <>
      <div id="app-surface" inert={!!tour.step} aria-hidden={tour.step ? true : undefined}>
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
                    visibleRoute.view === view ||
                    (view === 'review' && visibleRoute.view === 'review-session')
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
              <button
                className="tour-trigger"
                ref={tour.trigger}
                onClick={tour.start}
                aria-haspopup="dialog"
              >
                Conhecer o MedSim
              </button>
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
          <ConnectivityNotice />
          {/* Keep active solving mounted: a tour must not flush drafts or restart an attempt. */}
          {(route.view === 'exam' || route.view === 'review-session') && (
            <div hidden={!!tour.step}>
              {route.view === 'review-session' ? (
                route.reviewExam ? (
                  <ExamRoute id={route.reviewExam} ui={ui} reviewSession />
                ) : (
                  <LoadMessage error="Prova de revisão inválida. O registro local foi preservado." />
                )
              ) : (
                <ExamRoute id={route.id!} ui={ui} />
              )}
            </div>
          )}
          {(tour.route || (route.view !== 'exam' && route.view !== 'review-session')) && (
            <div id={tour.route ? 'tour-content' : undefined}>
              <CatalogRoute route={visibleRoute} ui={ui} pwa={pwa} touring={!!tour.step} />
            </div>
          )}
        </main>
        <footer className="app-footer">
          <span>MedSim · Aprender é uma prática contínua.</span>
          <a href={sitePath('legacy/index.html')}>Acervo legado</a>
        </footer>
      </div>
      {tour.step && <GuidedTour tour={tour} />}
    </>
  );
}
