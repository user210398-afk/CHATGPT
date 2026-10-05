import { vi } from 'vitest';
import { createAttempt, transition, type Attempt } from '../src/engine/exam-state';
import { poc, first } from './fixtures';
const now = '2026-10-03T10:00:00.000Z',
  end = '2026-10-03T11:00:00.000Z';
export function memory(entries: [string, string][] = []) {
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
export function finished(mode: 'exam' | 'study' = 'exam', id = 'complete'): Attempt {
  let state = createAttempt(poc, now, id, mode);
  state = transition(poc, state, { type: 'answer', questionId: first.id, value: 'option-1' });
  if (mode === 'study')
    state = transition(poc, state, { type: 'confirm-answer', questionId: first.id });
  return transition(poc, state, { type: 'finish', now: end });
}
