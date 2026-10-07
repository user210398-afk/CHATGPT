import { useMemo, useState } from 'react';
import type { Catalog } from '../../schema/catalog';
import { AnalyticsFilters } from '../components/dashboard/AnalyticsFilters';
import { PerformanceTrendChart } from '../components/dashboard/PerformanceTrendChart';
import { SubjectPerformanceChart } from '../components/dashboard/SubjectPerformanceChart';
import { StudyRhythmChart } from '../components/dashboard/StudyRhythmChart';
import { PerformanceInsights } from '../components/dashboard/PerformanceInsights';
import { analyzePerformance, defaultAnalyticsFilters } from '../engine/analytics';
import { compareCodeUnits } from '../engine/analytics-reader';
import { HistoryResetControls } from '../components/dashboard/HistoryResetControls';
import { Metrics } from '../components/dashboard/Metrics';
import { SubjectCards } from '../components/dashboard/SubjectCards';
import { RecentActivity } from '../components/dashboard/RecentActivity';
import { BackupControls } from '../components/settings/BackupControls';
import { settingsUrl, sitePath, reviewUrl } from '../utils/paths';
import { useDashboardState } from './useDashboardState';
export function DashboardPage({ catalog }: { catalog: Catalog }) {
  const state = useDashboardState(catalog);
  const [filters, setFilters] = useState({ ...defaultAnalyticsFilters });
  const analysis = useMemo(
    () => analyzePerformance(state.analytics.attempts, filters, state.now),
    [state.analytics, filters, state.now],
  );
  const subjects = useMemo(
    () => [...new Set(catalog.exams.map((exam) => exam.subject))].sort(compareCodeUnits),
    [catalog],
  );
  return (
    <div className="page-stack dashboard-page">
      <header className="page-heading">
        <p className="eyebrow">SEU PROGRESSO LOCAL</p>
        <h1>Meu desempenho</h1>
        <p className="muted">
          Resultados salvos neste navegador. Dissertativas não recebem nota automática.
        </p>
      </header>
      {state.unavailable && (
        <p role="status" className="notice">
          O progresso local está indisponível neste navegador.
        </p>
      )}
      <section aria-labelledby="overview-title">
        <div className="dashboard-section-heading">
          <h2 id="overview-title">Panorama geral</h2>
          <span className="muted small">Todo o progresso local · sem filtros</span>
        </div>
        <Metrics metrics={state.metrics} unavailable={state.unavailable} />
        {state.includesStudy && state.includesExam && (
          <p className="muted small">
            As métricas atuais incluem tentativas em Modo Prova e Modo Estudo.
          </p>
        )}
      </section>
      <section className="analytics-evolution" aria-labelledby="evolution-title">
        <p className="eyebrow">RESULTADOS AO LONGO DO TEMPO</p>
        <h2 id="evolution-title">Evolução</h2>
        <p className="muted">Os filtros abaixo afetam os gráficos e as leituras analíticas.</p>
        <AnalyticsFilters filters={filters} subjects={subjects} onChange={setFilters} />
        {state.analytics.coverage === 'unavailable' ? (
          <p role="status" className="notice">
            Analytics indisponível: não foi possível acessar o progresso local. Resultados: —
          </p>
        ) : (
          <>
            {state.analytics.coverage === 'partial' && (
              <div role="status" className="notice analytics-coverage">
                <strong>Cobertura parcial</strong>
                <p>
                  Fontes inválidas ou conflitantes foram excluídas. As leituras usam apenas dados
                  oficiais válidos; nenhum registro foi alterado.
                </p>
                <ul>
                  {state.analytics.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <dl className="analytics-summary" aria-label="Estatísticas do recorte">
              <div>
                <dt>Tentativas neste recorte</dt>
                <dd>{analysis.attempts.length}</dd>
              </div>
              <div>
                <dt>Resultados pontuados</dt>
                <dd>{analysis.scoredCount}</dd>
              </div>
              <div>
                <dt>Média do recorte</dt>
                <dd>
                  {analysis.average === null
                    ? '—'
                    : `${analysis.average.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
                </dd>
              </div>
            </dl>
            <PerformanceTrendChart series={analysis.series} />
            <div className="analytics-complements">
              <SubjectPerformanceChart
                subjects={analysis.subjects}
                onSelect={(subject) => setFilters({ ...filters, subject })}
              />
              <StudyRhythmChart buckets={analysis.buckets} period={filters.period} />
            </div>
          </>
        )}
        <p className="muted small analytics-limitations">
          Dados locais deste navegador, somente da revisão atualmente publicada. Revisões antigas
          não são projetadas na revisão atual. Dissertativas não recebem nota automática; médias e
          tendências usam apenas tentativas pontuadas.
        </p>
      </section>
      {state.analytics.coverage !== 'unavailable' && (
        <PerformanceInsights insights={analysis.insights} />
      )}
      <SubjectCards subjects={state.subjects} />
      <RecentActivity items={state.recent} />
      <section aria-labelledby="quick-title">
        <h2 id="quick-title">Ações rápidas</h2>
        <div className="actions">
          <a className="button" href={sitePath('')}>
            Ir para catálogo
          </a>
          <a className="button" href={reviewUrl()}>
            Revisar questões
          </a>
          <a className="button" href={settingsUrl()}>
            Configurações
          </a>
        </div>
      </section>
      <BackupControls catalog={catalog} />
      <HistoryResetControls catalog={catalog} onReset={state.refresh} />
    </div>
  );
}
