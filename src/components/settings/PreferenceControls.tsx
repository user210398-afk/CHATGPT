import type { UiPreferencesState } from '../../app/useUiPreferences';
import type { UiPreferences } from '../../engine/ui-preferences';
type SelectKey = 'theme' | 'textSize' | 'density' | 'contrast';
const selectOptions: Record<
  SelectKey,
  { label: string; help: string; options: [string, string][] }
> = {
  theme: {
    label: 'Tema',
    help: 'Seguir sistema acompanha a aparência do dispositivo.',
    options: [
      ['system', 'Seguir sistema'],
      ['light', 'Claro'],
      ['dark', 'Escuro'],
    ],
  },
  textSize: {
    label: 'Tamanho do texto',
    help: 'Amplia a leitura em todas as páginas.',
    options: [
      ['normal', 'Normal'],
      ['medium', 'Médio'],
      ['large', 'Grande'],
    ],
  },
  density: {
    label: 'Densidade',
    help: 'Ajusta os espaços, mantendo controles tocáveis.',
    options: [
      ['comfortable', 'Confortável'],
      ['compact', 'Compacta'],
    ],
  },
  contrast: {
    label: 'Contraste',
    help: 'Alto contraste reforça texto, bordas e estados.',
    options: [
      ['standard', 'Padrão'],
      ['high', 'Alto contraste'],
    ],
  },
};
export function PreferenceControls({ ui }: { ui: UiPreferencesState }) {
  function select(key: SelectKey) {
    const { label, help, options } = selectOptions[key];
    return (
      <div className="setting-field" key={key}>
        <label className="field-label" htmlFor={`setting-${key}`}>
          {label}
        </label>
        <p className="muted small" id={`help-${key}`}>
          {help}
        </p>
        <select
          id={`setting-${key}`}
          aria-describedby={`help-${key}`}
          value={ui.preferences[key]}
          onChange={(event) =>
            ui.update({
              [key]: event.target.value,
              setupPrompt: 'completed',
            } as Partial<UiPreferences>)
          }
        >
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <>
      <section className="card" aria-labelledby="appearance-title">
        <h2 id="appearance-title">Aparência</h2>
        <div className="settings-grid">
          {(['theme', 'textSize', 'density'] as const).map(select)}
        </div>
      </section>
      <section className="card" aria-labelledby="accessibility-title">
        <h2 id="accessibility-title">Acessibilidade</h2>
        {select('contrast')}
        <label className="setting-check">
          <input
            type="checkbox"
            checked={ui.preferences.reduceMotion}
            onChange={(event) =>
              ui.update({ reduceMotion: event.target.checked, setupPrompt: 'completed' })
            }
          />
          <span>
            Reduzir movimentos
            <small className="muted">
              Reduz transições. A preferência do sistema é sempre respeitada.
            </small>
          </span>
        </label>
        <label className="setting-check">
          <input
            type="checkbox"
            checked={ui.preferences.enhancedFocus}
            onChange={(event) =>
              ui.update({ enhancedFocus: event.target.checked, setupPrompt: 'completed' })
            }
          />
          <span>
            Indicador de foco reforçado
            <small className="muted">Destaca ainda mais a navegação por teclado.</small>
          </span>
        </label>
      </section>
    </>
  );
}
