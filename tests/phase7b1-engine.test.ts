import { describe, expect, it } from 'vitest';
import {
  createAttempt,
  transition,
  isCompatibleAttempt,
  pendingConfirmationIds,
  calculateResult,
  attemptSchema,
} from '../src/engine/exam-state';
import { poc, first, firstEssay } from './fixtures';
const now = '2026-10-03T10:00:00.000Z',
  end = '2026-10-03T11:00:00.000Z';
function study() {
  return createAttempt(poc, now, 'study-attempt', 'study');
}
const answer = (state = study(), id = first.id, value = 'option-1') =>
  transition(poc, state, { type: 'answer', questionId: id, value });
const confirm = (state = answer(), id = first.id) =>
  transition(poc, state, { type: 'confirm-answer', questionId: id });
describe('Study guards, immutable answers and single academic authority', () => {
  it('creates explicit modes with empty confirmations', () => {
    expect(study()).toMatchObject({ mode: 'study', confirmedQuestionIds: [] });
    expect(createAttempt(poc, now, 'exam-attempt', 'exam')).toMatchObject({
      mode: 'exam',
      confirmedQuestionIds: [],
    });
  });
  it('draft can change until explicit confirmation; repeated confirmation and edits are no-ops', () => {
    const draft = answer(answer(), first.id, 'option-2');
    expect(draft.answers[first.id]).toBe('option-2');
    const confirmed = confirm(draft);
    expect(confirmed.currentIndex).toBe(draft.currentIndex);
    expect(confirmed.confirmedQuestionIds).toEqual([first.id]);
    expect(confirm(confirmed)).toBe(confirmed);
    expect(answer(confirmed)).toBe(confirmed);
    expect(answeredResult(confirmed)).toEqual(
      calculateResult(poc, { ...confirmed, mode: 'exam', confirmedQuestionIds: [] }),
    );
  });
  it.each(['exam', 'missing', 'unanswered', 'finished'] as const)(
    'rejects confirmation: %s',
    (kind) => {
      const state =
        kind === 'exam'
          ? createAttempt(poc, now, 'exam', 'exam')
          : kind === 'finished'
            ? transition(poc, study(), { type: 'finish', now: end })
            : study();
      expect(confirm(state, kind === 'missing' ? 'absent' : first.id)).toBe(state);
    },
  );
  it('essay confirmation requires nonblank text, locks it and does not grade it', () => {
    const blank = answer(study(), firstEssay.id, '   ');
    expect(confirm(blank, firstEssay.id)).toBe(blank);
    const draft = answer(blank, firstEssay.id, 'Meu raciocínio');
    const confirmed = confirm(draft, firstEssay.id);
    expect(answer(confirmed, firstEssay.id, 'alteração')).toBe(confirmed);
    expect(calculateResult(poc, confirmed)).toMatchObject({
      essayAnswered: 1,
      correct: 0,
      incorrect: 0,
    });
  });
  it('finish rejects drafts without confirming them; blank questions are allowed', () => {
    const draft = answer();
    expect(pendingConfirmationIds(poc, draft)).toEqual([first.id]);
    expect(transition(poc, draft, { type: 'finish', now: end })).toBe(draft);
    expect(draft.confirmedQuestionIds).toEqual([]);
    const finished = transition(poc, confirm(draft), { type: 'finish', now: end });
    expect(finished.completedAt).toBe(end);
    expect(finished.result).toEqual(calculateResult(poc, finished));
    expect(isCompatibleAttempt(poc, finished)).toBe(true);
  });
  it.each(['exam', 'study'] as const)('post-completion flag in %s changes only flagged', (mode) => {
    const finished = transition(poc, createAttempt(poc, now, 'attempt', mode), {
      type: 'finish',
      now: end,
    });
    const marked = transition(poc, finished, { type: 'flag', questionId: first.id });
    expect(marked.flagged).toEqual([first.id]);
    const { flagged: _flagged, ...rest } = marked,
      { flagged: _before, ...before } = finished;
    expect(rest).toEqual(before);
    expect(marked.answers).toBe(finished.answers);
    expect(marked.result).toBe(finished.result);
    expect(transition(poc, marked, { type: 'flag', questionId: first.id })).toEqual(finished);
    expect(answer(marked)).toBe(marked);
    expect(confirm(marked)).toBe(marked);
    expect(transition(poc, marked, { type: 'finish', now: end })).toBe(marked);
  });
  it.each([
    { mode: 'other' },
    { confirmedQuestionIds: [first.id, first.id] },
    { confirmedQuestionIds: ['absent'] },
    { mode: 'exam', confirmedQuestionIds: [first.id] },
    { confirmedQuestionIds: [firstEssay.id] },
  ])('rejects malformed/semantically incompatible attempt %#', (patch) => {
    const value = { ...answer(), ...patch };
    expect(isCompatibleAttempt(poc, value as ReturnType<typeof study>)).toBe(false);
  });
  it('completed Study with an answered draft is incompatible even with valid result', () => {
    const draft = answer();
    expect(
      isCompatibleAttempt(poc, { ...draft, completedAt: end, result: calculateResult(poc, draft) }),
    ).toBe(false);
  });
  it('strict mode schema rejects unknown keys and invalid mode', () => {
    expect(attemptSchema.safeParse({ ...study(), injected: true }).success).toBe(false);
    expect(attemptSchema.safeParse({ ...study(), mode: 'ask' }).success).toBe(false);
  });
});
function answeredResult(state: ReturnType<typeof study>) {
  return calculateResult(poc, state);
}
