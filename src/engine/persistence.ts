import { z } from 'zod';
import type { Exam } from '../types/exam';
import { writeTransaction } from './storage-transaction';
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
function validHistory(history: HistoryEntry[]): boolean {
  return (
    new Set(history.map((item) => item.id)).size === history.length &&
    history.every((item) => Date.parse(item.completedAt) >= Date.parse(item.startedAt))
  );
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
export class AttemptRepository {
  private readonly savedHistory = new Set<string>();
  constructor(readonly storage: () => StorageAdapter) {}
  // UI uses read: no attempt is created until the user chooses a mode.
  read(exam: Exam): ReadSession {
    const fresh: ReadSession = { current: null, history: [], warning: null, restored: false };
    const key = historyStorageKey(exam);
    this.savedHistory.delete(key);
    try {
      const raw = this.storage().getItem(storageKey(exam));
      let current: Attempt | null = null;
      let history: HistoryEntry[] = [];
      if (raw !== null) {
        const value: unknown = JSON.parse(raw);
        const parsed = readableCurrentEnvelopeSchema.safeParse(value);
        if (parsed.success) current = parsed.data.current;
        else {
          const previous = previousEnvelopeSchema.parse(value);
          current = normalizeLegacyAttempt(previous.current);
          const detailed = previous.history.map(normalizeLegacyAttempt);
          if (
            detailed.some((item) => !item.completedAt || !isCompatibleAttempt(exam, item)) ||
            new Set(detailed.map((item) => item.id)).size !== detailed.length
          )
            throw new Error('Histórico legado incompatível');
          history = detailed.map(summary);
        }
        if (!isCompatibleAttempt(exam, current)) throw new Error('Tentativa incompatível');
      }
      let warning: string | null = null;
      try {
        const historyRaw = this.storage().getItem(key);
        if (historyRaw !== null) {
          const entries = readableHistoryEnvelopeSchema.parse(JSON.parse(historyRaw)).history;
          if (!validHistory(entries)) throw new Error('Histórico inválido');
          // Keep legacy local collisions, as in the original read-only bridge.
          history = [
            ...new Map([...entries, ...history].map((entry) => [entry.id, entry])).values(),
          ];
          if (!current?.completedAt || entries.some((entry) => entry.id === current.id))
            this.savedHistory.add(key);
        }
      } catch {
        warning = current
          ? 'O histórico local está inválido. A tentativa atual foi restaurada.'
          : 'O histórico local está inválido. O registro existente foi preservado.';
      }
      return {
        current,
        history: includeCurrent(current, history),
        warning,
        restored: current !== null,
      };
    } catch {
      return {
        ...fresh,
        warning:
          'Não foi possível restaurar o progresso local. O registro anterior será preservado até uma interação explícita.',
      };
    }
  }
  // Compatibility for internal callers that need a fresh in-memory Exam attempt.
  load(exam: Exam): Session {
    const read = this.read(exam);
    return { ...read, current: read.current ?? createAttempt(exam) };
  }
  save(
    exam: Exam,
    current: Attempt,
    history: HistoryEntry[],
    expected?: Map<string, string | null>,
  ): Pick<Session, 'history' | 'warning'> & { aborted?: boolean } {
    const nextHistory = includeCurrent(current, history);
    const historyKey = historyStorageKey(exam);
    if (!isCompatibleAttempt(exam, current))
      return {
        history: nextHistory,
        warning: 'Tentativa incompatível: o progresso não foi salvo.',
      };
    if (expected) {
      const changes = [
        {
          key: storageKey(exam),
          before: expected.get(storageKey(exam))!,
          after: JSON.stringify({ storageVersion: 3, current }),
        },
      ];
      const writeHistory = current.completedAt || !this.savedHistory.has(historyKey);
      if (writeHistory)
        changes.push({
          key: historyKey,
          before: expected.get(historyKey)!,
          after: JSON.stringify({ storageVersion: 3, history: nextHistory }),
        });
      try {
        writeTransaction(this.storage(), expected, changes);
        if (writeHistory) this.savedHistory.add(historyKey);
        return { history: nextHistory, warning: null };
      } catch (error) {
        return {
          history,
          aborted: true,
          warning: `A nova tentativa não foi iniciada. ${error instanceof Error ? error.message : 'Falha de armazenamento.'}`,
        };
      }
    }
    try {
      this.storage().setItem(storageKey(exam), JSON.stringify({ storageVersion: 3, current }));
    } catch {
      return {
        history: nextHistory,
        warning:
          'O navegador não conseguiu salvar. Mantenha esta página aberta para preservar sua tentativa.',
      };
    }
    const newCompletion = current.completedAt && !history.some((item) => item.id === current.id);
    if (nextHistory.length && (newCompletion || !this.savedHistory.has(historyKey))) {
      try {
        this.storage().setItem(
          historyKey,
          JSON.stringify({ storageVersion: 3, history: nextHistory }),
        );
        this.savedHistory.add(historyKey);
      } catch {
        return {
          history: nextHistory,
          warning: 'A tentativa atual foi salva, mas o histórico não pôde ser atualizado.',
        };
      }
    }
    return { history: nextHistory, warning: null };
  }
}
