import { z } from 'zod';
import type { Exam } from '../types/exam';
import {
  attemptSchema,
  createAttempt,
  isCompatibleAttempt,
  resultSchema,
  type Attempt,
} from './exam-state';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const HISTORY_LIMIT = 20;
const historyEntrySchema = z.strictObject({
  id: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  result: resultSchema,
});
const currentEnvelopeSchema = z.strictObject({
  storageVersion: z.literal(2),
  current: attemptSchema,
});
const historyEnvelopeSchema = z.strictObject({
  storageVersion: z.literal(2),
  history: z.array(historyEntrySchema).max(HISTORY_LIMIT),
});
const previousEnvelopeSchema = z.strictObject({
  storageVersion: z.literal(1),
  current: attemptSchema,
  history: z.array(attemptSchema).max(HISTORY_LIMIT),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export interface Session {
  current: Attempt;
  history: HistoryEntry[];
  warning: string | null;
  restored: boolean;
}
export function storageKey(exam: Exam): string {
  return `chatgpt-exams:v1:${exam.id}:r${exam.revision}`;
}
export function historyStorageKey(exam: Exam): string {
  return `${storageKey(exam)}:history`;
}
function summary(attempt: Attempt): HistoryEntry {
  if (!attempt.completedAt || !attempt.result)
    throw new Error('Histórico requer tentativa concluída');
  return {
    id: attempt.id,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    result: attempt.result,
  };
}
function validHistory(history: HistoryEntry[]): boolean {
  return (
    new Set(history.map((item) => item.id)).size === history.length &&
    history.every((item) => Date.parse(item.completedAt) >= Date.parse(item.startedAt))
  );
}
function includeCurrent(current: Attempt, history: HistoryEntry[]): HistoryEntry[] {
  return current.completedAt
    ? [summary(current), ...history.filter((item) => item.id !== current.id)].slice(
        0,
        HISTORY_LIMIT,
      )
    : history;
}
export class AttemptRepository {
  private readonly savedHistory = new Set<string>();
  constructor(private readonly storage: () => StorageAdapter) {}
  load(exam: Exam): Session {
    const fresh: Session = {
      current: createAttempt(exam),
      history: [],
      warning: null,
      restored: false,
    };
    const key = historyStorageKey(exam);
    this.savedHistory.delete(key);
    try {
      const raw = this.storage().getItem(storageKey(exam));
      if (!raw) return fresh;
      const value: unknown = JSON.parse(raw);
      const current = currentEnvelopeSchema.safeParse(value);
      if (current.success) {
        if (!isCompatibleAttempt(exam, current.data.current))
          return {
            ...fresh,
            warning:
              'O progresso salvo é incompatível. Uma nova tentativa foi aberta; o registro anterior só será substituído ao interagir.',
          };
        try {
          const historyRaw = this.storage().getItem(key);
          if (!historyRaw)
            return {
              current: current.data.current,
              history: includeCurrent(current.data.current, []),
              warning: null,
              restored: true,
            };
          const history = historyEnvelopeSchema.safeParse(JSON.parse(historyRaw));
          if (history.success && validHistory(history.data.history)) {
            if (
              !current.data.current.completedAt ||
              history.data.history.some((item) => item.id === current.data.current.id)
            )
              this.savedHistory.add(key);
            return {
              current: current.data.current,
              history: includeCurrent(current.data.current, history.data.history),
              warning: null,
              restored: true,
            };
          }
        } catch {
          // Histórico inválido ou indisponível não impede restaurar a tentativa.
        }
        return {
          current: current.data.current,
          history: includeCurrent(current.data.current, []),
          warning: 'O histórico local está inválido. A tentativa atual foi restaurada.',
          restored: true,
        };
      }
      // Leitura do envelope v1 já gravado na Fase 2. A próxima escrita migra sem apagar a cópia anterior.
      const previous = previousEnvelopeSchema.safeParse(value);
      if (
        !previous.success ||
        !isCompatibleAttempt(exam, previous.data.current) ||
        previous.data.history.some(
          (item) => !item.completedAt || !isCompatibleAttempt(exam, item),
        ) ||
        new Set(previous.data.history.map((item) => item.id)).size !== previous.data.history.length
      ) {
        return {
          ...fresh,
          warning:
            'O progresso salvo é incompatível. Uma nova tentativa foi aberta; o registro anterior só será substituído ao interagir.',
        };
      }
      return {
        current: previous.data.current,
        history: includeCurrent(previous.data.current, previous.data.history.map(summary)),
        warning: null,
        restored: true,
      };
    } catch {
      return {
        ...fresh,
        warning: 'Não foi possível restaurar o progresso local. Você pode continuar nesta sessão.',
      };
    }
  }
  save(
    exam: Exam,
    current: Attempt,
    history: HistoryEntry[],
  ): Pick<Session, 'history' | 'warning'> {
    const nextHistory = includeCurrent(current, history);
    const historyKey = historyStorageKey(exam);
    try {
      this.storage().setItem(storageKey(exam), JSON.stringify({ storageVersion: 2, current }));
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
          JSON.stringify({ storageVersion: 2, history: nextHistory }),
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
