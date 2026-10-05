import { z } from 'zod';
import { identifier } from '../../schema/exam';
import type { Catalog } from '../../schema/catalog';
import type { Exam } from '../types/exam';
import { attemptSchema, isCompatibleAttempt, type Attempt } from './exam-state';
import {
  currentEnvelopeSchema,
  previousEnvelopeSchema,
  historyEnvelopeSchema,
  historyEntrySchema,
  storageKey,
  historyStorageKey,
  summary,
  HISTORY_LIMIT,
  type HistoryEntry,
  type StorageAdapter,
} from './persistence';
import { catalogPreferencesKey, catalogPreferencesSchema } from './catalog-preferences';
import { isCatalogResultConsistent, type CatalogExam } from './catalog-progress';
import {
  defaultUiPreferences,
  legacyThemeKey,
  legacyThemeSchema,
  uiPreferencesKey,
  uiPreferencesSchema,
  type UiPreferences,
} from './ui-preferences';
import { loadExam } from './exam-loader';
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const boundedId = z
  .string()
  .min(1)
  .max(256)
  .refine((id) => id.trim().length > 0);
const backupAttemptSchema = attemptSchema.extend({
  id: boundedId,
  examId: identifier.max(256),
  examRevision: z.number().int().positive().max(1_000_000),
  currentIndex: z.number().int().min(0).max(1999),
  answers: z
    .record(boundedId, z.string().max(200_000))
    .refine((answers) => Object.keys(answers).length <= 2000),
  flagged: z
    .array(boundedId)
    .max(2000)
    .refine((ids) => new Set(ids).size === ids.length),
});
const backupHistorySchema = historyEntrySchema
  .extend({ id: boundedId })
  .refine((entry) => Date.parse(entry.completedAt) >= Date.parse(entry.startedAt));
