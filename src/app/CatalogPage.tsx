import type { Catalog } from '../../schema/catalog';
import { CatalogFilters } from '../components/catalog/CatalogFilters';
import { ExamCard } from '../components/catalog/ExamCard';
import { useCatalogState } from './useCatalogState';
export function CatalogPage({ catalog }: { catalog: Catalog }) {
  const state = useCatalogState(catalog);
  return (
    <>
      <header className="catalog-heading">
        <p className="eyebrow">PRÁTICA MÉDICA, QUESTÃO POR QUESTÃO</p>
        <h1>
          Um espaço para
          <br />
          consolidar o que você sabe.
        </h1>
        <p className="muted">
          Escolha uma prova, pratique no seu ritmo e volte aos pontos que merecem atenção.
        </p>
      </header>
      <section aria-labelledby="catalog-title">
        <div className="catalog-toolbar">
          <div>
            <h2 id="catalog-title">Suas provas</h2>
            <p className="muted small" aria-live="polite" aria-atomic="true">
              {state.active
                ? `${state.items.length} de ${catalog.exams.length} provas`
                : `${catalog.exams.length} provas disponíveis`}
            </p>
          </div>
        </div>
        <CatalogFilters
          catalog={catalog}
          filters={state.filters}
          onChange={state.setFilters}
          active={state.active}
          onClear={state.clearFilters}
        />
        {state.warning && (
          <p role="status" className="notice">
            {state.warning}
          </p>
        )}
        <div className="catalog-grid">
          {state.items.map((item) => (
            <ExamCard key={item.exam.id} item={item} onFavorite={state.toggleFavorite} />
          ))}
        </div>
        {state.items.length === 0 && (
          <p role="status" className="card">
            Nenhuma prova encontrada. Tente outro termo ou limpe os filtros.
          </p>
        )}
      </section>
    </>
  );
}
