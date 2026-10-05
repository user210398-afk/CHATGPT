import { useEffect, useState } from 'react';
import {
  applyUiPreferences,
  effectiveTheme,
  readUiPreferences,
  saveUiPreferences,
  type UiPreferences,
} from '../engine/ui-preferences';
export function useUiPreferences() {
  const [loaded] = useState(readUiPreferences);
  const [preferences, setPreferences] = useState(loaded.preferences);
  const [warning, setWarning] = useState<string | null>(null);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    applyUiPreferences(preferences, systemDark);
  }, [preferences, systemDark]);
  function update(patch: Partial<UiPreferences>) {
    const next = { ...preferences, ...patch, storageVersion: 1 as const };
    setPreferences(next);
    applyUiPreferences(next, systemDark);
    setWarning(saveUiPreferences(next));
  }
  const theme = effectiveTheme(preferences, systemDark);
  return {
    preferences,
    warning,
    readWarning: loaded.warning,
    theme,
    update,
    toggleTheme: () =>
      update({ theme: theme === 'dark' ? 'light' : 'dark', setupPrompt: 'completed' }),
    dismissSetup: () => update({ setupPrompt: 'dismissed' }),
  };
}
export type UiPreferencesState = ReturnType<typeof useUiPreferences>;
