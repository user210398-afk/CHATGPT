import { z } from 'zod';
import type { Exam } from '../types/exam';
import { writeTransaction, type StorageChange } from './storage-transaction';
import { sameContent } from './content-equality';
import {
  attemptSchema,
  legacyAttemptSchema,
  normalizeLegacyAttempt,
  createAttempt,
  isCompatibleAttempt,
  resultSchema,
  type Attempt,
} from './exam-state';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}
export const HISTORY_LIMIT = 20;
// Frozen 7A.2 contracts: v1/v2 always describe Exam mode, without confirmation metadata.
export const historyEntryV2Schema = z.strictObject({
  id: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  result: resultSchema,
});
export const currentV2EnvelopeSchema = z.strictObject({
  storageVersion: z.literal(2),
  current: legacyAttemptSchema,
});
export const historyV2EnvelopeSchema = z.strictObject({
  storageVersion: z.literal(2),
  history: z.array(historyEntryV2Schema).max(HISTORY_LIMIT),
});
export const previousEnvelopeSchema = z.strictObject({
  storageVersion: z.literal(1),
  current: legacyAttemptSchema,
  history: z.array(legacyAttemptSchema).max(HISTORY_LIMIT),
});
export const historyEntrySchema = historyEntryV2Schema.extend({ mode: z.enum(['exam', 'study']) });
export const currentEnvelopeSchema = z.strictObject({
  storageVersion: z.literal(3),
  current: attemptSchema,
});
export const historyEnvelopeSchema = z.strictObject({
  storageVersion: z.literal(3),
  history: z.array(historyEntrySchema).max(HISTORY_LIMIT),
});
export const readableCurrentEnvelopeSchema = z.union([
  currentEnvelopeSchema,
  currentV2EnvelopeSchema.transform((value) => ({
    storageVersion: 3 as const,
    current: normalizeLegacyAttempt(value.current),
  })),
]);
export const readableHistoryEntrySchema = z.union([
  historyEntrySchema,
  historyEntryV2Schema.transform((entry) => ({ ...entry, mode: 'exam' as const })),
]);
export const readableHistoryEnvelopeSchema = z.union([
  historyEnvelopeSchema,
  historyV2EnvelopeSchema.transform((value) => ({
    storageVersion: 3 as const,
    history: value.history.map((entry) => ({ ...entry, mode: 'exam' as const })),
  })),
]);
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export interface Session {
  current: Attempt;
  history: HistoryEntry[];
  warning: string | null;
  restored: boolean;
  persistence: PersistenceSnapshot;
}
export type ReadSession = Omit<Session, 'current'> & { current: Attempt | null };
export function storageKey(exam: Pick<Exam, 'id' | 'revision'>): string {
  return `chatgpt-exams:v1:${exam.id}:r${exam.revision}`;
}
export function historyStorageKey(exam: Pick<Exam, 'id' | 'revision'>): string {
  return `${storageKey(exam)}:history`;
}
export function summary(attempt: Attempt): HistoryEntry {
  if (!attempt.completedAt || !attempt.result)
    throw new Error('Histórico requer tentativa concluída');
  return {
    id: attempt.id,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    result: attempt.result,
    mode: attempt.mode,
  };
}
export function includeCurrent(current: Attempt | null, history: HistoryEntry[]): HistoryEntry[] {
  const entries = current?.completedAt ? [summary(current), ...history] : history;
  const unique = new Map<string, HistoryEntry>();
  for (const entry of entries) if (!unique.has(entry.id)) unique.set(entry.id, entry);
  return [...unique.values()]
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        Date.parse(b.entry.completedAt) - Date.parse(a.entry.completedAt) || a.index - b.index,
    )
    .slice(0, HISTORY_LIMIT)
    .map(({ entry }) => entry);
}
// In-memory contracts only. Unknown reads are undefined, never known-missing null.
export type SourceStatus = 'missing' | 'valid' | 'incompatible' | 'corrupt' | 'unavailable';
export interface PersistenceSource<T> {
  readonly status: SourceStatus;
  readonly raw: string | null | undefined;
  readonly value: T;
  readonly integrity: 'complete' | 'partial' | 'unknown';
}
export interface PersistenceSnapshot {
  readonly key: string;
  readonly current: PersistenceSource<Attempt | null>;
  readonly history: PersistenceSource<HistoryEntry[]>;
  readonly embeddedHistory: PersistenceSource<HistoryEntry[]> | null;
}
export interface SaveOutcome {
  status: 'saved' | 'conflict' | 'blocked' | 'storage-error' | 'invalid';
  history: HistoryEntry[];
  warning: string | null;
  persistence: PersistenceSnapshot;
  aborted: boolean;
  rollbackComplete?: boolean;
}
const authoritative = (source: PersistenceSource<unknown>) =>
  source.status === 'missing' || source.status === 'valid';
