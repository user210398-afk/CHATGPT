import { useMemo } from 'react';
import type { Catalog } from '../../schema/catalog';
import { CatalogFilters } from '../components/catalog/CatalogFilters';
import { ExamCard } from '../components/catalog/ExamCard';
import { SubjectCard } from '../components/catalog/SubjectCard';
import { groupCatalogExams, subjectHubTotals, type SubjectGroup } from '../engine/subject-groups';
import { allExamsUrl, sitePath } from '../utils/paths';
import { useCatalogState } from './useCatalogState';

function CatalogBreadcrumb({ title }: { title: string }) {
  return (
    <nav className="catalog-breadcrumb" aria-label="Breadcrumb">
      <ol>
        <li>
          <a href={sitePath('')}>Matérias</a>
        </li>
        <li>
          <span aria-hidden="true">›</span> <span aria-current="page">{title}</span>
        </li>
      </ol>
    </nav>
  );
}

function SubjectHub({ catalog }: { catalog: Catalog }) {
  const state = useCatalogState(catalog);
  const groups = useMemo(
    () =>
      groupCatalogExams(
        catalog.exams,
        new Map(state.allItems.map((item) => [item.exam.id, item.progress])),
      ),
    [catalog, state.allItems],
  );
  const totals = subjectHubTotals(groups);
  return (
    <>
      <header className="catalog-heading">
        <p className="eyebrow">PRÁTICA MÉDICA, MATÉRIA POR MATÉRIA</p>
        <h1>
          Escolha o que
          <br />
          você quer estudar.
        </h1>
        <p className="muted">
          Acesse uma matéria para encontrar seus simulados, acompanhar o progresso e continuar de
          onde parou.
        </p>
      </header>
      <section aria-labelledby="subjects-title">
        <div className="catalog-toolbar">
          <div>
            <h2 id="subjects-title">Suas matérias</h2>
            <p className="muted small">
              {totals.subjectCount} matérias · {totals.examCount} simulados · {totals.questionCount}{' '}
              questões
            </p>
          </div>
          <a className="button" href={allExamsUrl()}>
            Ver todos os simulados
          </a>
        </div>
        {state.warning && (
          <p role="status" className="notice">
            {state.warning}
          </p>
        )}
        <div className="subject-grid">
          {groups.map((group) => (
            <SubjectCard key={group.id} group={group} />
          ))}
        </div>
        {groups.length === 0 && (
          <p role="status" className="card">
            Nenhuma matéria disponível.
          </p>
        )}
      </section>
    </>
  );
}

function ExamCatalog({ catalog, group }: { catalog: Catalog; group?: SubjectGroup }) {
  const state = useCatalogState(catalog);
  const totals = useMemo(
    () => group ?? subjectHubTotals(groupCatalogExams(catalog.exams)),
    [catalog, group],
  );
  return (
    <>
      <CatalogBreadcrumb title={group?.title ?? 'Todos os simulados'} />
      <header className="page-heading">
        <h1>{group?.title ?? 'Todos os simulados'}</h1>
        <p className="muted">
          {totals.examCount} simulados · {totals.questionCount} questões
        </p>
      </header>
      <section aria-labelledby="catalog-title">
        <div className="catalog-toolbar">
          <div>
            <h2 id="catalog-title">{group ? 'Simulados da matéria' : 'Suas provas'}</h2>
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
          showSubject={!group}
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

export function CatalogPage({
  catalog,
  mode = 'hub',
  area,
}: {
  catalog: Catalog;
  mode?: 'hub' | 'all';
  area?: string;
}) {
  const group = useMemo(
    () =>
      area === undefined
        ? undefined
        : groupCatalogExams(catalog.exams).find((item) => item.id === area),
    [catalog, area],
  );
  const scopedCatalog = useMemo(
    () => (group ? { ...catalog, exams: group.exams } : catalog),
    [catalog, group],
  );
  if (area !== undefined && !group)
    return (
      <section className="card">
        <h1>Matéria não encontrada.</h1>
        <a className="button" href={sitePath('')}>
          Voltar para Matérias
        </a>
      </section>
    );
  if (group || mode === 'all')
    return <ExamCatalog key={group?.id ?? 'all'} catalog={scopedCatalog} group={group} />;
  return <SubjectHub catalog={catalog} />;
}
