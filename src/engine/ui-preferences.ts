import { z } from 'zod';
import type { StorageAdapter } from './persistence';
export const uiPreferencesKey = 'chatgpt-exams:v1:ui-preferences';
export const legacyThemeKey = 'chatgpt-exams:preferences:v1';
export const uiPreferencesV1Schema = z.strictObject({
  storageVersion: z.literal(1),
  theme: z.enum(['system', 'light', 'dark']),
  textSize: z.enum(['normal', 'medium', 'large']),
  contrast: z.enum(['standard', 'high']),
  reduceMotion: z.boolean(),
  density: z.enum(['comfortable', 'compact']),
  enhancedFocus: z.boolean(),
  setupPrompt: z.enum(['pending', 'dismissed', 'completed']),
});
export const uiPreferencesSchema = uiPreferencesV1Schema.extend({
  storageVersion: z.literal(2),
  attemptModePreference: z.enum(['ask', 'exam', 'study']),
});
export const readableUiPreferencesSchema = z.union([
  uiPreferencesSchema,
  uiPreferencesV1Schema.transform((value) => ({
    ...value,
    storageVersion: 2 as const,
    attemptModePreference: 'ask' as const,
  })),
]);
export type UiPreferences = z.infer<typeof uiPreferencesSchema>;
export const defaultUiPreferences: UiPreferences = {
  storageVersion: 2,
  attemptModePreference: 'ask',
  theme: 'system',
  textSize: 'normal',
  contrast: 'standard',
  reduceMotion: false,
  density: 'comfortable',
  enhancedFocus: false,
  setupPrompt: 'pending',
};
export const legacyThemeSchema = z.strictObject({
  version: z.literal(1),
  theme: z.enum(['light', 'dark']),
});
export function readUiPreferences(
  storage: () => Pick<StorageAdapter, 'getItem'> = () => window.localStorage,
) {
  const defaults = { ...defaultUiPreferences };
  try {
    const raw = storage().getItem(uiPreferencesKey);
    if (raw !== null) {
      const parsed = readableUiPreferencesSchema.safeParse(JSON.parse(raw));
      if (parsed.success)
        return { preferences: parsed.data, state: 'valid' as const, warning: null };
      return {
        preferences: defaults,
        state: 'corrupt' as const,
        warning: 'As configurações locais são incompatíveis. O registro existente foi preservado.',
      };
    }
    const legacy = storage().getItem(legacyThemeKey);
    const parsed = legacy === null ? null : legacyThemeSchema.safeParse(JSON.parse(legacy));
    return {
      preferences: parsed?.success ? { ...defaults, theme: parsed.data.theme } : defaults,
      state: 'missing' as const,
      warning: null,
    };
  } catch (error) {
    return {
      preferences: defaults,
      state: error instanceof SyntaxError ? ('corrupt' as const) : ('blocked' as const),
      warning:
        'As configurações locais não puderam ser lidas. O registro existente foi preservado.',
    };
  }
}
export function saveUiPreferences(
  preferences: UiPreferences,
  storage: () => StorageAdapter = () => window.localStorage,
): string | null {
  try {
    const raw = storage().getItem(uiPreferencesKey);
    if (raw !== null && !readableUiPreferencesSchema.safeParse(JSON.parse(raw)).success)
      return 'Aplicada nesta sessão, mas não pôde ser salva: o registro incompatível foi preservado.';
    storage().setItem(uiPreferencesKey, JSON.stringify(uiPreferencesSchema.parse(preferences)));
    return null;
  } catch {
    return 'Aplicada nesta sessão, mas não pôde ser salva. O registro existente foi preservado.';
  }
}
export function effectiveTheme(preferences: UiPreferences, systemDark: boolean): 'light' | 'dark' {
  return preferences.theme === 'system' ? (systemDark ? 'dark' : 'light') : preferences.theme;
}
export function applyUiPreferences(
  preferences: UiPreferences,
  systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
) {
  const data = document.documentElement.dataset;
  data.theme = effectiveTheme(preferences, systemDark);
  data.textSize = preferences.textSize;
  data.contrast = preferences.contrast;
  data.density = preferences.density;
  data.reducedMotion = String(preferences.reduceMotion);
  data.enhancedFocus = String(preferences.enhancedFocus);
}
export function applyInitialPreferences() {
  applyUiPreferences(readUiPreferences().preferences);
}
