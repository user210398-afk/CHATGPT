import type { Catalog } from '../../schema/catalog';
import { Metrics } from '../components/dashboard/Metrics';
import { SubjectCards } from '../components/dashboard/SubjectCards';
import { RecentActivity } from '../components/dashboard/RecentActivity';
import { BackupControls } from '../components/settings/BackupControls';
import { settingsUrl, sitePath } from '../utils/paths';
import { useDashboardState } from './useDashboardState';
export function DashboardPage({ catalog }: { catalog: Catalog }) {
  const state = useDashboardState(catalog);
  return (
    <div className="page-stack">
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
      <Metrics metrics={state.metrics} />
      <SubjectCards subjects={state.subjects} />
      <RecentActivity items={state.recent} />
      <section aria-labelledby="quick-title">
        <h2 id="quick-title">Ações rápidas</h2>
        <div className="actions">
          <a className="button" href={sitePath('')}>
            Ir para catálogo
          </a>
          <a className="button" href={settingsUrl()}>
            Configurações
          </a>
        </div>
      </section>
      <BackupControls catalog={catalog} />
    </div>
  );
}
