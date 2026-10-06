import { describe, expect, it } from 'vitest';
import {
  reviewSessionSchema,
  createReviewSession,
  isCompatibleReviewSession,
  selectReviewQuestions,
  transitionReviewSession as step,
  pendingSessionConfirmations,
  sessionQuestionState,
} from '../src/engine/review-session';
import { attemptSchema, calculateResult } from '../src/engine/exam-state';
import {
  all,
  end,
  essay,
  now,
  objective,
  second,
  session,
  source,
  tiny,
} from './phase7b2b-fixtures';
import { defaultReviewFilters } from '../src/engine/review-filters';
function answer(mode: 'exam' | 'study' = 'exam') {
  if (objective.type !== 'multiple-choice') throw new Error('fixture');
  return step(tiny, session(mode), {
    type: 'answer',
    questionId: objective.id,
    value: objective.correctAnswer,
  });
}
describe('ReviewSession dedicated strict schema and academic compatibility', () => {
  it('valid session and no Attempt contract', () => {
    expect(reviewSessionSchema.safeParse(session()).success).toBe(true);
    expect(attemptSchema.safeParse(session()).success).toBe(false);
    expect(attemptSchema.safeParse(sessionQuestionState(session(), [])).success).toBe(false);
  });
  it.each([
    ['duplicate questions', { questionIds: [objective.id, objective.id] }],
    ['empty selection', { questionIds: [] }],
    ['negative position', { currentIndex: -1 }],
    ['overflow position', { currentIndex: 3 }],
    ['outside answer', { answers: { outside: 'a' } }],
    ['outside confirmed', { confirmedQuestionIds: ['outside'] }],
    [
      'duplicate confirmed',
      {
        mode: 'study',
        answers: { [objective.id]: 'option-1' },
        confirmedQuestionIds: [objective.id, objective.id],
      },
    ],
    ['invalid mode', { mode: 'review' }],
    ['invalid start', { startedAt: 'yesterday' }],
    ['invalid completion', { completedAt: 'invalid' }],
    ['completion without result', { completedAt: end }],
    ['result without completion', { result: { total: 3 } }],
    ['future source', { sourceCompletedAt: end }],
    ['unknown field', { storageKey: 'untrusted' }],
    [
      'exam confirmations',
      { confirmedQuestionIds: [objective.id], answers: { [objective.id]: 'option-1' } },
    ],
  ])('rejects %s', (_label, patch) =>
    expect(reviewSessionSchema.safeParse({ ...session(), ...patch }).success).toBe(false),
  );
  it.each([
    ['exam', { examId: 'another' }],
    ['revision', { examRevision: 2 }],
    ['unknown question', { questionIds: ['outside'] }],
    ['wrong order', { questionIds: [essay.id, objective.id] }],
    ['invalid answer option', { answers: { [objective.id]: 'non-option' } }],
  ])('rejects incompatible %s against Exam', (_label, patch) =>
    expect(isCompatibleReviewSession(tiny, { ...session(), ...patch })).toBe(false),
  );
  it('rejects inconsistent completion results, including a well-shaped forged score', () => {
    const done = step(tiny, answer(), { type: 'finish', now: end });
    expect(isCompatibleReviewSession(tiny, done)).toBe(true);
    expect(
      isCompatibleReviewSession(tiny, {
        ...done,
        result: { ...done.result!, correct: 0, incorrect: 1, percentage: 0 },
      }),
    ).toBe(false);
    expect(
      reviewSessionSchema.safeParse({ ...done, result: { ...done.result!, total: 2 } }).success,
    ).toBe(false);
    expect(
      reviewSessionSchema.safeParse({ ...done, completedAt: '2026-10-05T17:30:00.000Z' }).success,
    ).toBe(false);
  });
  it('start requires a completed compatible official source and nonempty selected questions', () => {
    expect(() =>
      createReviewSession(tiny, { ...source(), completedAt: null, result: null }, all, 'exam', now),
    ).toThrow();
    expect(() =>
      createReviewSession(
        tiny,
        source(),
        { kind: 'filtered', filters: { ...defaultReviewFilters, category: 'absent' } },
        'exam',
        now,
      ),
    ).toThrow();
  });
});
describe('session engine subset behavior', () => {
  it.each(['exam', 'study'] as const)(
    'red team: every selection starts %s with genuinely empty answers and confirmations',
    (mode) => {
      for (const selection of [{ kind: 'incorrect' }, { kind: 'flagged' }, all] as const) {
        const original = source();
        original.answers[essay.id] = 'source essay must not be copied';
        original.result = calculateResult(tiny, original);
        const state = createReviewSession(tiny, original, selection, mode, now, 'blank');
        expect(state.answers).toEqual({});
        expect(state.confirmedQuestionIds).toEqual([]);
        expect(state.result).toBeNull();
      }
    },
  );
  it.each(['100%', '0%', 'partial', 'essay only', 'mixed', 'single'])(
    'red team: mathematical score invariants for %s',
    (kind) => {
      let state = session(
        'exam',
        kind === 'essay only'
          ? { kind: 'filtered', filters: { ...defaultReviewFilters, status: 'essay' } }
          : kind === 'single'
            ? { kind: 'incorrect' }
            : all,
      );
      for (const q of tiny.questions) {
        if (!state.questionIds.includes(q.id)) continue;
        if (q.type === 'essay') {
          if (kind === 'mixed' || kind === 'essay only')
            state = step(tiny, state, { type: 'answer', questionId: q.id, value: 'new reasoning' });
        } else if (kind !== 'partial' || q.id === objective.id) {
          state = step(tiny, state, {
            type: 'answer',
            questionId: q.id,
            value:
              kind === '0%' ? q.options.find((o) => o.id !== q.correctAnswer)!.id : q.correctAnswer,
          });
        }
      }
      const result = step(tiny, state, { type: 'finish', now: end }).result!;
      expect(result.objectiveAnswered).toBe(result.correct + result.incorrect);
      expect(result.objectiveAnswered + result.unanswered).toBe(result.objectiveTotal);
      expect(result.essayAnswered).toBeLessThanOrEqual(result.essayTotal);
      expect(result.percentage).toBe(
        kind === 'essay only' ? null : kind === '0%' ? 0 : kind === 'partial' ? 50 : 100,
      );
      expect(isCompatibleReviewSession(tiny, step(tiny, state, { type: 'finish', now: end }))).toBe(
        true,
      );
    },
  );
  it('starts without copying source answers and freezes selection', () => {
    const selection = structuredClone(all),
      state = createReviewSession(tiny, source(), selection, 'study', now, 'fixed');
    if (selection.kind === 'filtered') selection.filters.status = 'incorrect';
    expect(state).toMatchObject({
      id: 'fixed',
      answers: {},
      result: null,
      mode: 'study',
      sourceAttemptId: 'source',
    });
    expect(state.selection).toEqual(all);
  });
  it('objective accepts valid responses and rejects outsiders and invalid options', () => {
    const state = answer();
    expect(Object.keys(state.answers)).toEqual([objective.id]);
    expect(step(tiny, state, { type: 'answer', questionId: 'outside', value: 'option-1' })).toBe(
      state,
    );
    expect(step(tiny, state, { type: 'answer', questionId: objective.id, value: 'invalid' })).toBe(
      state,
    );
  });
  it('rejects questions outside the subset', () => {
    const state = session('study', { kind: 'incorrect' });
    expect(step(tiny, state, { type: 'answer', questionId: essay.id, value: 'text' })).toBe(state);
    expect(step(tiny, state, { type: 'confirm-answer', questionId: second.id })).toBe(state);
  });
  it.each([-1, 3, 0.5, NaN])('invalid navigation %s preserves state', (index) => {
    const state = session();
    expect(step(tiny, state, { type: 'navigate', index })).toBe(state);
  });
  it('navigates deterministically without changing answers', () =>
    expect(step(tiny, answer(), { type: 'navigate', index: 2 })).toMatchObject({
      currentIndex: 2,
      answers: answer().answers,
    }));
  it('Exam permits edits and has no confirmations', () => {
    const state = answer();
    expect(step(tiny, state, { type: 'confirm-answer', questionId: objective.id })).toBe(state);
    if (objective.type !== 'multiple-choice') throw new Error('fixture');
    const correct = objective.correctAnswer;
    const alternate = objective.options.find((o) => o.id !== correct)!.id;
    expect(
      step(tiny, state, { type: 'answer', questionId: objective.id, value: alternate }).answers[
        objective.id
      ],
    ).toBe(alternate);
  });
  it('Study explicit confirmation locks response without advancing', () => {
    const draft = answer('study'),
      confirmed = step(tiny, draft, { type: 'confirm-answer', questionId: objective.id });
    expect(confirmed.currentIndex).toBe(0);
    expect(confirmed.confirmedQuestionIds).toEqual([objective.id]);
    expect(step(tiny, confirmed, { type: 'answer', questionId: objective.id, value: '' })).toBe(
      confirmed,
    );
    expect(step(tiny, confirmed, { type: 'confirm-answer', questionId: objective.id })).toBe(
      confirmed,
    );
    expect(
      step(tiny, session('study'), { type: 'confirm-answer', questionId: objective.id })
        .confirmedQuestionIds,
    ).toEqual([]);
  });
  it('Study draft blocks finish, confirmation unblocks', () => {
    const draft = answer('study');
    expect(pendingSessionConfirmations(tiny, draft)).toEqual([objective.id]);
    expect(step(tiny, draft, { type: 'finish', now: end })).toBe(draft);
    expect(
      step(tiny, step(tiny, draft, { type: 'confirm-answer', questionId: objective.id }), {
        type: 'finish',
        now: end,
      }).completedAt,
    ).toBe(end);
  });
  it('subset objective scoring and unanswered use only selected questions', () => {
    let state = session('exam', { kind: 'incorrect' });
    if (objective.type !== 'multiple-choice') throw new Error('fixture');
    expect(step(tiny, state, { type: 'finish', now: end }).result).toMatchObject({
      total: 1,
      objectiveTotal: 1,
      unanswered: 1,
      percentage: 0,
    });
    state = step(tiny, state, {
      type: 'answer',
      questionId: objective.id,
      value: objective.correctAnswer,
    });
    expect(step(tiny, state, { type: 'finish', now: end }).result).toMatchObject({
      total: 1,
      correct: 1,
      percentage: 100,
      essayTotal: 0,
    });
    const incorrect = step(tiny, state, {
      type: 'answer',
      questionId: objective.id,
      value: source().answers[objective.id]!,
    });
    expect(step(tiny, incorrect, { type: 'finish', now: end }).result!.incorrect).toBe(1);
  });
  it('essays compare explicitly, receive no automatic grade', () => {
    let state = session('study', {
      kind: 'filtered',
      filters: { ...defaultReviewFilters, status: 'essay' },
    });
    state = step(tiny, state, { type: 'answer', questionId: essay.id, value: 'reasoning' });
    state = step(tiny, state, { type: 'confirm-answer', questionId: essay.id });
    expect(step(tiny, state, { type: 'finish', now: end }).result).toMatchObject({
      total: 1,
      essayTotal: 1,
      essayAnswered: 1,
      objectiveTotal: 0,
      percentage: null,
    });
  });
  it('completed answers stay immutable and feedback navigation remains available', () => {
    const state = step(tiny, answer(), { type: 'finish', now: end });
    expect(step(tiny, state, { type: 'answer', questionId: objective.id, value: '' })).toBe(state);
    expect(step(tiny, state, { type: 'finish', now: end })).toBe(state);
    expect(step(tiny, state, { type: 'navigate', index: 2 }).currentIndex).toBe(2);
  });
  it.each(['invalid', '2026-10-05T16:00:00.000Z'])('rejects finish at %s', (now) => {
    const state = session();
    expect(step(tiny, state, { type: 'finish', now })).toBe(state);
  });
});
describe('review selection preserves original AND filters and order', () => {
  it('incorrect only objectively wrong, not essay/unanswered/correct', () =>
    expect(selectReviewQuestions(tiny, source(), { kind: 'incorrect' })).toEqual([objective.id]));
  it('flags include essay in original exam order', () =>
    expect(selectReviewQuestions(tiny, source(), { kind: 'flagged' })).toEqual([
      objective.id,
      essay.id,
    ]));
  it.each([
    [{ status: 'incorrect', flaggedOnly: true, category: 'A', tag: 'x' }, [objective.id]],
    [{ status: 'incorrect', flaggedOnly: true, category: 'A', tag: 'y' }, []],
    [{ status: 'all', flaggedOnly: false, category: 'A', tag: 'z' }, [objective.id, second.id]],
    [{ status: 'essay', flaggedOnly: true, category: 'B', tag: 'x' }, [essay.id]],
    [{ status: 'correct', flaggedOnly: true, category: '', tag: '' }, []],
    [{ status: 'unanswered', flaggedOnly: false, category: '', tag: '' }, []],
  ] as const)('exact AND filters %o', (filters, expected) =>
    expect(selectReviewQuestions(tiny, source(), { kind: 'filtered', filters })).toEqual(expected),
  );
  it('selection unchanged when flags or live filters change after start', () => {
    const state = session('exam', { kind: 'flagged' });
    const changedSource = { ...source(), flagged: [] };
    expect(selectReviewQuestions(tiny, changedSource, { kind: 'flagged' })).toEqual([]);
    expect(state.questionIds).toEqual([objective.id, essay.id]);
  });
});