function source<T>(
  status: SourceStatus,
  raw: string | null | undefined,
  value: T,
  integrity: PersistenceSource<T>['integrity'] = authoritativeStatus(status)
    ? 'complete'
    : 'unknown',
): PersistenceSource<T> {
  // Tokens also own their parsed data; a consumer cannot mutate rewrite authority.
  function freeze(data: unknown) {
    if (data && typeof data === 'object' && !Object.isFrozen(data)) {
      for (const child of Object.values(data)) freeze(child);
      Object.freeze(data);
    }
  }
  freeze(value);
  return Object.freeze({ status, raw, value, integrity });
}
function authoritativeStatus(status: SourceStatus) {
  return status === 'valid' || status === 'missing';
}
function consistentSummary(exam: Exam, entry: HistoryEntry) {
  const r = entry.result,
    objective = exam.questions.filter((q) => q.type === 'multiple-choice').length;
  return (
    Date.parse(entry.completedAt) >= Date.parse(entry.startedAt) &&
    r.objectiveTotal === objective &&
    r.essayTotal === exam.questions.length - objective &&
    r.correct + r.incorrect === r.objectiveAnswered &&
    r.objectiveAnswered + r.unanswered === objective &&
    r.essayAnswered <= r.essayTotal &&
    r.percentage === (objective ? Math.round((r.correct / objective) * 100) : null)
  );
}
function parseEntries(
  exam: Exam,
  raw: string,
  entries: unknown,
  version: number,
  envelopeValid: boolean,
  embedded = false,
): PersistenceSource<HistoryEntry[]> {
  if (!Array.isArray(entries)) return source('corrupt', raw, []);
  let corrupt = !envelopeValid || entries.length > HISTORY_LIMIT,
    incompatible = false;
  const candidates: HistoryEntry[] = [];
  for (const item of entries.slice(0, HISTORY_LIMIT)) {
    if (embedded) {
      const parsed = legacyAttemptSchema.safeParse(item);
      if (!parsed.success) {
        corrupt = true;
        continue;
      }
      const attempt = normalizeLegacyAttempt(parsed.data);
      if (!attempt.completedAt || !isCompatibleAttempt(exam, attempt)) {
        incompatible = true;
        continue;
      }
      candidates.push(summary(attempt));
    } else {
      // Never accept a v2 entry (missing mode) inside a v3 envelope.
      const parsed = (
        version === 3
          ? historyEntrySchema
          : historyEntryV2Schema.transform((entry) => ({ ...entry, mode: 'exam' as const }))
      ).safeParse(item);
      if (!parsed.success) {
        corrupt = true;
        continue;
      }
      const entry = parsed.data;
      if (!consistentSummary(exam, entry)) {
        incompatible = true;
        continue;
      }
      candidates.push(entry);
    }
  }
  const counts = new Map<string, number>();
  for (const entry of candidates) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  if ([...counts.values()].some((count) => count > 1)) corrupt = true;
  const value = candidates.filter((entry) => counts.get(entry.id) === 1);
  return source(
    corrupt ? 'corrupt' : incompatible ? 'incompatible' : 'valid',
    raw,
    value,
    corrupt || incompatible ? 'partial' : 'complete',
  );
}
function parseHistory(
  exam: Exam,
  raw: string | null | undefined,
): PersistenceSource<HistoryEntry[]> {
  if (raw === undefined) return source('unavailable', raw, []);
  if (raw === null) return source('missing', raw, []);
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return source('corrupt', raw, []);
    if (value.storageVersion !== 2 && value.storageVersion !== 3)
      return source('incompatible', raw, []);
    const schema = value.storageVersion === 3 ? historyEnvelopeSchema : historyV2EnvelopeSchema;
    const envelope = schema.extend({ history: z.unknown() }).safeParse(value);
    return parseEntries(exam, raw, value.history, value.storageVersion, envelope.success);
  } catch {
    return source('corrupt', raw, []);
  }
}
function parseCurrent(
  exam: Exam,
  raw: string | null | undefined,
): Pick<PersistenceSnapshot, 'current' | 'embeddedHistory'> {
  const empty = (status: SourceStatus) => ({
    current: source<Attempt | null>(status, raw, null),
    embeddedHistory: null,
  });
  if (raw === undefined) return empty('unavailable');
  if (raw === null) return empty('missing');
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return empty('corrupt');
    const version = value.storageVersion;
    if (version !== 1 && version !== 2 && version !== 3) return empty('incompatible');
    const envelope =
      version === 1
        ? previousEnvelopeSchema
            .extend({ current: z.unknown(), history: z.unknown() })
            .safeParse(value)
        : (version === 3 ? currentEnvelopeSchema : currentV2EnvelopeSchema)
            .extend({ current: z.unknown() })
            .safeParse(value);
    const embeddedHistory =
      version === 1 ? parseEntries(exam, raw, value.history, 1, envelope.success, true) : null;
    const parsed = (version === 3 ? attemptSchema : legacyAttemptSchema).safeParse(value.current);
    if (!parsed.success) return { current: source('corrupt', raw, null), embeddedHistory };
    const current = version === 3 ? (parsed.data as Attempt) : normalizeLegacyAttempt(parsed.data);
    if (!isCompatibleAttempt(exam, current))
      return { current: source('incompatible', raw, null), embeddedHistory };
    return {
      current: source(envelope.success ? 'valid' : 'corrupt', raw, current),
      embeddedHistory,
    };
  } catch {
    return empty('corrupt');
  }
}
function snapshotHistory(snapshot: PersistenceSnapshot) {
  // Retain the existing read-only legacy collision precedence.
  const entries = [
    ...new Map(
      [...snapshot.history.value, ...(snapshot.embeddedHistory?.value ?? [])].map((entry) => [
        entry.id,
        entry,
      ]),
    ).values(),
  ];
  return includeCurrent(snapshot.current.value, entries);
}
const conflictWarning =
  'O histórico ou a tentativa atual mudou por concorrência. Reabra a prova; os registros locais foram preservados.';
