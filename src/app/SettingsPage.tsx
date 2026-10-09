import type { Catalog } from '../../schema/catalog';
import { BackupControls } from '../components/settings/BackupControls';
import { PreferenceControls } from '../components/settings/PreferenceControls';
import type { UiPreferencesState } from './useUiPreferences';
import { PwaInstallPrompt } from '../components/common/PwaInstallPrompt';
import type { PwaInstallState } from '../pwa/usePwaInstall';
export function SettingsPage({
  catalog,
  ui,
  pwa,
}: {
  catalog: Catalog;
  ui: UiPreferencesState;
  pwa?: PwaInstallState;
}) {
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
      {pwa && <PwaInstallPrompt pwa={pwa} settings />}
      <section aria-labelledby="data-title">
        <h2 id="data-title">Dados</h2>
        <BackupControls catalog={catalog} />
      </section>
    </div>
  );
}
