import type { UiPreferencesState } from '../../app/useUiPreferences';
import { settingsUrl } from '../../utils/paths';
export function SetupPrompt({ ui }: { ui: UiPreferencesState }) {
  if (ui.preferences.setupPrompt !== 'pending') return null;
  return (
    <aside className="card setup-prompt" aria-label="Personalização opcional">
      <p>Quer personalizar aparência e acessibilidade?</p>
      <div className="actions">
        <a className="button" href={settingsUrl()}>
          Configurar agora
        </a>
        <button onClick={ui.dismissSetup}>Agora não</button>
      </div>
    </aside>
  );
}
