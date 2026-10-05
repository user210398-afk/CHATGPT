import { describe, expect, it } from 'vitest';
import {
  answeredCount,
  calculateResult,
  createAttempt,
  transition,
} from '../src/engine/exam-state';
import { poc, first, firstEssay } from './fixtures';
const start = '2026-10-03T10:00:00.000Z';
const end = '2026-10-03T10:10:00.000Z';

describe('Exam Engine', () => {
  it('responde, muda a alternativa e ignora respostas inexistentes', () => {
    const fresh = createAttempt(poc, start);
    const answered = transition(poc, fresh, {
      type: 'answer',
      questionId: first.id,
      value: 'option-1',
    });
    const changed = transition(poc, answered, {
      type: 'answer',
      questionId: first.id,
      value: 'option-2',
    });
    expect(changed.answers[first.id]).toBe('option-2');
    expect(fresh.answers).toEqual({});
    expect(answeredCount(poc, changed)).toBe(1);
    expect(
      transition(poc, changed, { type: 'answer', questionId: first.id, value: 'option-99' }),
    ).toBe(changed);
  });
  it('navega dentro dos limites e alterna marcação', () => {
    const fresh = createAttempt(poc, start);
    expect(transition(poc, fresh, { type: 'navigate', index: -1 })).toBe(fresh);
    expect(transition(poc, fresh, { type: 'navigate', index: 30 })).toBe(fresh);
    expect(transition(poc, fresh, { type: 'navigate', index: 29 }).currentIndex).toBe(29);
    const marked = transition(poc, fresh, { type: 'flag', questionId: first.id });
    expect(marked.flagged).toEqual([first.id]);
    expect(transition(poc, marked, { type: 'flag', questionId: first.id }).flagged).toEqual([]);
  });
  it('conta dissertativa respondida sem correção textual e finaliza uma só vez', () => {
    let state = createAttempt(poc, start);
    state = transition(poc, state, { type: 'answer', questionId: firstEssay.id, value: '   ' });
    expect(answeredCount(poc, state)).toBe(0);
    state = transition(poc, state, {
      type: 'answer',
      questionId: firstEssay.id,
      value: 'Minha resposta livre',
    });
    state = transition(poc, state, { type: 'answer', questionId: first.id, value: 'option-2' });
    state = transition(poc, state, {
      type: 'answer',
      questionId: poc.questions[1]!.id,
      value: 'option-1',
    });
    expect(answeredCount(poc, state)).toBe(3);
    state = transition(poc, state, { type: 'finish', now: end });
    expect(state.result).toEqual({
      objectiveTotal: 20,
      objectiveAnswered: 2,
      correct: 1,
      incorrect: 1,
      unanswered: 18,
      percentage: 5,
      essayTotal: 10,
      essayAnswered: 1,
    });
    expect(transition(poc, state, { type: 'finish', now: end })).toBe(state);
    expect(
      transition(poc, state, { type: 'answer', questionId: first.id, value: 'option-1' }),
    ).toBe(state);
    const flagged = transition(poc, state, { type: 'flag', questionId: first.id });
    expect(flagged.flagged).toEqual([first.id]);
    expect(flagged.answers).toBe(state.answers);
    expect(flagged.result).toBe(state.result);
    expect(transition(poc, state, { type: 'navigate', index: 2 }).currentIndex).toBe(2);
  });
  it('aceita sequência intercalada e prova só dissertativa sem divisão por zero', () => {
    const mixed = { ...poc, questions: [first, firstEssay, poc.questions[1]!, poc.questions[21]!] };
    expect(calculateResult(mixed, createAttempt(mixed, start))).toMatchObject({
      objectiveTotal: 2,
      essayTotal: 2,
    });
    const essayExam = { ...poc, questions: [firstEssay] };
    expect(calculateResult(essayExam, createAttempt(essayExam, start))).toMatchObject({
      objectiveTotal: 0,
      percentage: null,
      essayTotal: 1,
    });
  });
});
