import { describe, expect, it, vi } from 'vitest';
import {
  CatalogPreferencesRepository,
  catalogPreferencesKey,
} from '../src/engine/catalog-preferences';
const repository = () => new CatalogPreferencesRepository();
describe('favoritos separados e defensivos', () => {
  it('ausência não escreve e retorna envelope vazio', () => {
    const setItem = vi.fn();
    const repo = new CatalogPreferencesRepository(() => ({ getItem: () => null, setItem }));
    expect(repo.load()).toEqual({
      preferences: { storageVersion: 1, favorites: [] },
      warning: null,
    });
    expect(setItem).not.toHaveBeenCalled();
  });
  it('lê envelope válido e preserva IDs desconhecidos', () => {
    localStorage.setItem(
      catalogPreferencesKey,
      JSON.stringify({ storageVersion: 1, favorites: ['unknown-id'] }),
    );
    expect(repository().load().preferences.favorites).toEqual(['unknown-id']);
    expect(repository().setFavorite('known-id', true).preferences.favorites).toEqual([
      'unknown-id',
      'known-id',
    ]);
  });
  it('adiciona, não duplica, remove e grava formato versionado', () => {
    const repo = repository();
    repo.setFavorite('exam', true);
    repo.setFavorite('exam', true);
    expect(JSON.parse(localStorage.getItem(catalogPreferencesKey)!)).toEqual({
      storageVersion: 1,
      favorites: ['exam'],
    });
    expect(repo.setFavorite('exam', false).preferences.favorites).toEqual([]);
    expect(repository().load().preferences.favorites).toEqual([]);
  });
  it.each([
    '{bad',
    '{}',
    '{"storageVersion":2,"favorites":[]}',
    '{"storageVersion":1,"favorites":[""]}',
    '{"storageVersion":1,"favorites":["   "]}',
    '{"storageVersion":1,"favorites":["a","a"]}',
    '{"storageVersion":1,"favorites":[4]}',
  ])('corrupção/schema inválido preserva bytes inclusive ao tentar favoritar: %s', (raw) => {
    localStorage.setItem(catalogPreferencesKey, raw);
    expect(repository().load().warning).toBeTruthy();
    expect(repository().setFavorite('exam', true).warning).toBeTruthy();
    expect(localStorage.getItem(catalogPreferencesKey)).toBe(raw);
  });
  it('getItem/getter falha sem lançar e não tenta setItem', () => {
    const setItem = vi.fn();
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const repo = new CatalogPreferencesRepository(() => ({ getItem: blocked, setItem }));
    expect(repo.load().warning).toBeTruthy();
    expect(repo.setFavorite('exam', true).warning).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
    expect(new CatalogPreferencesRepository(blocked).load().warning).toBeTruthy();
  });
  it('setItem falha e devolve preferências anteriores com aviso honesto', () => {
    const repo = new CatalogPreferencesRepository(() => ({
      getItem: () => JSON.stringify({ storageVersion: 1, favorites: ['old'] }),
      setItem: () => {
        throw new Error('quota');
      },
    }));
    expect(repo.setFavorite('new', true)).toEqual({
      preferences: { storageVersion: 1, favorites: ['old'] },
      warning: expect.stringContaining('não foi alterado'),
    });
  });
  it('toca somente a chave de preferências, nunca tentativa/history/tema', () => {
    const values = new Map<string, string>();
    const getItem = vi.fn((key: string) => values.get(key) ?? null);
    const setItem = vi.fn((key: string, value: string) => {
      values.set(key, value);
    });
    const repo = new CatalogPreferencesRepository(() => ({ getItem, setItem }));
    repo.setFavorite('exam', true);
    repo.setFavorite('exam', false);
    expect(getItem.mock.calls.every(([key]) => key === catalogPreferencesKey)).toBe(true);
    expect(setItem.mock.calls.every(([key]) => key === catalogPreferencesKey)).toBe(true);
  });
  it('não escreve ID inválido e não normaliza IDs já salvos', () => {
    expect(repository().setFavorite('', true).warning).toBeTruthy();
    localStorage.setItem(
      catalogPreferencesKey,
      JSON.stringify({ storageVersion: 1, favorites: [' unknown '] }),
    );
    expect(repository().setFavorite('new', true).preferences.favorites).toEqual([
      ' unknown ',
      'new',
    ]);
  });
});