const blockedWarning =
  'O armazenamento local está inválido, incompatível ou indisponível. Os registros foram preservados; esta operação não pode ser salva.';
export class AttemptRepository {
  private readonly snapshots = new WeakSet<PersistenceSnapshot>();
  private readonly uncertain = new WeakSet<PersistenceSnapshot>();
  constructor(readonly storage: () => StorageAdapter) {}
  private snapshot(
    exam: Exam,
    currentRaw: string | null | undefined,
    historyRaw: string | null | undefined,
  ) {
    const snapshot: PersistenceSnapshot = Object.freeze({
      key: storageKey(exam),
      ...parseCurrent(exam, currentRaw),
      history: parseHistory(exam, historyRaw),
    });
    this.snapshots.add(snapshot);
    return snapshot;
  }
  read(exam: Exam): ReadSession {
    const readRaw = (key: string) => {
      try {
        return this.storage().getItem(key);
      } catch {
        return undefined;
      }
    };
    // Acquisition and parsing are independent even if current is unreadable.
    const persistence = this.snapshot(
      exam,
      readRaw(storageKey(exam)),
      readRaw(historyStorageKey(exam)),
    );
    const current = persistence.current.value;
    const warning = !authoritative(persistence.current)
      ? blockedWarning
      : !authoritative(persistence.history) ||
          (persistence.embeddedHistory && !authoritative(persistence.embeddedHistory))
        ? current
          ? 'O histórico local está inválido. A tentativa atual foi restaurada.'
          : 'O histórico local está inválido. O registro existente foi preservado.'
        : null;
    return {
      current,
      history: snapshotHistory(persistence),
      warning,
      restored: current !== null,
      persistence,
    };
  }
  load(exam: Exam): Session {
    const read = this.read(exam);
    return { ...read, current: read.current ?? createAttempt(exam) };
  }
  private integrity(exam: Exam, expected: PersistenceSnapshot, rewriteHistory: boolean) {
    if (!expected || !this.snapshots.has(expected) || expected.key !== storageKey(exam))
      return 'invalid';
    if (
      this.uncertain.has(expected) ||
      !authoritative(expected.current) ||
      expected.history.raw === undefined ||
      (expected.embeddedHistory && !authoritative(expected.embeddedHistory)) ||
      ((rewriteHistory || Boolean(expected.embeddedHistory?.value.length)) &&
        !authoritative(expected.history))
    )
      return 'blocked';
    return null;
  }
  // Read-only preflight for review capture/flags; it never adopts another consumer's raw.
  guard(exam: Exam, expected: PersistenceSnapshot, rewriteHistory = false): string | null {
    const blocked = this.integrity(exam, expected, rewriteHistory);
    if (blocked) return blockedWarning;
    try {
      const store = this.storage();
      return store.getItem(storageKey(exam)) !== expected.current.raw ||
        store.getItem(historyStorageKey(exam)) !== expected.history.raw
        ? conflictWarning
        : null;
    } catch {
      return blockedWarning;
    }
  }
  // Caller supplies bytes recorded from its own successful review transaction, not a new read.
  afterCurrentWrite(
    exam: Exam,
    expected: PersistenceSnapshot,
    ownRaw: string,
  ): PersistenceSnapshot {
    if (this.integrity(exam, expected, false)) throw new Error(blockedWarning);
    return this.snapshot(exam, ownRaw, expected.history.raw);
  }
  save(
    exam: Exam,
    current: Attempt,
    history: HistoryEntry[],
    expected: PersistenceSnapshot,
    additionalExpected?: Map<string, string | null>,
  ): SaveOutcome {
    const reject = (
      status: SaveOutcome['status'],
      warning: string,
      rollbackComplete?: boolean,
    ): SaveOutcome => ({
      status,
      history,
      warning,
      persistence: expected,
      aborted: true,
      rollbackComplete,
    });
    if (!expected || !this.snapshots.has(expected) || expected.key !== storageKey(exam))
      return reject('invalid', 'Token de persistência obrigatório ou inválido.');
    if (!isCompatibleAttempt(exam, current))
      return reject('invalid', 'Tentativa incompatível: o progresso não foi salvo.');
    const starting = expected.current.value?.id !== current.id;
    const integrity = this.integrity(exam, expected, starting || Boolean(current.completedAt));
    if (integrity)
      return reject(
        integrity,
        integrity === 'invalid' ? 'Token de persistência obrigatório ou inválido.' : blockedWarning,
      );
    if (!sameContent(history, snapshotHistory(expected)))
      return reject('invalid', 'Tentativa ou histórico incompatível: o progresso não foi salvo.');
    let store: StorageAdapter;
    try {
      store = this.storage();
    } catch {
      return reject(
        'storage-error',
        'O navegador não conseguiu salvar. Mantenha esta página aberta.',
      );
    }
    const key = storageKey(exam),
      historyKey = historyStorageKey(exam);
    let beforeCurrent = expected.current.raw as string | null,
      beforeHistory = expected.history.raw as string | null;
    let baseHistory = history;
    try {
      const actualCurrent = store.getItem(key),
        actualHistory = store.getItem(historyKey);
      if (actualCurrent !== beforeCurrent || actualHistory !== beforeHistory) {
        const known = expected.current.value;
        const hadHistory = expected.history.status === 'valid' || expected.embeddedHistory !== null;
        const actual = parseCurrent(exam, actualCurrent);
        // Explicit reset: only an unchanged known ongoing current may acknowledge removed history.
        // v1 reset normalizes current to v3 while deleting its embedded summaries.
        const resetCurrent =
          actualCurrent === beforeCurrent ||
          (expected.embeddedHistory &&
            actual.current.status === 'valid' &&
            actualCurrent !== null &&
            JSON.parse(actualCurrent).storageVersion === 3 &&
            sameContent(known, actual.current.value));
        if (
          !hadHistory ||
          !authoritative(expected.history) ||
          actualHistory !== null ||
          !known ||
          known.completedAt ||
          !actual.current.value ||
          actual.current.status !== 'valid' ||
          actual.current.value.completedAt ||
          actual.embeddedHistory?.value.length ||
          current.id !== known.id ||
          !resetCurrent
        )
          return reject('conflict', conflictWarning);
        beforeCurrent = actualCurrent;
        beforeHistory = null;
        baseHistory = [];
      }
    } catch {
      return reject('storage-error', 'O navegador não conseguiu salvar: falha de leitura.');
    }
    const nextHistory = includeCurrent(current, baseHistory);
    const expectedRaws = new Map<string, string | null>([
      [key, beforeCurrent],
      [historyKey, beforeHistory],
    ]);
    if (additionalExpected)
      for (const [guardKey, raw] of additionalExpected) {
        if (expectedRaws.has(guardKey) && expectedRaws.get(guardKey) !== raw)
          return reject('conflict', conflictWarning);
        expectedRaws.set(guardKey, raw);
      }
    const afterCurrent = JSON.stringify({ storageVersion: 3, current });
    const changes: StorageChange[] = [{ key, before: beforeCurrent, after: afterCurrent }];
    // Partial history participates in the guard, but can never be a rewrite source.
    const writeHistory =
      authoritative(expected.history) &&
      nextHistory.length > 0 &&
      !sameContent(
        nextHistory,
        beforeHistory === null ? [] : includeCurrent(null, expected.history.value),
      );
    const afterHistory = writeHistory
      ? JSON.stringify({ storageVersion: 3, history: nextHistory })
      : beforeHistory;
    if (writeHistory) changes.push({ key: historyKey, before: beforeHistory, after: afterHistory });
    let storageFailed = false,
      diverged = false;
    const owned = new Map(expectedRaws);
    // Observe failure kind without changing the shared transaction primitive or parsing its messages.
    const adapter: StorageAdapter = {
      getItem: (k) => {
        try {
          const raw = store.getItem(k);
          if (owned.has(k) && raw !== owned.get(k)) diverged = true;
          return raw;
        } catch (error) {
          storageFailed = true;
          throw error;
        }
      },
      setItem: (k, raw) => {
        owned.set(k, raw);
        try {
          store.setItem(k, raw);
        } catch (error) {
          storageFailed = true;
          throw error;
        }
      },
      ...(store.removeItem
        ? {
            removeItem: (k: string) => {
              owned.set(k, null);
              try {
                store.removeItem!(k);
              } catch (error) {
                storageFailed = true;
                throw error;
              }
            },
          }
        : {}),
    };
    try {
      writeTransaction(adapter, expectedRaws, changes);
      return {
        status: 'saved',
        history: nextHistory,
        warning: !authoritative(expected.history)
          ? 'O histórico local está inválido. O registro existente foi preservado.'
          : null,
        persistence: this.snapshot(exam, afterCurrent, afterHistory),
        aborted: false,
      };
    } catch {
      let rollbackComplete = true;
      try {
        for (const change of changes)
          if (store.getItem(change.key) !== change.before) rollbackComplete = false;
      } catch {
        rollbackComplete = false;
      }
      if (!rollbackComplete) this.uncertain.add(expected);
      const warning = !rollbackComplete
        ? 'O salvamento falhou e o rollback ficou incompleto. Reabra a prova para conferir o progresso local.'
        : storageFailed
          ? 'O navegador não conseguiu salvar. Mantenha esta página aberta para preservar sua tentativa.'
          : conflictWarning;
      return reject(
        storageFailed || !diverged ? 'storage-error' : 'conflict',
        warning,
        rollbackComplete,
      );
    }
  }
}
