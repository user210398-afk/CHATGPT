import { z } from 'zod';
import type { Exam } from '../types/exam';
import { attemptSchema, createAttempt, isCompatibleAttempt, type Attempt } from './exam-state';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const HISTORY_LIMIT = 20;
const envelopeSchema = z.strictObject({
  storageVersion: z.literal(1),
  current: attemptSchema,
  history: z.array(attemptSchema).max(HISTORY_LIMIT),
});
export interface Session {
  current: Attempt;
  history: Attempt[];
  warning: string | null;
  restored: boolean;
}
export function storageKey(exam: Exam): string {
  return `chatgpt-exams:v1:${exam.id}:r${exam.revision}`;
}
export class AttemptRepository {
  constructor(private readonly storage: () => StorageAdapter) {}
  load(exam: Exam): Session {
    const fresh: Session = {
      current: createAttempt(exam),
      history: [],
      warning: null,
      restored: false,
    };
    try {
      const raw = this.storage().getItem(storageKey(exam));
      if (!raw) return fresh;
      const parsed = envelopeSchema.safeParse(JSON.parse(raw));
      if (
        !parsed.success ||
        !isCompatibleAttempt(exam, parsed.data.current) ||
        parsed.data.history.some(
          (attempt) => !attempt.completedAt || !isCompatibleAttempt(exam, attempt),
        ) ||
        new Set(parsed.data.history.map((a) => a.id)).size !== parsed.data.history.length
      ) {
        return {
          ...fresh,
          warning:
            'O progresso salvo é incompatível. Uma nova tentativa foi aberta; o registro anterior só será substituído ao interagir.',
        };
      }
      return {
        current: parsed.data.current,
        history: parsed.data.history,
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
  save(exam: Exam, current: Attempt, history: Attempt[]): Pick<Session, 'history' | 'warning'> {
    const nextHistory = current.completedAt
      ? [current, ...history.filter((attempt) => attempt.id !== current.id)].slice(0, HISTORY_LIMIT)
      : history;
    try {
      this.storage().setItem(
        storageKey(exam),
        JSON.stringify({ storageVersion: 1, current, history: nextHistory }),
      );
      return { history: nextHistory, warning: null };
    } catch {
      return {
        history: nextHistory,
        warning:
          'O navegador não conseguiu salvar. Mantenha esta página aberta para preservar sua tentativa.',
      };
    }
  }
}
