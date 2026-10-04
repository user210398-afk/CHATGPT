import { useState } from 'react';
import type { Catalog } from '../../schema/catalog';
import { examUrl } from '../utils/paths';
const normalize = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
export function CatalogPage({ catalog }: { catalog: Catalog }) {
  const [query, setQuery] = useState('');
  const exams = catalog.exams.filter((exam) =>
    normalize(
      [exam.title, exam.subject, exam.division, exam.year, ...exam.tags].join(' '),
    ).includes(normalize(query.trim())),
  );
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
            <p className="muted small">
              {catalog.exams.length} provas disponíveis · progresso salvo neste navegador
            </p>
          </div>
          <div className="search">
            <label htmlFor="search">Buscar por tema, disciplina ou ano</label>
            <input
              id="search"
              type="search"
              placeholder="Ex.: fisiologia, hipófise…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="catalog-grid">
          {exams.map((exam) => (
            <article className="card exam-card" key={exam.id}>
              <div className="card-meta">
                <span className="badge">{exam.subject}</span>
                <span className="muted small">{exam.year ?? 'Ano não informado'}</span>
              </div>
              <p className="eyebrow division">{exam.division}</p>
              <h3>{exam.title}</h3>
              <p className="muted">
                {exam.description ||
                  `${exam.objectiveCount} objetivas · ${exam.essayCount} dissertativas`}
              </p>
              <div className="exam-card-footer">
                <span className="small">{exam.questionCount} questões</span>
                <a className="button primary" href={examUrl(exam.id)}>
                  Abrir prova <span aria-hidden="true">↗</span>
                </a>
              </div>
            </article>
          ))}
        </div>
        {exams.length === 0 && (
          <p role="status" className="card">
            Nenhuma prova encontrada. Tente outro termo.
          </p>
        )}
      </section>
    </>
  );
}
