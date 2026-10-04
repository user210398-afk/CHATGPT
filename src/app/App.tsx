import { useCallback } from 'react';
import { loadCatalog, loadExam } from '../engine/exam-loader';
import { ExamPage } from '../components/exam/ExamPage';
import { sitePath } from '../utils/paths';
import { CatalogPage } from './CatalogPage';
import { useResource } from './useResource';
import { useTheme } from './theme';
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
function CatalogRoute() {
  const { data, error } = useResource(catalogLoader);
  return data ? <CatalogPage catalog={data} /> : <LoadMessage error={error} />;
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
  const id = new URLSearchParams(window.location.search).get('exam');
  const { theme, toggleTheme, warning } = useTheme();
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
          O tema foi aplicado, mas não pôde ser salvo neste navegador.
        </p>
      )}
      <main id="main" className="main-container" tabIndex={-1}>
        {id !== null ? <ExamRoute id={id} /> : <CatalogRoute />}
      </main>
      <footer className="app-footer">
        <span>MedSim · Aprender é uma prática contínua.</span>
        <a href={sitePath('legacy/index.html')}>Acervo legado</a>
      </footer>
    </>
  );
}
