import { z } from 'zod';
import type { StorageAdapter } from './persistence';
export const catalogPreferencesKey = 'chatgpt-exams:v1:catalog-preferences';
export const catalogPreferencesSchema = z.strictObject({
  storageVersion: z.literal(1),
  favorites: z
    .array(
      z
        .string()
        .min(1)
        .refine((id) => id.trim().length > 0),
    )
    .refine((ids) => new Set(ids).size === ids.length),
});
export type CatalogPreferences = z.infer<typeof catalogPreferencesSchema>;
export class CatalogPreferencesRepository {
  constructor(private readonly storage: () => StorageAdapter = () => window.localStorage) {}
  load(): { preferences: CatalogPreferences; warning: string | null } {
    const empty: CatalogPreferences = { storageVersion: 1, favorites: [] };
    try {
      const raw = this.storage().getItem(catalogPreferencesKey);
      if (raw === null) return { preferences: empty, warning: null };
      const parsed = catalogPreferencesSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return { preferences: parsed.data, warning: null };
      return {
        preferences: empty,
        warning: 'Os favoritos locais não puderam ser lidos. O registro existente foi preservado.',
      };
    } catch {
      return {
        preferences: empty,
        warning:
          'Os favoritos estão indisponíveis neste navegador. Nenhuma preferência foi alterada.',
      };
    }
  }
  setFavorite(id: string, favorite: boolean): ReturnType<CatalogPreferencesRepository['load']> {
    const loaded = this.load();
    if (loaded.warning) return loaded;
    const favorites = favorite
      ? [...new Set([...loaded.preferences.favorites, id])]
      : loaded.preferences.favorites.filter((item) => item !== id);
    const parsed = catalogPreferencesSchema.safeParse({ storageVersion: 1, favorites });
    if (!parsed.success) return { ...loaded, warning: 'Não foi possível alterar este favorito.' };
    try {
      this.storage().setItem(catalogPreferencesKey, JSON.stringify(parsed.data));
      return { preferences: parsed.data, warning: null };
    } catch {
      return {
        ...loaded,
        warning: 'O favorito não foi alterado: o navegador não conseguiu salvar a preferência.',
      };
    }
  }
}
