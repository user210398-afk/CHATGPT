import { z } from 'zod';
import { identifier } from '../../schema/exam';
import type { Catalog } from '../../schema/catalog';
import type { Exam } from '../types/exam';
import {
  attemptSchema,
  legacyAttemptSchema,
  normalizeLegacyAttempt,
  isCompatibleAttempt,
  type Attempt,
} from './exam-state';
import {
  readableCurrentEnvelopeSchema,
  previousEnvelopeSchema,
  readableHistoryEnvelopeSchema,
  historyEntrySchema,
  historyEntryV2Schema,
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
  uiPreferencesV1Schema,
  readableUiPreferencesSchema,
  type UiPreferences,
} from './ui-preferences';
import { loadExam } from './exam-loader';
import {
  reviewStorageKey,
  reviewEnvelopeSchema,
  validateReviewArchive,
  combineDetailedAttempts,
  sameAttemptAcademic,
  retainReviews,
} from './review-history';
import { sameContent } from './content-equality';
export { sameContent } from './content-equality';
import { writeTransaction } from './storage-transaction';
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const boundedId = z
  .string()
  .min(1)
  .max(256)
  .refine((id) => id.trim().length > 0);
const backupLegacyAttemptSchema = legacyAttemptSchema.extend({
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
const backupLegacyHistorySchema = historyEntryV2Schema
  .extend({ id: boundedId })
  .refine((entry) => Date.parse(entry.completedAt) >= Date.parse(entry.startedAt));
export const backupV1Schema = z.strictObject({
  format: z.literal('medsim-backup'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  exams: z
    .array(
      z.strictObject({
        examId: identifier.max(256),
        revision: z.number().int().positive().max(1_000_000),
        current: backupLegacyAttemptSchema.nullable(),
        history: z
          .array(backupLegacyHistorySchema)
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
  uiPreferences: uiPreferencesV1Schema.nullable(),
});
const backupAttemptSchema = backupLegacyAttemptSchema.extend({
  mode: attemptSchema.shape.mode,
  confirmedQuestionIds: z
    .array(boundedId)
    .max(2000)
    .refine((ids) => new Set(ids).size === ids.length),
});
const backupHistorySchema = historyEntrySchema
  .extend({ id: boundedId })
  .refine((entry) => Date.parse(entry.completedAt) >= Date.parse(entry.startedAt));
export const backupSchema = backupV1Schema.extend({
  version: z.literal(2),
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
        reviewAttempts: z
          .array(backupAttemptSchema)
          .max(HISTORY_LIMIT)
          .refine((entries) => new Set(entries.map((entry) => entry.id)).size === entries.length),
      }),
    )
    .max(200)
    .refine((entries) => new Set(entries.map((entry) => entry.examId)).size === entries.length),
  uiPreferences: uiPreferencesSchema.nullable(),
});
export const readableBackupSchema = z.union([
  backupSchema,
  backupV1Schema.transform((backup) => ({
    ...backup,
    version: 2 as const,
    exams: backup.exams.map((exam) => ({
      ...exam,
      current: exam.current ? normalizeLegacyAttempt(exam.current) : null,
      history: exam.history.map((entry) => ({ ...entry, mode: 'exam' as const })),
      reviewAttempts: [],
    })),
    uiPreferences: backup.uiPreferences
      ? {
          ...backup.uiPreferences,
          storageVersion: 2 as const,
          attemptModePreference: 'ask' as const,
        }
      : null,
  })),
]);
export type BackupV1 = z.infer<typeof backupV1Schema>;
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
function cachedExamLoader(loader: ExamLoader): ExamLoader {
  const exams = new Map<string, Promise<Exam>>();
  return (id) => {
    if (!exams.has(id)) exams.set(id, loader(id));
    return exams.get(id)!;
  };
}
async function readStoredExam(
  exam: CatalogExam,
  storage: Pick<BackupStorage, 'getItem'>,
  loader: ExamLoader,
): Promise<BackupExam> {
  const raw = storage.getItem(storageKey(exam));
  const historyRaw = storage.getItem(historyStorageKey(exam));
  const reviewRaw = storage.getItem(reviewStorageKey(exam));
  let current: Attempt | null = null;
  let history: HistoryEntry[] = [];
  if (raw !== null) {
    const value = readJson(raw);
    const v2 = readableCurrentEnvelopeSchema.safeParse(value);
    if (v2.success) {
      current = v2.data.current;
      await validateCurrent(exam, current, loader);
    } else {
      const v1 = previousEnvelopeSchema.parse(value);
      current = normalizeLegacyAttempt(v1.current);
      const full = await loader(exam.id);
      if (
        full.id !== exam.id ||
        full.revision !== exam.revision ||
        full.questions.length !== exam.questionCount ||
        !isCompatibleAttempt(full, current) ||
        v1.history.some(
          (attempt) =>
            !attempt.completedAt || !isCompatibleAttempt(full, normalizeLegacyAttempt(attempt)),
        )
      )
        throw new Error('Envelope legado incompatível.');
      history = v1.history.map(normalizeLegacyAttempt).map(summary);
      validateHistory(exam, history);
    }
  }
  if (historyRaw !== null) {
    const entries = readableHistoryEnvelopeSchema.parse(readJson(historyRaw)).history;
    validateHistory(exam, entries);
    history = uniqueHistory([...history, ...entries]);
  }
  if (current) {
    const collision = history.find((entry) => entry.id === current.id);
    if (collision && (!current.completedAt || !sameContent(collision, summary(current))))
      throw new Error('Colisão de current e histórico.');
    if (current.completedAt) history = uniqueHistory([...history, summary(current)]);
  }
  const archive =
    reviewRaw === null ? [] : reviewEnvelopeSchema.parse(readJson(reviewRaw)).attempts;
  if (archive.length) validateReviewArchive(await loader(exam.id), archive);
  if (current) {
    const collision = archive.find((attempt) => attempt.id === current.id);
    if (collision && !sameAttemptAcademic(current, collision))
      throw new Error('Colisão de current e revisão.');
  }
  const reviewAttempts = retainReviews(combineDetailedAttempts(current, archive));
  for (const attempt of reviewAttempts) {
    const entry = history.find((entry) => entry.id === attempt.id);
    if (entry && !sameContent(entry, summary(attempt)))
      throw new Error('Colisão de histórico e revisão.');
  }
  return {
    reviewAttempts,
    examId: exam.id,
    revision: exam.revision,
    current,
    history: sortHistory(history).slice(0, HISTORY_LIMIT),
  };
}
function readExportPreferences(storage: Pick<BackupStorage, 'getItem'>): UiPreferences {
  const raw = storage.getItem(uiPreferencesKey);
  if (raw !== null) return readableUiPreferencesSchema.parse(readJson(raw));
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
  loader = cachedExamLoader(loader);
  const snapshot = snapshotStorage(storage);
  const exams: BackupExam[] = [];
  for (const exam of catalog.exams) {
    try {
      const entry = await readStoredExam(exam, snapshot, loader);
      if (entry.current || entry.history.length || entry.reviewAttempts.length) exams.push(entry);
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
      version: 2,
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
    return readableBackupSchema.parse(JSON.parse(text));
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
  const localReviews = local.reviewAttempts;
  if (incoming.current) {
    if (!current) {
      const detail = localReviews.find((attempt) => attempt.id === incoming.current!.id);
      const collision = local.history.find((entry) => entry.id === incoming.current!.id);
      if (
        (detail && !sameAttemptAcademic(detail, incoming.current)) ||
        (collision &&
          (!incoming.current.completedAt || !sameContent(collision, summary(incoming.current))))
      ) {
        conflicts++;
        notes.push(
          'Tentativa importada colide com uma conclusão local; o histórico local foi preservado.',
        );
      } else current = detail ? { ...incoming.current, flagged: detail.flagged } : incoming.current;
    } else if (!sameAttemptAcademic(current, incoming.current)) {
      conflicts++;
      notes.push('Tentativa atual local preservada por conflito.');
    }
  }
  const union = new Map(local.history.map((entry) => [entry.id, entry]));
  const added = new Set<string>();
  for (const entry of incoming.history) {
    const review = localReviews.find((attempt) => attempt.id === entry.id);
    if (review && !sameContent(summary(review), entry)) {
      conflicts++;
      notes.push(`Histórico ${entry.id}: revisão local preservada por conflito.`);
      continue;
    }
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
  const reviews = new Map(localReviews.map((attempt) => [attempt.id, attempt]));
  for (const attempt of incoming.reviewAttempts) {
    const localCurrent = local.current?.id === attempt.id ? local.current : null;
    const localHistory = local.history.find((entry) => entry.id === attempt.id);
    const existing = reviews.get(attempt.id);
    if (
      (localCurrent && !sameAttemptAcademic(localCurrent, attempt)) ||
      (localHistory && !sameContent(localHistory, summary(attempt))) ||
      (existing && !sameAttemptAcademic(existing, attempt)) ||
      (current?.id === attempt.id && !sameAttemptAcademic(current, attempt))
    ) {
      conflicts++;
      notes.push(`Revisão ${attempt.id}: conteúdo local preservado por conflito.`);
      continue;
    }
    if (!existing)
      reviews.set(
        attempt.id,
        current?.id === attempt.id ? { ...attempt, flagged: current.flagged } : attempt,
      );
  }
  const reviewAttempts = retainReviews([...reviews.values()]);
  const history = sortHistory([...union.values()]).slice(0, HISTORY_LIMIT);
  const kept = new Set(history.map((entry) => entry.id));
  const discarded = [...added].filter((id) => !kept.has(id)).length;
  return {
    current,
    history,
    reviewAttempts,
    conflicts,
    notes,
    discarded,
    historiesMerged: [...added].filter((id) => kept.has(id)).length,
  };
}
export async function prepareImport(
  input: Backup | BackupV1,
  catalog: Catalog,
  storage: Pick<BackupStorage, 'getItem'> = window.localStorage,
  loader: ExamLoader = loadExam,
): Promise<ImportPlan> {
  // Also validate callers that bypass parseBackup.
  const backup = readableBackupSchema.parse(input);
  loader = cachedExamLoader(loader);
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
      if (incoming.reviewAttempts.length)
        validateReviewArchive(await loader(exam.id), incoming.reviewAttempts);
      const detailed = [
        ...incoming.reviewAttempts,
        ...(incoming.current ? [incoming.current] : []),
      ];
      for (const attempt of detailed) {
        const entry = incoming.history.find((entry) => entry.id === attempt.id);
        if (entry && (!attempt.completedAt || !sameContent(entry, summary(attempt))))
          throw new Error('Colisão importada.');
      }
      for (const review of incoming.reviewAttempts)
        if (incoming.current?.id === review.id && !sameAttemptAcademic(incoming.current, review))
          throw new Error('Colisão importada.');
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
        change(storageKey(exam), { storageVersion: 3, current: merged.current });
      if (!sameContent(local.history, merged.history))
        change(historyStorageKey(exam), { storageVersion: 3, history: merged.history });
      if (!sameContent(local.reviewAttempts, merged.reviewAttempts))
        change(reviewStorageKey(exam), { storageVersion: 1, attempts: merged.reviewAttempts });
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
      if (before !== null) readableUiPreferencesSchema.parse(readJson(before));
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
    writeTransaction(storage, plan.expected, changes);
  } catch (error) {
    throw new Error(
      `Importação abortada. ${error instanceof Error ? error.message : 'Falha de armazenamento.'}`,
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
