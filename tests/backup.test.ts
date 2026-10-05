import { storageFixtureJson } from './legacy-fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backupSchema,
  confirmImport,
  exportBackup,
  MAX_BACKUP_BYTES,
  mergeExam,
  parseBackup,
  prepareImport,
  type Backup,
  type BackupExam,
  type BackupStorage,
} from '../src/engine/backup';
import { readBackupFile, downloadBackup } from '../src/engine/backup-browser';
import { createAttempt, transition } from '../src/engine/exam-state';
import {
  historyStorageKey,
  storageKey,
  summary,
  HISTORY_LIMIT,
  AttemptRepository,
} from '../src/engine/persistence';
import { catalogPreferencesKey } from '../src/engine/catalog-preferences';
import {
  defaultUiPreferences,
  legacyThemeKey,
  uiPreferencesKey,
} from '../src/engine/ui-preferences';
import { catalogExam, completedAttempt } from './catalog-fixtures';
import { poc } from './fixtures';
import { readExamProgress } from '../src/engine/catalog-progress';
import { aggregateGlobalMetrics } from '../src/engine/dashboard-metrics';
const catalog = { schemaVersion: 1 as const, exams: [catalogExam] };
const now = '2026-10-04T12:00:00.000Z';
function memory(entries: [string, string][] = []) {
  const values = new Map(entries);
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}
const loader = () => vi.fn(async () => poc);
function entry(
  current = null as BackupExam['current'],
  history = [] as BackupExam['history'],
): BackupExam {
  return { examId: poc.id, revision: poc.revision, current, history, reviewAttempts: [] };
}
function backup(exams: BackupExam[] = [], favorites: string[] = []): Backup {
  return {
    format: 'medsim-backup',
    version: 2,
    exportedAt: now,
    exams,
    catalogPreferences: { storageVersion: 1, favorites },
    uiPreferences: {
      ...defaultUiPreferences,
      theme: 'dark',
      textSize: 'large',
      setupPrompt: 'completed',
    },
  };
}
const storeCurrent = (current: unknown) =>
  [storageKey(poc), storageFixtureJson({ storageVersion: 2, current })] as [string, string];
const storeHistory = (history: unknown[]) =>
  [historyStorageKey(poc), storageFixtureJson({ storageVersion: 2, history })] as [string, string];
