import type { Catalog } from '../../schema/catalog';
import { BackupControls } from '../components/settings/BackupControls';
import { PreferenceControls } from '../components/settings/PreferenceControls';
import type { UiPreferencesState } from './useUiPreferences';
export function SettingsPage({ catalog, ui }: { catalog: Catalog; ui: UiPreferencesState }) {
  return (
    <div className="page-stack">
      <header className="page-heading">
        <h1>Configurações</h1>
        <p className="muted">
          Personalize aparência e acessibilidade. As alterações são aplicadas ao escolher cada
          opção.
        </p>
      </header>
      <PreferenceControls ui={ui} />
      <section aria-labelledby="data-title">
        <h2 id="data-title">Dados</h2>
        <BackupControls catalog={catalog} />
      </section>
    </div>
  );
}
