import { useEffect, useMemo, useState } from 'react';
import type { Catalog } from '../../schema/catalog';
import { RichContent } from '../components/common/RichContent';
import { dateTime } from '../components/dashboard/Metrics';
import {
  readErrorNotebook,
  filterNotebookItems,
  notebookCategories,
  notebookCounts,
  defaultNotebookFilters,
  lexical,
  type NotebookCategory,
  type NotebookSnapshot,
  type QuestionPerformance,
} from '../engine/error-notebook';
import { parseNotebookKey } from '../engine/error-notebook-storage';
import { sitePath, reviewUrl } from '../utils/paths';

const categories: [NotebookCategory, string][] = [
  ['all', 'Todas'],
  ['pending', 'Pendentes'],
  ['recurring', 'Recorrentes'],
  ['never-correct', 'Nunca acertei'],
  ['overcome', 'Superadas'],
];
const PAGE_SIZE = 50;
function PerformanceCard({ item }: { item: QuestionPerformance }) {
  const tags = notebookCategories(item);
  return (
    <article className="card notebook-question">
      <header>
        <p className="muted small">
          {item.subject} · {item.examTitle}
        </p>
        <h3>
          {/^quest[aã]o\b/i.test(item.questionLabel)
            ? item.questionLabel
            : `Questão ${item.questionLabel}`}
        </h3>
        <p className="muted small notebook-identity">
          ID: {item.questionId} · Versão {item.examRevision}
        </p>
      </header>
      <RichContent content={item.statement} />
      <div className="notebook-card-meta">
        <p>
          <strong>
            {item.wrongCount} {item.wrongCount === 1 ? 'erro' : 'erros'}
          </strong>{' '}
          em {item.answeredCount} {item.answeredCount === 1 ? 'resposta' : 'respostas'}
        </p>
        <p className="muted small">
          {item.chronologyTie ? 'Resultado no desempate por ID' : 'Último resultado respondido'}:{' '}
          {item.lastOutcome === 'correct' ? 'Correto' : 'Incorreto'}
          <br />
          Tentativa concluída em{' '}
          <time dateTime={item.lastAnsweredAttemptCompletedAt}>
            {dateTime(item.lastAnsweredAttemptCompletedAt)}
          </time>
        </p>
        <div className="notebook-tags" aria-label="Categorias da questão">
          {tags.pending && <span className="badge notebook-pending">Pendente</span>}
          {tags.recurring && <span className="badge">Recorrente</span>}
          {tags['never-correct'] && <span className="badge notebook-pending">Nunca acertei</span>}
          {tags.overcome && <span className="badge notebook-overcome">Superada</span>}
        </div>
      </div>
      {item.chronologyTie && (
        <p className="muted small">
          Há tentativas concluídas no mesmo instante. A ordem e as categorias usam o ID como
          desempate; não comprovam uma sequência temporal entre essas tentativas.
        </p>
      )}
      <details className="notebook-outcomes">
        <summary>Ver tentativas disponíveis ({item.answeredCount})</summary>
        <ol>
          {item.outcomes.map((outcome) => (
            <li key={outcome.attemptId}>
              <strong>{outcome.outcome === 'correct' ? 'Correto' : 'Incorreto'}</strong> ·{' '}
              {outcome.mode === 'study' ? 'Modo Estudo' : 'Modo Prova'}
              <br />
              Tentativa concluída em{' '}
              <time dateTime={outcome.attemptCompletedAt}>
                {dateTime(outcome.attemptCompletedAt)}
              </time>
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}

export default function ErrorNotebookPage({ catalog }: { catalog: Catalog }) {
  const [snapshot, setSnapshot] = useState<NotebookSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [filters, setFilters] = useState(defaultNotebookFilters);
  const [visible, setVisible] = useState(PAGE_SIZE);
  useEffect(() => {
    let controller: AbortController | null = null;
    let generation = 0;
    let active = true;
    async function read() {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal,
        token = ++generation;
      setLoading(true);
      try {
        const next = await readErrorNotebook(catalog, undefined, undefined, signal);
        if (active && !signal.aborted && generation === token) {
          setSnapshot(next);
          setFilters((previous) => ({
            ...previous,
            subject: next.items.some((item) => item.subject === previous.subject)
              ? previous.subject
              : '',
            examId: next.items.some((item) => item.examId === previous.examId)
              ? previous.examId
              : '',
          }));
          setVisible(PAGE_SIZE);
          setLoading(false);
        }
      } catch {
        if (active && !signal.aborted && generation === token) {
          setSnapshot({
            items: [],
            warnings: [],
            historical: [],
            attemptCount: 0,
            hasHistory: false,
            coverage: 'unavailable',
            error: 'Não foi possível carregar a análise. Os registros locais foram preservados.',
          });
          setLoading(false);
        }
      }
    }
    const onStorage = (event: StorageEvent) => {
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return;
      } catch {
        void read();
        return;
      }
      if (event.key === null || parseNotebookKey(event.key)) void read();
    };
    void read();
    window.addEventListener('pageshow', read);
    window.addEventListener('storage', onStorage);
    return () => {
      active = false;
      generation++;
      controller?.abort();
      window.removeEventListener('pageshow', read);
      window.removeEventListener('storage', onStorage);
    };
  }, [catalog, refresh]);
  const items = snapshot?.items ?? [];
  const counts = useMemo(() => notebookCounts(items), [items]);
  const filtered = useMemo(() => filterNotebookItems(items, filters), [items, filters]);
  const subjects = [...new Set(items.map((item) => item.subject))].sort(lexical);
  const exams = [
    ...new Map(
      items
        .filter((item) => !filters.subject || item.subject === filters.subject)
        .map((item) => [item.examId, item.examTitle]),
    ).entries(),
  ].sort(([a], [b]) => lexical(a, b));
  const analyzed =
    snapshot &&
    snapshot.coverage !== 'unavailable' &&
    (snapshot.attemptCount > 0 || !snapshot.hasHistory);
  const filteredActive = filters.category !== 'all' || Boolean(filters.subject || filters.examId);
  const emptyMessage = !snapshot
    ? ''
    : snapshot.coverage === 'unavailable'
      ? 'A análise está indisponível. Não foi possível determinar os erros.'
      : items.length && !filtered.length
        ? 'Nenhuma questão corresponde aos filtros atuais.'
        : !snapshot.hasHistory
          ? 'Nenhuma tentativa detalhada disponível ainda.'
          : !snapshot.attemptCount
            ? 'Há registros que não podem ser analisados por questão.'
            : 'Nenhum erro objetivo foi encontrado nas tentativas detalhadas disponíveis.';
  return (
    <div className="page-stack notebook-page">
      <header className="page-heading">
        <p className="eyebrow">CADERNO DE ERROS</p>
        <h1>Caderno de Erros</h1>
        <p>Veja os pontos que mais exigiram atenção nas suas tentativas concluídas.</p>
        <p className="muted small">
          Dados deste navegador: tentativas detalhadas disponíveis, sem garantia de histórico
          vitalício. Dissertativas não são classificadas automaticamente.
        </p>
        <button onClick={() => setRefresh((value) => value + 1)}>Atualizar análise</button>
      </header>
      {loading && (
        <p role="status" className="muted">
          {snapshot
            ? 'Atualizando análise… Os dados anteriores permanecem visíveis até a conclusão.'
            : 'Carregando análise…'}
        </p>
      )}
      {snapshot?.error && (
        <p className="notice" role="alert">
          {snapshot.error}
        </p>
      )}
      {snapshot && (
        <>
          <section className="card notebook-summary" aria-label="Resumo das fontes analisadas">
            <dl className="notebook-metrics">
              {(
                [
                  ['all', 'Com histórico de erro'],
                  ['pending', 'Pendentes'],
                  ['recurring', 'Recorrentes'],
                  ['never-correct', 'Nunca acertei'],
                  ['overcome', 'Superadas'],
                ] as const
              ).map(([key, label]) => (
                <div className="metric" key={key}>
                  <dt>{label}</dt>
                  <dd>{analyzed ? counts[key] : '—'}</dd>
                </div>
              ))}
            </dl>
            <p className="muted small">
              Nas tentativas detalhadas analisadas. “Nunca acertei” considera apenas essas
              tentativas. As categorias podem se sobrepor.
            </p>
          </section>
          <section className="notebook-filters" aria-labelledby="notebook-filters-title">
            <h2 id="notebook-filters-title">Encontre seus pontos de atenção</h2>
            <fieldset>
              <legend className="field-label">Categoria</legend>
              <div className="notebook-category-controls">
                {categories.map(([category, label]) => (
                  <button
                    key={category}
                    aria-pressed={filters.category === category}
                    onClick={() => {
                      setFilters({ ...filters, category });
                      setVisible(PAGE_SIZE);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="notebook-selects">
              <div className="setting-field">
                <label className="field-label" htmlFor="notebook-subject">
                  Matéria
                </label>
                <select
                  id="notebook-subject"
                  value={filters.subject}
                  onChange={(event) => {
                    setFilters({ ...filters, subject: event.target.value, examId: '' });
                    setVisible(PAGE_SIZE);
                  }}
                >
                  <option value="">Todas as matérias</option>
                  {subjects.map((subject) => (
                    <option key={subject}>{subject}</option>
                  ))}
                </select>
              </div>
              <div className="setting-field">
                <label className="field-label" htmlFor="notebook-exam">
                  Prova
                </label>
                <select
                  id="notebook-exam"
                  value={filters.examId}
                  onChange={(event) => {
                    setFilters({ ...filters, examId: event.target.value });
                    setVisible(PAGE_SIZE);
                  }}
                >
                  <option value="">Todas as provas</option>
                  {exams.map(([id, title]) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
          <section className="page-stack" aria-labelledby="notebook-results-title">
            <h2 id="notebook-results-title" className="notebook-results-count" aria-live="polite">
              {analyzed
                ? `${filteredActive ? `${filtered.length} de ${items.length}` : filtered.length} ${filtered.length === 1 ? 'questão' : 'questões'} com histórico de erro`
                : 'Questões — análise indisponível'}
            </h2>
            {!filtered.length && (
              <div className="card notebook-empty" role="status">
                <p>{emptyMessage}</p>
                <a className="button" href={sitePath('')}>
                  Voltar às matérias
                </a>
                {snapshot.hasHistory && (
                  <a className="button" href={reviewUrl()}>
                    Ver revisão
                  </a>
                )}
              </div>
            )}
            {filtered.slice(0, visible).map((item) => (
              <PerformanceCard
                key={JSON.stringify([item.examId, item.examRevision, item.questionId])}
                item={item}
              />
            ))}
            {filtered.length > visible && (
              <div className="actions">
                <button onClick={() => setVisible((count) => count + PAGE_SIZE)}>
                  Mostrar mais questões ({Math.min(PAGE_SIZE, filtered.length - visible)})
                </button>
              </div>
            )}
          </section>
          {(snapshot.warnings.length > 0 || snapshot.historical.length > 0) && (
            <section className="card notebook-coverage" aria-labelledby="notebook-coverage-title">
              <h2 id="notebook-coverage-title">Cobertura do histórico</h2>
              <p role="status" className="notice">
                A cobertura é parcial. Os contadores descrevem somente as tentativas detalhadas
                válidas que puderam ser analisadas.
              </p>
              {snapshot.warnings.length > 0 && (
                <ul>
                  {snapshot.warnings.map((warning, index) => (
                    <li key={index}>
                      <strong>
                        {catalog.exams.find((exam) => exam.id === warning.id)?.title ?? warning.id}{' '}
                        · versão {warning.revision}:
                      </strong>{' '}
                      {warning.message}
                    </li>
                  ))}
                </ul>
              )}
              {snapshot.historical.length > 0 && (
                <>
                  <h3>Versões históricas sem conteúdo disponível</h3>
                  <p className="muted">
                    Há registros de versões anteriores ou de provas fora do catálogo atual. O
                    conteúdo dessas versões não está disponível para análise por questão; elas não
                    entram nos contadores.
                  </p>
                  <ul>
                    {snapshot.historical.map((identity) => (
                      <li key={JSON.stringify([identity.id, identity.revision])}>
                        {catalog.exams.find((exam) => exam.id === identity.id)?.title ??
                          identity.id}{' '}
                        · versão {identity.revision}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