afterEach(() => vi.restoreAllMocks());
describe('exportação normalizada, completa e read-only', () => {
  it('backup vazio inclui defaults e somente chaves conhecidas, sem carregar provas', async () => {
    const store = memory([
        ['third-party', 'secret'],
        ['simulado_fisio_state', 'legacy'],
      ]),
      load = loader();
    const exported = await exportBackup(catalog, store, load, now);
    expect(exported).toEqual({ ...backup(), uiPreferences: defaultUiPreferences });
    expect(load).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
    expect(storageFixtureJson(exported)).not.toMatch(
      /secret|third-party|legacy|questions|correctAnswer|modelAnswer|explanations/,
    );
  });
  it.each(['open', 'completed'] as const)(
    'current %s validado academicamente com v2 sem writes',
    async (state) => {
      const current = state === 'open' ? createAttempt(poc, now) : completedAttempt();
      const store = memory([storeCurrent(current)]),
        load = loader();
      const before = [...store.values];
      const result = await exportBackup(catalog, store, load, now);
      expect(result.exams).toEqual([
        {
          ...entry(current, state === 'completed' ? [summary(current)] : []),
          reviewAttempts: state === 'completed' ? [current] : [],
        },
      ]);
      expect(load).toHaveBeenCalledTimes(1);
      expect(load).toHaveBeenCalledWith(poc.id);
      expect([...store.values]).toEqual(before);
      expect(store.setItem).not.toHaveBeenCalled();
    },
  );
  it('v1 normaliza current e históricos compactos sem migrar o envelope', async () => {
    const current = createAttempt(poc, now),
      past = completedAttempt();
    const raw = storageFixtureJson({ storageVersion: 1, current, history: [past] });
    const store = memory([[storageKey(poc), raw]]);
    expect((await exportBackup(catalog, store, loader(), now)).exams).toEqual([
      entry(current, [summary(past)]),
    ]);
    expect(store.values.get(storageKey(poc))).toBe(raw);
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('history isolado válido dispensa Exams completos e preserva favoritos/UI', async () => {
    const store = memory([
        storeHistory([summary(completedAttempt())]),
        [
          catalogPreferencesKey,
          storageFixtureJson({ storageVersion: 1, favorites: [poc.id, 'future-exam'] }),
        ],
        [uiPreferencesKey, storageFixtureJson(backup().uiPreferences)],
      ]),
      load = loader();
    const result = await exportBackup(catalog, store, load, now);
    expect(result.catalogPreferences.favorites).toEqual([poc.id, 'future-exam']);
    expect(result.uiPreferences).toEqual(backup().uiPreferences);
    expect(load).not.toHaveBeenCalled();
  });
  it.each(['light', 'dark'])('tema legado %s normalizado apenas em memória', async (theme) => {
    const store = memory([[legacyThemeKey, storageFixtureJson({ version: 1, theme })]]);
    expect((await exportBackup(catalog, store, loader(), now)).uiPreferences?.theme).toBe(theme);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.values.size).toBe(1);
  });
  const invalidCurrents = [
    { ...createAttempt(poc, now), answers: { absent: 'answer' } },
    { ...createAttempt(poc, now), answers: { [poc.questions[0]!.id]: 'option-999' } },
    { ...createAttempt(poc, now), examRevision: 999 },
    { ...createAttempt(poc, now), flagged: ['absent'] },
    { ...completedAttempt(), result: { ...completedAttempt().result!, percentage: 100 } },
  ];
  it.each(invalidCurrents)(
    'current incompatível aborta e identifica prova: %j',
    async (current) => {
      const store = memory([storeCurrent(current)]),
        before = [...store.values];
      await expect(exportBackup(catalog, store, loader(), now)).rejects.toThrow(catalogExam.title);
      expect([...store.values]).toEqual(before);
      expect(store.setItem).not.toHaveBeenCalled();
    },
  );
  it.each([
    storageKey(poc),
    historyStorageKey(poc),
    catalogPreferencesKey,
    uiPreferencesKey,
    legacyThemeKey,
  ])('chave corrompida %s aborta exportação, sem arquivo parcial', async (key) => {
    const store = memory([[key, '{bad']]);
    await expect(exportBackup(catalog, store, loader(), now)).rejects.toThrow(
      'Exportação abortada',
    );
    expect(store.values.get(key)).toBe('{bad');
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('v1 histórico com resposta inválida e história compacta impossível são rejeitados', async () => {
    const current = createAttempt(poc, now),
      invalid = { ...completedAttempt(), answers: { unknown: '1' } };
    await expect(
      exportBackup(
        catalog,
        memory([
          [storageKey(poc), storageFixtureJson({ storageVersion: 1, current, history: [invalid] })],
        ]),
        loader(),
        now,
      ),
    ).rejects.toThrow('incompatível');
    const past = summary(completedAttempt());
    past.result.correct = 999;
    await expect(
      exportBackup(catalog, memory([storeHistory([past])]), loader(), now),
    ).rejects.toThrow('incompatível');
  });
  it('history duplicado ou colisão current/history aborta em vez de perder dados', async () => {
    const past = summary(completedAttempt());
    await expect(
      exportBackup(catalog, memory([storeHistory([past, past])]), loader(), now),
    ).rejects.toThrow('incompatível');
    const other = { ...past, completedAt: now };
    await expect(
      exportBackup(
        catalog,
        memory([storeCurrent(completedAttempt()), storeHistory([other])]),
        loader(),
        now,
      ),
    ).rejects.toThrow('incompatível');
  });
  it('falha de leitura e erro de loader abortam sem write', async () => {
    const store = memory([storeCurrent(createAttempt(poc, now))]);
    await expect(
      exportBackup(
        catalog,
        store,
        async () => {
          throw new Error('HTTP 404');
        },
        now,
      ),
    ).rejects.toThrow('Exportação abortada');
    store.getItem.mockImplementation(() => {
      throw new Error('SecurityError');
    });
    await expect(exportBackup(catalog, store, loader(), now)).rejects.toThrow(
      'Exportação abortada',
    );
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('alteração durante load não exporta snapshot misturado', async () => {
    const store = memory([storeCurrent(createAttempt(poc, now))]);
    await expect(
      exportBackup(
        catalog,
        store,
        async () => {
          store.values.set(storageKey(poc), '{changed');
          return poc;
        },
        now,
      ),
    ).rejects.toThrow('mudou');
  });
  it('Blob local tem nome versionado e object URL é revogado', async () => {
    const create = vi.fn(() => 'blob:local'),
      revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('medsim-backup-2026-10-04.json');
    });
    downloadBackup(backup());
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(revoke).toHaveBeenCalledWith('blob:local');
    vi.unstubAllGlobals();
  });
});
describe('schema estrito e limites de importação', () => {
  it.each([
    '{bad',
    '{}',
    storageFixtureJson({ ...backup(), format: 'other' }),
    storageFixtureJson({ ...backup(), version: 3 }),
    storageFixtureJson({ ...backup(), unknown: true }),
    storageFixtureJson({ ...backup(), exportedAt: 'yesterday' }),
  ])('rejeita JSON/formato/version/datas/unknown keys %s', (text) =>
    expect(() => parseBackup(text)).toThrow('Backup inválido'),
  );
  it.each([
    backup([entry(), entry()]),
    backup([entry(null, [summary(completedAttempt()), summary(completedAttempt())])]),
    { ...backup(), uiPreferences: { ...backup().uiPreferences, unknown: 1 } },
    { ...backup(), catalogPreferences: { storageVersion: 1, favorites: [poc.id, poc.id] } },
    backup([{ ...entry(), examId: '../secret' }]),
    backup([{ ...entry(), revision: 0 }]),
    backup([
      entry(null, [{ ...summary(completedAttempt()), completedAt: '2020-01-01T00:00:00.000Z' }]),
    ]),
    backup([
      entry(
        null,
        Array.from({ length: 21 }, (_, i) => summary(completedAttempt(`entry-${i}`))),
      ),
    ]),
    backup(Array.from({ length: 201 }, (_, i) => ({ ...entry(), examId: `exam-${i}` }))),
    backup(
      [],
      Array.from({ length: 1001 }, (_, i) => `exam-${i}`),
    ),
    backup([entry({ ...createAttempt(poc, now), id: 'a'.repeat(257) })]),
    backup([entry({ ...createAttempt(poc, now), flagged: ['a', 'a'] })]),
    backup([entry({ ...createAttempt(poc, now), answers: { a: 'a'.repeat(200_001) } })]),
    backup([
      entry({
        ...createAttempt(poc, now),
        answers: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`q-${i}`, '1'])),
      }),
    ]),
  ])('rejeita duplicatas, limites e campos desconhecidos (%#)', (value) =>
    expect(backupSchema.safeParse(value).success).toBe(false),
  );
  it('limite 10 MiB verifica bytes UTF-8 e File.size antes de ler/parsear', async () => {
    expect(() => parseBackup('a'.repeat(MAX_BACKUP_BYTES + 1))).toThrow('10 MiB');
    expect(() => parseBackup('á'.repeat(MAX_BACKUP_BYTES / 2 + 1))).toThrow('10 MiB');
    const text = vi.fn();
    await expect(
      readBackupFile({ size: MAX_BACKUP_BYTES + 1, text } as unknown as File),
    ).rejects.toThrow('10 MiB');
    expect(text).not.toHaveBeenCalled();
  });
  it('File API local lê JSON válido e rejeita inválido', async () => {
    await expect(
      readBackupFile({ size: 100, text: async () => storageFixtureJson(backup()) } as File),
    ).resolves.toEqual(backup());
    await expect(readBackupFile({ size: 4, text: async () => '{bad' } as File)).rejects.toThrow(
      'Backup inválido',
    );
  });
  it('unknown keys aninhadas ou __proto__ não são aceitas como chaves de storage', () => {
    const value = JSON.parse(storageFixtureJson(backup()));
    value.exams = [{ ...entry(), storageKey: 'third-party' }];
    expect(() => parseBackup(storageFixtureJson(value))).toThrow('Backup inválido');
    expect(() =>
      parseBackup(
        storageFixtureJson(backup()).replace(
          '"version":2',
          '"version":2,"__proto__":{"polluted":true}',
        ),
      ),
    ).toThrow('Backup inválido');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
describe('segunda etapa e prévia zero writes', () => {
  it('prova desconhecida/revision falsa são rejeitadas e reportadas sem loader', async () => {
    const store = memory(),
      load = loader();
    const input = backup(
      [
        { ...entry(), examId: 'fake-exam' },
        { ...entry(), revision: 999 },
      ],
      ['fake-exam', poc.id],
    );
    const plan = await prepareImport(input, catalog, store, load);
    expect(plan.compatibleExams).toBe(0);
    expect(plan.issues.join(' ')).toMatch(
      /desconhecida.*revisão incompatível.*Favorito desconhecido/,
    );
    expect(load).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it.each([
    { ...createAttempt(poc, now), answers: { absent: '1' } },
    { ...createAttempt(poc, now), answers: { [poc.questions[0]!.id]: 'option-999' } },
    { ...createAttempt(poc, now), examRevision: 5 },
    { ...completedAttempt(), result: { ...completedAttempt().result!, percentage: 100 } },
    { ...createAttempt(poc, now), completedAt: now, result: null },
    { ...createAttempt(poc, now), flagged: ['unknown-question'] },
  ])('current importado exige validação acadêmica completa (%#)', async (current) => {
    const store = memory(),
      load = loader(),
      plan = await prepareImport(backup([entry(current)]), catalog, store, load);
    expect(plan.compatibleExams).toBe(0);
    expect(plan.issues.join(' ')).toContain('item importado incompatível');
    expect(load).toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('result impossível no history, loader revision divergente e par current/history adulterado são rejeitados', async () => {
    const history = summary(completedAttempt());
    history.result.percentage = 100;
    const store = memory();
    expect(
      (await prepareImport(backup([entry(null, [history])]), catalog, store, loader()))
        .compatibleExams,
    ).toBe(0);
    expect(
      (
        await prepareImport(backup([entry(createAttempt(poc, now))]), catalog, store, async () => ({
          ...poc,
          revision: 3,
        }))
      ).compatibleExams,
    ).toBe(0);
    expect(
      (
        await prepareImport(
          backup([
            entry(completedAttempt(), [{ ...summary(completedAttempt()), completedAt: now }]),
          ]),
          catalog,
          store,
          loader(),
        )
      ).compatibleExams,
    ).toBe(0);
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('prévia conta itens e só calcula mudanças, sem writes', async () => {
    const store = memory(),
      input = backup([entry(completedAttempt(), [summary(completedAttempt())])], [poc.id]);
    const plan = await prepareImport(input, catalog, store, loader());
    expect(plan).toMatchObject({
      exportedAt: now,
      compatibleExams: 1,
      currents: 1,
      completions: 1,
      favorites: 1,
      hasUiPreferences: true,
    });
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.removeItem).not.toHaveBeenCalled();
    expect(store.values.size).toBe(0);
    const report = confirmImport(plan, plan.applyPreferencesByDefault, store);
    expect(report).toMatchObject({
      importedExams: 1,
      historiesMerged: 1,
      favoritesAdded: 1,
      preferencesApplied: true,
    });
    expect([...store.values.keys()]).toEqual([
      storageKey(poc),
      historyStorageKey(poc),
      catalogPreferencesKey,
      uiPreferencesKey,
    ]);
  });
  it.each([storageKey(poc), historyStorageKey(poc)])(
    'corrupção local %s preservada, favoritos compatíveis ainda mesclam',
    async (key) => {
      const store = memory([[key, '{bad']]),
        before = store.values.get(key);
      const plan = await prepareImport(
        backup([entry(completedAttempt())], [poc.id]),
        catalog,
        store,
        loader(),
      );
      expect(plan.issues.join(' ')).toContain('dados locais incompatíveis');
      confirmImport(plan, false, store);
      expect(store.values.get(key)).toBe(before);
      expect(store.values.get(catalogPreferencesKey)).toContain(poc.id);
    },
  );
  it('current local academicamente inválido não é sobrescrito', async () => {
    const store = memory([storeCurrent({ ...createAttempt(poc, now), answers: { absent: '1' } })]),
      before = [...store.values];
    const plan = await prepareImport(
      { ...backup([entry(createAttempt(poc, now))]), uiPreferences: null },
      catalog,
      store,
      loader(),
    );
    confirmImport(plan, false, store);
    expect([...store.values]).toEqual(before);
    expect(plan.issues.join(' ')).toContain('preservados');
  });
  it.each([catalogPreferencesKey, uiPreferencesKey])(
    'preferência corrompida %s não é sobrescrita mesmo com opção explícita',
    async (key) => {
      const store = memory([[key, '{bad']]),
        plan = await prepareImport(backup([], [poc.id]), catalog, store, loader());
      confirmImport(plan, true, store);
      expect(store.values.get(key)).toBe('{bad');
      expect(plan.issues.join(' ')).toContain('preservad');
    },
  );
  it('bloqueio de storage resulta em diagnóstico e nenhuma escrita', async () => {
    const store = memory();
    store.getItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    const plan = await prepareImport(
      backup([entry(createAttempt(poc, now))], [poc.id]),
      catalog,
      store,
      loader(),
    );
    expect(plan.issues.length).toBeGreaterThan(0);
    expect(store.setItem).not.toHaveBeenCalled();
    confirmImport(plan, false, store);
    expect(store.setItem).not.toHaveBeenCalled();
  });
});
describe('merge não destrutivo puro', () => {
  it('local vazio importa current; mesmo ID/conteúdo tem no-op', () => {
    const current = createAttempt(poc, now);
    expect(mergeExam(entry(), entry(current)).current).toEqual(current);
    expect(mergeExam(entry(current), entry(structuredClone(current)))).toMatchObject({
      current,
      conflicts: 0,
    });
  });
  it.each(['different-id', 'same-id-different-content'])(
    'local current prevalece em conflito %s sem adivinhar timestamp',
    (collision) => {
      const local = createAttempt(poc, '2026-10-01T12:00:00.000Z'),
        incoming = {
          ...local,
          id: collision === 'different-id' ? 'other' : local.id,
          startedAt: now,
        };
      expect(mergeExam(entry(local), entry(incoming))).toMatchObject({
        current: local,
        conflicts: 1,
      });
    },
  );
  it('objetos com ordem de keys diferente são idênticos semanticamente', () => {
    const local = { ...createAttempt(poc, now), answers: { a: '1', b: '2' } };
    expect(
      mergeExam(entry(local), entry({ ...local, answers: { b: '2', a: '1' } })).conflicts,
    ).toBe(0);
  });
  it('history une por ID, deduplica e preserva colisão local', () => {
    const old = summary(completedAttempt('old', 1)),
      newer = summary(completedAttempt('new', 10, now));
    const collision = { ...old, result: summary(completedAttempt('old', 2)).result };
    const result = mergeExam(entry(null, [old]), entry(null, [newer, old, collision]));
    expect(result).toMatchObject({ history: [newer, old], conflicts: 1, historiesMerged: 1 });
  });
  it('sort desc, empate explícito, HISTORY_LIMIT e descarte importado são reportados', () => {
    const history = Array.from({ length: HISTORY_LIMIT }, (_, i) =>
      summary(completedAttempt(`local-${i}`, 1, now)),
    );
    const input = entry(null, [summary(completedAttempt('imported-old'))]);
    const result = mergeExam(entry(null, history), input);
    expect(result.history).toEqual(history);
    expect(result.discarded).toBe(1);
    expect(result.historiesMerged).toBe(0);
  });
  it('current local concluído vence colisão com history importado', () => {
    const current = completedAttempt('same', 1),
      collision = summary(completedAttempt('same', 2));
    const result = mergeExam(entry(current), entry(null, [collision]));
    expect(result.history).toEqual([summary(current)]);
    expect(result.conflicts).toBe(1);
  });
  it('entrada original não é mutada', () => {
    const local = entry(createAttempt(poc, now), [summary(completedAttempt())]),
      incoming = entry(completedAttempt('other'));
    const before = structuredClone([local, incoming]);
    mergeExam(local, incoming);
    expect([local, incoming]).toEqual(before);
  });
  it('favoritos são união sem duplicatas e UI local exige seleção explícita', async () => {
    const localUi = { ...defaultUiPreferences, theme: 'light' as const };
    const store = memory([
      [
        catalogPreferencesKey,
        storageFixtureJson({ storageVersion: 1, favorites: ['future-exam', poc.id] }),
      ],
      [uiPreferencesKey, storageFixtureJson(localUi)],
    ]);
    const plan = await prepareImport(backup([], [poc.id]), catalog, store, loader());
    expect(plan.favoritesAdded).toBe(0);
    expect(plan.applyPreferencesByDefault).toBe(false);
    confirmImport(plan, false, store);
    expect(JSON.parse(store.values.get(uiPreferencesKey)!)).toEqual(localUi);
    expect(JSON.parse(store.values.get(catalogPreferencesKey)!).favorites).toEqual([
      'future-exam',
      poc.id,
    ]);
    confirmImport(plan, true, store);
    expect(JSON.parse(store.values.get(uiPreferencesKey)!)).toEqual(backup().uiPreferences);
  });
  it('tema legado válido nunca é sobrescrito nem preseleciona importação de UI', async () => {
    const raw = storageFixtureJson({ version: 1, theme: 'light' }),
      store = memory([[legacyThemeKey, raw]]);
    const plan = await prepareImport(backup(), catalog, store, loader());
    expect(plan.applyPreferencesByDefault).toBe(false);
    confirmImport(plan, false, store);
    expect(store.values.get(legacyThemeKey)).toBe(raw);
    expect(store.values.has(uiPreferencesKey)).toBe(false);
  });
  it('roundtrip v1 exporta/importa v2 e segunda importação é no-op completo', async () => {
    const source = memory([
        [
          storageKey(poc),
          storageFixtureJson({ storageVersion: 1, current: completedAttempt(), history: [] }),
        ],
      ]),
      dest = memory();
    const input = await exportBackup(catalog, source, loader(), now);
    confirmImport(await prepareImport(input, catalog, dest, loader()), true, dest);
    expect(JSON.parse(dest.values.get(storageKey(poc))!).storageVersion).toBe(3);
    const before = [...dest.values],
      calls = dest.setItem.mock.calls.length;
    const next = await prepareImport(input, catalog, dest, loader());
    confirmImport(next, true, dest);
    expect(dest.setItem.mock.calls.length).toBe(calls);
    expect([...dest.values]).toEqual(before);
  });
});
describe('transação, concorrência e rollback', () => {
  const input = () => backup([entry(completedAttempt())], [poc.id]);
  it.each([storageKey(poc), historyStorageKey(poc), catalogPreferencesKey, uiPreferencesKey])(
    'mudança após preview em %s aborta antes de qualquer write',
    async (key) => {
      const store = memory(),
        plan = await prepareImport(input(), catalog, store, loader());
      store.values.set(key, 'concurrent');
      expect(() => confirmImport(plan, true, store)).toThrow('concorrência');
      expect(store.setItem).not.toHaveBeenCalled();
      expect(store.values.get(key)).toBe('concurrent');
    },
  );
  it('detecta também mudança de current preservado e de tema legado', async () => {
    const store = memory([storeCurrent(createAttempt(poc, now))]),
      plan = await prepareImport(input(), catalog, store, loader());
    store.values.set(storageKey(poc), 'changed');
    expect(() => confirmImport(plan, false, store)).toThrow('concorrência');
    expect(store.setItem).not.toHaveBeenCalled();
    const second = memory(),
      p = await prepareImport(input(), catalog, second, loader());
    second.values.set(legacyThemeKey, 'changed');
    expect(() => confirmImport(p, true, second)).toThrow('concorrência');
  });
  it.each([1, 2, 3, 4])(
    'falha no write %i restaura todas as chaves com removeItem para ausentes',
    async (failure) => {
      const store = memory(),
        plan = await prepareImport(input(), catalog, store, loader());
      let writes = 0;
      store.setItem.mockImplementation((key, value) => {
        if (++writes === failure) throw new Error('quota');
        store.values.set(key, value);
      });
      expect(() => confirmImport(plan, true, store)).toThrow('foram restauradas');
      expect(store.values.size).toBe(0);
      if (failure > 1) expect(store.removeItem).toHaveBeenCalled();
    },
  );
  it('falha no meio restaura bytes raw de chave existente e remove as novas', async () => {
    const raw = '{ "storageVersion": 1, "favorites": ["future-exam"] }';
    const store = memory([[catalogPreferencesKey, raw]]),
      plan = await prepareImport(input(), catalog, store, loader());
    store.setItem.mockImplementation((key, value) => {
      if (key === uiPreferencesKey) throw new Error('quota');
      store.values.set(key, value);
    });
    expect(() => confirmImport(plan, true, store)).toThrow('foram restauradas');
    expect([...store.values]).toEqual([[catalogPreferencesKey, raw]]);
  });
  it('setItem que altera antes de lançar também é restaurado', async () => {
    const store = memory(),
      plan = await prepareImport(input(), catalog, store, loader());
    store.setItem.mockImplementation((key, value) => {
      store.values.set(key, value);
      throw new Error('quota');
    });
    expect(() => confirmImport(plan, true, store)).toThrow('foram restauradas');
    expect(store.values.size).toBe(0);
  });
  it('rollback removeItem falha: erro explícito, sem falso sucesso', async () => {
    const store = memory(),
      plan = await prepareImport(input(), catalog, store, loader());
    store.setItem.mockImplementation((key, value) => {
      if (key === historyStorageKey(poc)) throw new Error('quota');
      store.values.set(key, value);
    });
    store.removeItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => confirmImport(plan, true, store)).toThrow('rollback ficou incompleto');
    expect(store.values.has(storageKey(poc))).toBe(true);
  });
  it('rollback setItem falha em chave existente: erro explícito', async () => {
    const raw = storageFixtureJson({ storageVersion: 1, favorites: ['future-exam'] });
    const store = memory([[catalogPreferencesKey, raw]]),
      plan = await prepareImport(input(), catalog, store, loader());
    store.setItem.mockImplementation((key, value) => {
      if (key === uiPreferencesKey || value === raw) throw new Error('quota');
      store.values.set(key, value);
    });
    expect(() => confirmImport(plan, true, store)).toThrow('rollback ficou incompleto');
  });
  it('falha de leitura imediatamente antes de confirmar bloqueia todas as writes', async () => {
    const store = memory(),
      plan = await prepareImport(input(), catalog, store, loader());
    store.getItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => confirmImport(plan, true, store as BackupStorage)).toThrow('falha de leitura');
    expect(store.setItem).not.toHaveBeenCalled();
  });
});

describe('importação ao lado de current v1 sem migração na leitura', () => {
  it('histories importados sobrevivem a abrir prova e ao próximo save v2', async () => {
    const current = createAttempt(poc, now);
    const old = completedAttempt('old');
    const raw = storageFixtureJson({ storageVersion: 1, current, history: [old] });
    const store = memory([[storageKey(poc), raw]]);
    const input = {
      ...backup([entry(null, [summary(completedAttempt('imported', 10, now))])]),
      uiPreferences: null,
    };
    const plan = await prepareImport(input, catalog, store, loader());
    confirmImport(plan, false, store);
    expect(store.values.get(storageKey(poc))).toBe(raw);
    const repo = new AttemptRepository(() => store);
    const beforeReads = [...store.values],
      beforeWrites = store.setItem.mock.calls.length;
    const loaded = repo.load(poc);
    expect(loaded.history.map((item) => item.id)).toEqual(['imported', 'old']);
    expect([...store.values]).toEqual(beforeReads);
    expect(store.setItem.mock.calls.length).toBe(beforeWrites);
    repo.save(poc, loaded.current, loaded.history);
    expect(
      JSON.parse(store.values.get(historyStorageKey(poc))!).history.map(
        (item: { id: string }) => item.id,
      ),
    ).toEqual(['imported', 'old']);
    expect(repo.load(poc).history).toHaveLength(2);
  });
  it('history v2 corrompido não impede current/histórico v1 válidos', () => {
    const raw = storageFixtureJson({
      storageVersion: 1,
      current: createAttempt(poc, now),
      history: [completedAttempt()],
    });
    const store = memory([
      [storageKey(poc), raw],
      [historyStorageKey(poc), '{bad'],
    ]);
    expect(new AttemptRepository(() => store).load(poc)).toMatchObject({
      restored: true,
      history: [{ id: 'completed' }],
    });
    expect(store.values.get(historyStorageKey(poc))).toBe('{bad');
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('21 conclusões importadas contando current reportam descarte sem corte silencioso antes do merge', async () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      summary(completedAttempt(`past-${i}`, 1, now)),
    );
    const store = memory(),
      plan = await prepareImport(
        backup([entry(completedAttempt('old-current'), history)]),
        catalog,
        store,
        loader(),
      );
    expect(plan.discarded).toBe(1);
    expect(plan.issues.join(' ')).toContain('descartada');
    confirmImport(plan, false, store);
    expect(JSON.parse(store.values.get(historyStorageKey(poc))!).history).toHaveLength(20);
  });
});

describe('histórico local prevalece também quando não há current', () => {
  it.each(['completed', 'open'])(
    'current %s importado não substitui uma conclusão local divergente com mesmo ID',
    async (state) => {
      const local = summary(completedAttempt('collision', 10));
      const incoming =
        state === 'completed'
          ? completedAttempt('collision', 1)
          : { ...createAttempt(poc, now), id: 'collision' };
      const incomingHistory = incoming.completedAt ? [summary(incoming)] : [];
      const merged = mergeExam(entry(null, [local]), entry(incoming, incomingHistory));
      expect(merged.current).toBeNull();
      expect(merged.history).toEqual([local]);
      expect(merged.conflicts).toBeGreaterThan(0);
      const store = memory([storeHistory([local])]);
      const plan = await prepareImport(
        { ...backup([entry(incoming, incomingHistory)]), uiPreferences: null },
        catalog,
        store,
        loader(),
      );
      confirmImport(plan, false, store);
      expect(store.values.has(storageKey(poc))).toBe(false);
      expect(JSON.parse(store.values.get(historyStorageKey(poc))!).history).toEqual([
        {
          id: local.id,
          startedAt: local.startedAt,
          completedAt: local.completedAt,
          result: local.result,
        },
      ]);
    },
  );
  it('history-only importado é restaurado sem current e sobrevive ao primeiro save e conclusão', async () => {
    const store = memory(),
      history = [summary(completedAttempt())];
    confirmImport(
      await prepareImport(
        { ...backup([entry(null, history)]), uiPreferences: null },
        catalog,
        store,
        loader(),
      ),
      false,
      store,
    );
    const repo = new AttemptRepository(() => store),
      beforeWrites = store.setItem.mock.calls.length;
    const loaded = repo.load(poc);
    expect(loaded).toMatchObject({ restored: false, history });
    expect(store.setItem.mock.calls.length).toBe(beforeWrites);
    expect(store.values.has(storageKey(poc))).toBe(false);
    repo.save(poc, loaded.current, loaded.history);
    repo.save(poc, completedAttempt('new-session'), loaded.history);
    expect(repo.load(poc).history.map((item) => item.id)).toEqual(['new-session', 'completed']);
  });
});

describe('F1: importação mantém as 20 conclusões mais recentes em load/save/restart', () => {
  it.each(['empty', 'v1', 'v2'] as const)(
    'current antigo 0%% não desloca history posterior 100%% no destino %s',
    async (destination) => {
      const old = completedAttempt('old-current', 0);
      const history = Array.from({ length: HISTORY_LIMIT }, (_, i) =>
        summary(
          completedAttempt(
            `recent-${i}`,
            i === 0 ? 20 : 0,
            `2026-10-04T10:${String(i).padStart(2, '0')}:00.000Z`,
          ),
        ),
      );
      const store = memory(
        destination === 'empty'
          ? []
          : [
              [
                storageKey(poc),
                storageFixtureJson(
                  destination === 'v1'
                    ? { storageVersion: 1, current: old, history: [old] }
                    : { storageVersion: 2, current: old },
                ),
              ],
            ],
      );
      const input = parseBackup(
        storageFixtureJson({
          ...backup([entry(destination === 'empty' ? old : null, history)]),
          uiPreferences: null,
        }),
      );
      const plan = await prepareImport(input, catalog, store, loader());
      expect(store.setItem).not.toHaveBeenCalled();
      confirmImport(plan, false, store);
      const expected = [...history].reverse();
      const check = () => {
        expect(JSON.parse(store.values.get(historyStorageKey(poc))!).history).toEqual(expected);
        const progress = readExamProgress(catalogExam, () => store).progress;
        expect(progress).toMatchObject({ attemptCount: 20, bestResultPercentage: 100 });
        expect(aggregateGlobalMetrics([{ exam: catalogExam, progress }]).best).toBe(100);
      };
      check();
      const repo = new AttemptRepository(() => store);
      const beforeLoad = [...store.values];
      const session = repo.load(poc);
      expect(session.current).toEqual(old);
      expect(session.history).toEqual(expected);
      expect([...store.values]).toEqual(beforeLoad);
      check();
      expect(repo.save(poc, session.current, session.history).history).toEqual(expected);
      check();
      const restarted = createAttempt(poc, now);
      expect(repo.save(poc, restarted, session.history).history).toEqual(expected);
      expect(repo.load(poc)).toMatchObject({ current: restarted, history: expected });
      check();
      const exported = await exportBackup(catalog, store, loader(), now);
      expect(exported.exams[0]!.history).toEqual(expected);
    },
  );
});

describe('F2: colisões de ID entre todas as categorias', () => {
  it('current local aberto rejeita history de mesmo ID; outros dados continuam importáveis', async () => {
    const current = { ...createAttempt(poc, '2026-10-03T10:00:00.000Z'), id: 'collision' };
    const raw = storageFixtureJson({ storageVersion: 2, current });
    const store = memory([[storageKey(poc), raw]]);
    const collision = summary(completedAttempt('collision', 10));
    const other = summary(completedAttempt('other', 1));
    const input = parseBackup(
      storageFixtureJson(backup([entry(null, [collision, other])], [poc.id])),
    );
    const plan = await prepareImport(input, catalog, store, loader());
    expect(plan.conflicts).toBeGreaterThanOrEqual(1);
    expect(plan.issues.join(' ')).toContain(
      'Histórico collision: tentativa atual preservada por conflito',
    );
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.removeItem).not.toHaveBeenCalled();
    const report = confirmImport(plan, true, store);
    expect(report).toMatchObject({
      conflicts: 1,
      historiesMerged: 1,
      favoritesAdded: 1,
      preferencesApplied: true,
    });
    expect(store.values.get(storageKey(poc))).toBe(raw);
    expect(JSON.parse(store.values.get(historyStorageKey(poc))!).history).toEqual([other]);
    expect(JSON.parse(store.values.get(catalogPreferencesKey)!).favorites).toEqual([poc.id]);
    expect(JSON.parse(store.values.get(uiPreferencesKey)!)).toEqual(input.uiPreferences);
    const repo = new AttemptRepository(() => store),
      loaded = repo.load(poc);
    const finished = transition(poc, loaded.current, { type: 'finish', now });
    const saved = repo.save(poc, finished, loaded.history);
    let exported = await exportBackup(catalog, store, loader(), now);
    expect(exported.exams[0]!.history).toContainEqual(summary(finished));
    expect(exported.exams[0]!.history).not.toContainEqual(collision);
    const next = { ...createAttempt(poc, now), id: 'next' };
    repo.save(poc, next, saved.history);
    repo.save(
      poc,
      transition(poc, next, { type: 'finish', now: '2026-10-04T13:00:00.000Z' }),
      saved.history,
    );
    exported = await exportBackup(catalog, store, loader(), now);
    expect(exported.exams[0]!.history.filter((item) => item.id === 'collision')).toEqual([
      summary(finished),
    ]);
  });
  it('history conflitante isolado não produz escrita de tentativa ou histórico', async () => {
    const current = { ...createAttempt(poc, now), id: 'collision' };
    const store = memory([storeCurrent(current)]),
      before = [...store.values];
    const plan = await prepareImport(
      {
        ...backup([entry(null, [summary(completedAttempt('collision', 10))])]),
        uiPreferences: null,
      },
      catalog,
      store,
      loader(),
    );
    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toBe(1);
    confirmImport(plan, false, store);
    expect([...store.values]).toEqual(before);
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it.each(['current/current', 'current/history', 'history/current', 'history/history'] as const)(
    'conclusões equivalentes em %s deduplicam; divergentes preservam local e reportam',
    (pair) => {
      const local = completedAttempt('same', 10);
      for (const equal of [true, false]) {
        const incoming = equal ? structuredClone(local) : completedAttempt('same', 1);
        const [a, b] = pair.split('/');
        const localEntry = entry(a === 'current' ? local : null, [summary(local)]);
        const input = entry(b === 'current' ? incoming : null, [summary(incoming)]);
        const merged = mergeExam(localEntry, input);
        expect(merged.history).toEqual([summary(local)]);
        if (equal) expect(merged.conflicts).toBe(0);
        else expect(merged.conflicts).toBeGreaterThanOrEqual(1);
        expect(merged.current).toEqual(
          a === 'current' ? local : b === 'current' && equal ? incoming : null,
        );
      }
    },
  );
  it('current aberto selecionado nunca coexiste com history importado de mesmo ID', () => {
    const current = { ...createAttempt(poc, now), id: 'collision' };
    const merged = mergeExam(entry(), entry(current, [summary(completedAttempt('collision', 10))]));
    expect(merged).toMatchObject({ current, history: [], conflicts: 1 });
  });
});
