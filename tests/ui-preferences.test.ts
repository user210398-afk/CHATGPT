import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyInitialPreferences,
  applyUiPreferences,
  defaultUiPreferences,
  effectiveTheme,
  legacyThemeKey,
  readUiPreferences,
  saveUiPreferences,
  uiPreferencesKey,
  uiPreferencesSchema,
} from '../src/engine/ui-preferences';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('preferências versionadas e compatibilidade legada', () => {
  it('defaults e leitura nunca migram ou escrevem', () => {
    const setItem = vi.fn(),
      getItem = vi.fn(() => null);
    expect(readUiPreferences(() => ({ getItem }))).toEqual({
      preferences: defaultUiPreferences,
      state: 'missing',
      warning: null,
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem.mock.calls.length).toBe(2);
    expect(localStorage.length).toBe(0);
  });
  it.each(['light', 'dark'] as const)(
    'legacy %s preservado antes/depois de alteração explícita',
    (theme) => {
      const raw = JSON.stringify({ version: 1, theme });
      localStorage.setItem(legacyThemeKey, raw);
      expect(readUiPreferences().preferences.theme).toBe(theme);
      expect(localStorage.getItem(uiPreferencesKey)).toBeNull();
      saveUiPreferences({
        ...readUiPreferences().preferences,
        textSize: 'large',
        setupPrompt: 'completed',
      });
      expect(localStorage.getItem(legacyThemeKey)).toBe(raw);
      expect(readUiPreferences().preferences).toMatchObject({
        theme,
        textSize: 'large',
        setupPrompt: 'completed',
      });
    },
  );
  it('envelope novo válido precede o tema legado', () => {
    localStorage.setItem(legacyThemeKey, JSON.stringify({ version: 1, theme: 'dark' }));
    const preferences = {
      ...defaultUiPreferences,
      theme: 'light' as const,
      contrast: 'high' as const,
    };
    localStorage.setItem(uiPreferencesKey, JSON.stringify(preferences));
    expect(readUiPreferences()).toMatchObject({ state: 'valid', preferences });
  });
  it.each([
    '{bad',
    '{}',
    JSON.stringify({ ...defaultUiPreferences, storageVersion: 2 }),
    JSON.stringify({ ...defaultUiPreferences, unknown: true }),
    JSON.stringify({ ...defaultUiPreferences, theme: 'auto' }),
  ])('novo corrompido %s preservado na leitura e no save', (raw) => {
    localStorage.setItem(uiPreferencesKey, raw);
    localStorage.setItem(legacyThemeKey, JSON.stringify({ version: 1, theme: 'dark' }));
    expect(readUiPreferences()).toMatchObject({
      state: 'corrupt',
      preferences: defaultUiPreferences,
      warning: expect.any(String),
    });
    expect(saveUiPreferences({ ...defaultUiPreferences, textSize: 'large' })).toContain(
      'não pôde ser salva',
    );
    expect(localStorage.getItem(uiPreferencesKey)).toBe(raw);
  });
  it('storage bloqueado retorna defaults e falha de save honesta sem retry', () => {
    const getItem = vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem = vi.fn();
    expect(readUiPreferences(() => ({ getItem }))).toMatchObject({
      state: 'blocked',
      preferences: defaultUiPreferences,
    });
    expect(saveUiPreferences(defaultUiPreferences, () => ({ getItem, setItem }))).toContain(
      'Aplicada nesta sessão',
    );
    expect(setItem).not.toHaveBeenCalled();
    const writes = vi.fn(() => {
      throw new Error('quota');
    });
    expect(
      saveUiPreferences(defaultUiPreferences, () => ({ getItem: () => null, setItem: writes })),
    ).toContain('não pôde ser salva');
    expect(writes).toHaveBeenCalledTimes(1);
  });
  it.each(['pending', 'dismissed', 'completed'] as const)(
    'setupPrompt %s validado e persistido só em ação explícita',
    (setupPrompt) => {
      expect(saveUiPreferences({ ...defaultUiPreferences, setupPrompt })).toBeNull();
      expect(readUiPreferences().preferences.setupPrompt).toBe(setupPrompt);
    },
  );
  it.each([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
  ] as const)('tema %s com systemDark=%s resolve %s', (theme, systemDark, expected) =>
    expect(effectiveTheme({ ...defaultUiPreferences, theme }, systemDark)).toBe(expected),
  );
  it('aplica tudo em documentElement e não toca storage', () => {
    const preferences = {
      ...defaultUiPreferences,
      theme: 'dark' as const,
      textSize: 'large' as const,
      contrast: 'high' as const,
      density: 'compact' as const,
      reduceMotion: true,
      enhancedFocus: true,
    };
    applyUiPreferences(preferences, false);
    expect(document.documentElement.dataset).toMatchObject({
      theme: 'dark',
      textSize: 'large',
      contrast: 'high',
      density: 'compact',
      reducedMotion: 'true',
      enhancedFocus: 'true',
    });
    expect(localStorage.length).toBe(0);
  });
  it('preferências iniciais resolvem matchMedia antes de React, sem writes', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    applyInitialPreferences();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.length).toBe(0);
  });
  it.each(['normal', 'medium', 'large'] as const)(
    'textSize %s no schema e atributo global',
    (textSize) => {
      const preferences = uiPreferencesSchema.parse({ ...defaultUiPreferences, textSize });
      applyUiPreferences(preferences, false);
      expect(document.documentElement.dataset.textSize).toBe(textSize);
    },
  );
  it('defaults retornados são cópias, nunca mutam o contrato global', () => {
    readUiPreferences().preferences.textSize = 'large';
    expect(defaultUiPreferences.textSize).toBe('normal');
  });
});