export const backupSchema = z.strictObject({
  format: z.literal('medsim-backup'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  exams: z
    .array(
      z.strictObject({
        examId: identifier.max(256),
        revision: z.number().int().positive().max(1_000_000),
        current: backupAttemptSchema.nullable(),
        history: z
          .array(backupHistorySchema)
          .max(HISTORY_LIMIT)
          .refine((entries) => new Set(entries.map((entry) => entry.id)).size === entries.length),
      }),
    )
    .max(200)
    .refine((entries) => new Set(entries.map((entry) => entry.examId)).size === entries.length),
  catalogPreferences: catalogPreferencesSchema.extend({
    favorites: z
      .array(boundedId)
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
  uiPreferences: uiPreferencesSchema.nullable(),
});
export type Backup = z.infer<typeof backupSchema>;
export type BackupExam = Backup['exams'][number];
export interface BackupStorage extends StorageAdapter {
  removeItem(key: string): void;
}
export type ExamLoader = (id: string) => Promise<Exam>;
export type BackupChange = { key: string; before: string | null; after: string };
export type ImportPlan = {
  exportedAt: string;
  compatibleExams: number;
  currents: number;
  completions: number;
  favorites: number;
  issues: string[];
  conflicts: number;
  discarded: number;
  importedExams: number;
  historiesMerged: number;
  favoritesAdded: number;
  changes: BackupChange[];
  expected: Map<string, string | null>;
  preferenceChange: BackupChange | null;
  hasUiPreferences: boolean;
  applyPreferencesByDefault: boolean;
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const sameContent = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function sortHistory(entries: HistoryEntry[]) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        Date.parse(b.entry.completedAt) - Date.parse(a.entry.completedAt) || a.index - b.index,
    )
    .map(({ entry }) => entry);
}
function uniqueHistory(entries: HistoryEntry[]): HistoryEntry[] {
  const result = new Map<string, HistoryEntry>();
  for (const entry of entries) {
    const existing = result.get(entry.id);
    if (existing && !sameContent(existing, entry))
      throw new Error(`Histórico conflitante: ${entry.id}.`);
    result.set(entry.id, entry);
  }
  return sortHistory([...result.values()]);
}
function validateHistory(exam: CatalogExam, entries: HistoryEntry[]) {
  if (
    new Set(entries.map((entry) => entry.id)).size !== entries.length ||
    entries.some(
      (entry) =>
        Date.parse(entry.completedAt) < Date.parse(entry.startedAt) ||
        !isCatalogResultConsistent(exam, entry.result),
    )
  )
    throw new Error('Histórico incompatível com a prova.');
}
async function validateCurrent(exam: CatalogExam, current: Attempt, loader: ExamLoader) {
  const full = await loader(exam.id);
  if (
    full.id !== exam.id ||
    full.revision !== exam.revision ||
    full.questions.length !== exam.questionCount ||
    !isCompatibleAttempt(full, current)
  )
    throw new Error('Tentativa incompatível com a prova.');
}
// Read known keys through a frozen raw snapshot. No repositories that repair or migrate.
function snapshotStorage(storage: Pick<BackupStorage, 'getItem'>) {
  const expected = new Map<string, string | null>();
  return {
    expected,
    getItem(key: string) {
      if (!expected.has(key)) expected.set(key, storage.getItem(key));
      return expected.get(key)!;
    },
  };
}
function readJson(raw: string) {
  return JSON.parse(raw) as unknown;
}
async function readStoredExam(
  exam: CatalogExam,
  storage: Pick<BackupStorage, 'getItem'>,
  loader: ExamLoader,
): Promise<BackupExam> {
  const raw = storage.getItem(storageKey(exam));
  const historyRaw = storage.getItem(historyStorageKey(exam));
  let current: Attempt | null = null;
  let history: HistoryEntry[] = [];
  if (raw !== null) {
    const value = readJson(raw);
    const v2 = currentEnvelopeSchema.safeParse(value);
    if (v2.success) {
      current = v2.data.current;
      await validateCurrent(exam, current, loader);
    } else {
      const v1 = previousEnvelopeSchema.parse(value);
      current = v1.current;
      const full = await loader(exam.id);
      if (
        full.id !== exam.id ||
        full.revision !== exam.revision ||
        full.questions.length !== exam.questionCount ||
        !isCompatibleAttempt(full, current) ||
        v1.history.some((attempt) => !attempt.completedAt || !isCompatibleAttempt(full, attempt))
      )
        throw new Error('Envelope legado incompatível.');
      history = v1.history.map(summary);
      validateHistory(exam, history);
    }
  }
  if (historyRaw !== null) {
    const entries = historyEnvelopeSchema.parse(readJson(historyRaw)).history;
    validateHistory(exam, entries);
    history = uniqueHistory([...history, ...entries]);
  }
  if (current?.completedAt) history = uniqueHistory([...history, summary(current)]);
  return {
    examId: exam.id,
    revision: exam.revision,
    current,
    history: sortHistory(history).slice(0, HISTORY_LIMIT),
  };
}
function readExportPreferences(storage: Pick<BackupStorage, 'getItem'>): UiPreferences {
  const raw = storage.getItem(uiPreferencesKey);
  if (raw !== null) return uiPreferencesSchema.parse(readJson(raw));
  const legacy = storage.getItem(legacyThemeKey);
  return legacy === null
    ? { ...defaultUiPreferences }
    : { ...defaultUiPreferences, theme: legacyThemeSchema.parse(readJson(legacy)).theme };
}
export async function exportBackup(
  catalog: Catalog,
  storage: Pick<BackupStorage, 'getItem'> = window.localStorage,
  loader: ExamLoader = loadExam,
  now = new Date().toISOString(),
): Promise<Backup> {
  const snapshot = snapshotStorage(storage);
  const exams: BackupExam[] = [];
  for (const exam of catalog.exams) {
    try {
      const entry = await readStoredExam(exam, snapshot, loader);
      if (entry.current || entry.history.length) exams.push(entry);
    } catch {
      throw new Error(
        `Exportação abortada: ${exam.title} possui estado local incompatível ou indisponível. Nenhum arquivo parcial foi gerado.`,
      );
    }
  }
  try {
    const raw = snapshot.getItem(catalogPreferencesKey);
    const backup = backupSchema.parse({
      format: 'medsim-backup',
      version: 1,
      exportedAt: now,
      exams,
      catalogPreferences:
        raw === null
          ? { storageVersion: 1, favorites: [] }
          : catalogPreferencesSchema.parse(readJson(raw)),
      uiPreferences: readExportPreferences(snapshot),
    });
    for (const [key, before] of snapshot.expected)
      if (storage.getItem(key) !== before)
        throw new Error('O progresso mudou durante a exportação. Tente novamente.');
    if (new TextEncoder().encode(JSON.stringify(backup, null, 2)).byteLength > MAX_BACKUP_BYTES)
      throw new Error('O backup excede o limite de 10 MiB.');
    return backup;
  } catch (error) {
    throw new Error(
      `Exportação abortada: preferências incompatíveis ou dados indisponíveis. ${error instanceof Error ? error.message : ''}`,
    );
  }
}
export function parseBackup(text: string): Backup {
  if (
    text.length > MAX_BACKUP_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES
  )
    throw new Error('Arquivo acima do limite de 10 MiB.');
  try {
    return backupSchema.parse(JSON.parse(text));
  } catch {
    throw new Error(
      'Backup inválido: verifique formato, versão, campos, datas, limites e IDs duplicados.',
    );
  }
}
export function mergeExam(local: BackupExam, incoming: BackupExam) {
  let conflicts = 0;
  const notes: string[] = [];
  let current = local.current;
  if (incoming.current) {
    if (!current) {
      const collision = local.history.find((entry) => entry.id === incoming.current!.id);
      if (
        collision &&
        (!incoming.current.completedAt || !sameContent(collision, summary(incoming.current)))
      ) {
        conflicts++;
        notes.push(
          'Tentativa importada colide com uma conclusão local; o histórico local foi preservado.',
        );
      } else current = incoming.current;
    } else if (!sameContent(current, incoming.current)) {
      conflicts++;
      notes.push('Tentativa atual local preservada por conflito.');
    }
  }
  const union = new Map(local.history.map((entry) => [entry.id, entry]));
  const added = new Set<string>();
  for (const entry of incoming.history) {
    if (
      current?.id === entry.id &&
      (!current.completedAt || !sameContent(summary(current), entry))
    ) {
      conflicts++;
      notes.push(`Histórico ${entry.id}: tentativa atual preservada por conflito.`);
      continue;
    }
    const existing = union.get(entry.id);
    if (!existing) {
      union.set(entry.id, entry);
      added.add(entry.id);
    } else if (!sameContent(existing, entry)) {
      conflicts++;
      notes.push(`Histórico ${entry.id}: conteúdo local preservado por conflito.`);
    }
  }
  // A local current can also supply a missing history summary, and wins over an imported collision.
  if (current?.completedAt) {
    const entry = summary(current),
      existing = union.get(entry.id);
    if (existing && !sameContent(existing, entry)) {
      conflicts++;
      added.delete(entry.id);
      notes.push(`Histórico ${entry.id}: conclusão da tentativa atual local preservada.`);
    }
    union.set(entry.id, entry);
  }
  const history = sortHistory([...union.values()]).slice(0, HISTORY_LIMIT);
  const kept = new Set(history.map((entry) => entry.id));
  const discarded = [...added].filter((id) => !kept.has(id)).length;
  return {
    current,
    history,
    conflicts,
    notes,
    discarded,
    historiesMerged: [...added].filter((id) => kept.has(id)).length,
  };
}
export async function prepareImport(
  backup: Backup,
  catalog: Catalog,
  storage: Pick<BackupStorage, 'getItem'> = window.localStorage,
  loader: ExamLoader = loadExam,
): Promise<ImportPlan> {
  // Also validate callers that bypass parseBackup.
  backup = backupSchema.parse(backup);
  const snapshot = snapshotStorage(storage);
  const plan: ImportPlan = {
    exportedAt: backup.exportedAt,
    compatibleExams: 0,
    currents: 0,
    completions: 0,
    favorites: 0,
    issues: [],
    conflicts: 0,
    discarded: 0,
    importedExams: 0,
    historiesMerged: 0,
    favoritesAdded: 0,
    changes: [],
    expected: snapshot.expected,
    preferenceChange: null,
    hasUiPreferences: backup.uiPreferences !== null,
    applyPreferencesByDefault: false,
  };
  const index = new Map(catalog.exams.map((exam) => [exam.id, exam]));
  function change(key: string, value: unknown) {
    const before = snapshot.getItem(key),
      after = JSON.stringify(value);
    if (before === null || !sameContent(readJson(before), value))
      plan.changes.push({ key, before, after });
  }
  for (const incoming of backup.exams) {
    const exam = index.get(incoming.examId);
    if (!exam) {
      plan.issues.push(`Prova desconhecida rejeitada: ${incoming.examId}.`);
      continue;
    }
    if (exam.revision !== incoming.revision) {
      plan.issues.push(`${exam.title}: revisão incompatível rejeitada (${incoming.revision}).`);
      continue;
    }
    try {
      validateHistory(exam, incoming.history);
      if (incoming.current) {
        await validateCurrent(exam, incoming.current, loader);
        // A tampered same-ID current/history pair cannot silently replace its own history.
        if (incoming.current.completedAt)
          uniqueHistory([...incoming.history, summary(incoming.current)]);
      }
    } catch {
      plan.issues.push(`${exam.title}: item importado incompatível rejeitado.`);
      continue;
    }
    plan.compatibleExams++;
    plan.currents += Number(incoming.current !== null);
    plan.completions += incoming.history.length;
    try {
      const local = await readStoredExam(exam, snapshot, loader);
      const normalized = {
        ...incoming,
        history: uniqueHistory([
          ...incoming.history,
          ...(incoming.current?.completedAt ? [summary(incoming.current)] : []),
        ]),
      };
      const merged = mergeExam(local, normalized);
      plan.conflicts += merged.conflicts;
      plan.discarded += merged.discarded;
      plan.historiesMerged += merged.historiesMerged;
      plan.issues.push(...merged.notes.map((note) => `${exam.title}: ${note}`));
      const previousChanges = plan.changes.length;
      // Only write current when imported into an empty destination. No opportunistic v1 migration.
      if (!local.current && merged.current)
        change(storageKey(exam), { storageVersion: 2, current: merged.current });
      if (!sameContent(local.history, merged.history))
        change(historyStorageKey(exam), { storageVersion: 2, history: merged.history });
      if (plan.changes.length > previousChanges) plan.importedExams++;
    } catch {
      plan.issues.push(
        `${exam.title}: dados locais incompatíveis ou indisponíveis preservados; esta prova não será alterada.`,
      );
    }
  }
  const knownFavorites = backup.catalogPreferences.favorites.filter((id) => index.has(id));
  plan.favorites = knownFavorites.length;
  for (const id of backup.catalogPreferences.favorites)
    if (!index.has(id)) plan.issues.push(`Favorito desconhecido rejeitado: ${id}.`);
  try {
    const raw = snapshot.getItem(catalogPreferencesKey);
    const local = raw === null ? [] : catalogPreferencesSchema.parse(readJson(raw)).favorites;
    const favorites = [...new Set([...local, ...knownFavorites])];
    plan.favoritesAdded = favorites.length - local.length;
    if (plan.favoritesAdded) change(catalogPreferencesKey, { storageVersion: 1, favorites });
  } catch {
    plan.issues.push('Favoritos locais incompatíveis ou indisponíveis preservados.');
  }
  if (backup.uiPreferences) {
    try {
      const before = snapshot.getItem(uiPreferencesKey);
      if (before !== null) uiPreferencesSchema.parse(readJson(before));
      // Preserve any explicit legacy choice unless the user selects the checkbox.
      const legacy = snapshot.getItem(legacyThemeKey);
      plan.applyPreferencesByDefault = before === null && legacy === null;
      const after = JSON.stringify(backup.uiPreferences);
      if (before === null || !sameContent(readJson(before), backup.uiPreferences))
        plan.preferenceChange = { key: uiPreferencesKey, before, after };
    } catch {
      plan.issues.push('Configurações locais incompatíveis ou indisponíveis preservadas.');
    }
  }
  if (plan.discarded)
    plan.issues.push(
      `${plan.discarded} conclusão(ões) importada(s) descartada(s) pelo limite de ${HISTORY_LIMIT}.`,
    );
  return plan;
}
export function confirmImport(
  plan: ImportPlan,
  applyPreferences: boolean,
  storage: BackupStorage = window.localStorage,
) {
  const changes = [
    ...plan.changes,
    ...(applyPreferences && plan.preferenceChange ? [plan.preferenceChange] : []),
  ];
  try {
    for (const [key, before] of plan.expected)
      if (storage.getItem(key) !== before)
        throw new Error('O progresso local mudou após a prévia. Selecione o arquivo novamente.');
  } catch (error) {
    throw new Error(
      `Importação abortada por concorrência ou falha de leitura. ${error instanceof Error ? error.message : ''}`,
    );
  }
  const written: BackupChange[] = [];
  try {
    for (const change of changes) {
      written.push(change); // Include a setItem that mutates and then throws.
      storage.setItem(change.key, change.after);
    }
  } catch {
    let rollbackFailed = false;
    for (const change of written.reverse()) {
      try {
        if (storage.getItem(change.key) === change.before) continue;
      } catch {
        /* A failed read must not prevent attempting restoration. */
      }
      try {
        if (change.before === null) storage.removeItem(change.key);
        else storage.setItem(change.key, change.before);
      } catch {
        rollbackFailed = true;
      }
    }
    throw new Error(
      rollbackFailed
        ? 'Importação falhou e o rollback ficou incompleto. Alguns dados podem ter sido alterados; preserve seu backup e confira o progresso local.'
        : 'Importação falhou. As chaves tocadas foram restauradas; nenhum dado local foi substituído.',
    );
  }
  return {
    importedExams: plan.importedExams,
    historiesMerged: plan.historiesMerged,
    conflicts: plan.conflicts,
    favoritesAdded: plan.favoritesAdded,
    discarded: plan.discarded,
    preferencesApplied: applyPreferences && plan.preferenceChange !== null,
  };
}
