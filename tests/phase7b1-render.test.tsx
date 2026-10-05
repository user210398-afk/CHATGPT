import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExamPage } from '../src/components/exam/ExamPage';
import { ReviewView } from '../src/components/review/ReviewView';
import { ReviewPage } from '../src/app/ReviewPage';
import { App } from '../src/app/App';
import { DashboardPage } from '../src/app/DashboardPage';
import { createAttempt, transition } from '../src/engine/exam-state';
import { storageKey, historyStorageKey } from '../src/engine/persistence';
import { reviewStorageKey, ReviewRepository } from '../src/engine/review-history';
import { defaultUiPreferences, uiPreferencesKey } from '../src/engine/ui-preferences';
import { reviewUrl, resolveRoute } from '../src/utils/paths';
import {
  reviewQuestionIndices,
  reviewCounts,
  defaultReviewFilters,
  type ReviewStatus,
} from '../src/engine/review-filters';
import { poc, first, firstEssay } from './fixtures';
import { catalogExam } from './catalog-fixtures';
import { finished } from './phase7b1-fixtures';
const user = () => userEvent.setup();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});
const text = (value: string) => [{ type: 'text' as const, text: value }];
const tiny = {
  ...poc,
  questions: [
    {
      ...structuredClone(first),
      category: 'A',
      tags: ['x'],
      explanation: text('feedback exclusivo objetivo'),
    },
    {
      ...structuredClone(firstEssay),
      category: 'B',
      tags: ['y'],
      modelAnswer: text('modelo exclusivo essay'),
      explanation: text('feedback exclusivo essay'),
    },
  ],
};
describe('chooser, defaults and study feedback rendering', () => {
  it('ask opens chooser without writes or creating attempt; explicit choice starts Exam', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem'),
      uuid = vi.spyOn(crypto, 'randomUUID');
    render(<ExamPage exam={tiny} />);
    expect(
      screen.getByRole('heading', { name: 'Como deseja fazer esta tentativa?' }),
    ).toHaveFocus();
    expect(writes).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    expect(screen.queryByRole('radio')).toBeNull();
    await user().click(screen.getByRole('button', { name: 'Iniciar em Modo Prova' }));
    expect(JSON.parse(localStorage.getItem(storageKey(tiny))!).current.mode).toBe('exam');
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(1);
  });
  it.each(['exam', 'study'] as const)(
    'default %s auto-starts, but restored current keeps its own mode',
    async (mode) => {
      const view = render(<ExamPage exam={tiny} preference={mode} />);
      expect(JSON.parse(localStorage.getItem(storageKey(tiny))!).current.mode).toBe(mode);
      view.unmount();
      const writes = vi.spyOn(Storage.prototype, 'setItem');
      render(<ExamPage exam={tiny} preference={mode === 'exam' ? 'study' : 'exam'} />);
      expect(writes).not.toHaveBeenCalled();
      expect(
        screen.getByText(
          mode === 'exam'
            ? 'Feedback após finalizar.'
            : 'Confirme cada resposta para liberar o feedback.',
        ),
      ).toBeInTheDocument();
    },
  );
  it('Study draft hides all feedback from DOM, allows changes, then locks on confirmation without auto-next', async () => {
    render(<ExamPage exam={tiny} />);
    await user().click(screen.getByRole('button', { name: 'Iniciar em Modo Estudo' }));
    expect(screen.queryByRole('button', { name: 'Confirmar resposta' })).toBeNull();
    const radios = screen.getAllByRole('radio');
    await user().click(radios[0]!);
    await user().click(radios[1]!);
    expect(radios[1]).toBeChecked();
    expect(document.body).not.toHaveTextContent('feedback exclusivo objetivo');
    expect(document.querySelector('.correct')).toBeNull();
    expect(screen.queryByText('Resposta correta')).toBeNull();
    await user().click(screen.getByRole('button', { name: 'Confirmar resposta' }));
    expect(screen.getByText('feedback exclusivo objetivo')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Resposta correta');
    for (const radio of radios) expect(radio).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Questão 1 de 2' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ir para questão 1, confirmada' }),
    ).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem(storageKey(tiny))!).current.confirmedQuestionIds,
    ).toEqual([first.id]);
  });
  it('essay draft is editable and hidden; comparison locks textarea with no grade', async () => {
    render(<ExamPage exam={tiny} preference="study" />);
    await user().click(screen.getByRole('button', { name: 'Ir para questão 2, em branco' }));
    expect(screen.getByRole('button', { name: 'Confirmar e comparar' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rascunho' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'resposta final' } });
    expect(document.body).not.toHaveTextContent('modelo exclusivo essay');
    expect(document.body).not.toHaveTextContent('feedback exclusivo essay');
    await user().click(screen.getByRole('button', { name: 'Confirmar e comparar' }));
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox')).toHaveValue('resposta final');
    expect(screen.getByText('modelo exclusivo essay')).toBeInTheDocument();
    expect(screen.getByText('feedback exclusivo essay')).toBeInTheDocument();
    expect(screen.getByText('Resposta confirmada')).toBeInTheDocument();
    expect(screen.queryByText('Resposta correta')).toBeNull();
    expect(screen.queryByText('Resposta incorreta')).toBeNull();
  });
  it('pending draft blocks finish with direct navigation; reload retains confirmed locks and editable drafts', async () => {
    const view = render(<ExamPage exam={tiny} preference="study" />);
    await user().click(screen.getAllByRole('radio')[0]!);
    await user().click(screen.getByRole('button', { name: 'Confirmar resposta' }));
    await user().click(screen.getByRole('button', { name: 'Próxima →' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'draft pendente' } });
    await user().click(screen.getByRole('button', { name: 'Finalizar tentativa' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Existem 1 respostas ainda não confirmadas.',
    );
    expect(screen.queryByRole('button', { name: 'Confirmar finalização' })).toBeNull();
    await user().click(screen.getByRole('button', { name: 'Ir para primeira resposta pendente' }));
    view.unmount();
    render(<ExamPage exam={tiny} preference="exam" />);
    expect(screen.getByRole('textbox')).not.toHaveAttribute('readonly');
    expect(screen.getByRole('textbox')).toHaveValue('draft pendente');
    await user().click(screen.getByRole('button', { name: 'Ir para questão 1, confirmada' }));
    expect(screen.getAllByRole('radio')[0]).toBeDisabled();
    await user().click(screen.getByRole('button', { name: 'Próxima →' }));
    await user().click(screen.getByRole('button', { name: 'Confirmar e comparar' }));
    await user().click(screen.getByRole('button', { name: 'Finalizar tentativa' }));
    await user().click(screen.getByRole('button', { name: 'Confirmar finalização' }));
    expect(screen.getByRole('heading', { name: 'Seu resultado' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(reviewStorageKey(tiny))!).attempts).toHaveLength(1);
  });
  it('capture failure keeps principal result, restart failure preserves current', async () => {
    render(<ExamPage exam={tiny} preference="exam" />);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === reviewStorageKey(tiny)) throw new Error('quota');
      original.call(this, key, value);
    });
    await user().click(screen.getByRole('button', { name: 'Finalizar tentativa' }));
    await user().click(screen.getByRole('button', { name: 'Confirmar finalização' }));
    expect(screen.getByRole('heading', { name: 'Seu resultado' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'histórico detalhado de revisão não pôde ser salvo',
    );
    const raw = localStorage.getItem(storageKey(tiny));
    await user().click(screen.getByRole('button', { name: 'Nova tentativa' }));
    expect(screen.getByRole('alert')).toHaveTextContent('nova tentativa não foi iniciada');
    expect(localStorage.getItem(storageKey(tiny))).toBe(raw);
  });
  it('restart returns chooser and preserves detailed snapshot before new choice', async () => {
    render(<ExamPage exam={tiny} />);
    await user().click(screen.getByRole('button', { name: 'Iniciar em Modo Prova' }));
    await user().click(screen.getByRole('button', { name: 'Finalizar tentativa' }));
    await user().click(screen.getByRole('button', { name: 'Confirmar finalização' }));
    const raw = localStorage.getItem(storageKey(tiny));
    await user().click(screen.getByRole('button', { name: 'Nova tentativa' }));
    expect(
      screen.getByRole('heading', { name: 'Como deseja fazer esta tentativa?' }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(storageKey(tiny))).toBe(raw);
    await user().click(screen.getByRole('button', { name: 'Iniciar em Modo Estudo' }));
    expect(JSON.parse(localStorage.getItem(storageKey(tiny))!).current.mode).toBe('study');
    expect(JSON.parse(localStorage.getItem(reviewStorageKey(tiny))!).attempts).toHaveLength(1);
  });
  it('restart preserves a foreign current changed after capture, during UUID creation', async () => {
    const current = transition(tiny, createAttempt(tiny, '2026-10-03T10:00:00.000Z', 'old'), {
      type: 'finish',
      now: '2026-10-03T11:00:00.000Z',
    });
    localStorage.setItem(storageKey(tiny), JSON.stringify({ storageVersion: 3, current }));
    render(<ExamPage exam={tiny} />);
    await user().click(screen.getByRole('button', { name: 'Nova tentativa' }));
    const archiveRaw = localStorage.getItem(reviewStorageKey(tiny));
    const foreign = createAttempt(tiny, '2026-10-04T10:00:00.000Z', 'foreign', 'study');
    const foreignRaw = JSON.stringify({ storageVersion: 3, current: foreign });
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      localStorage.setItem(storageKey(tiny), foreignRaw);
      return '00000000-0000-4000-8000-000000000001';
    });
    await user().click(screen.getByRole('button', { name: 'Iniciar em Modo Prova' }));
    expect(screen.getByRole('alert')).toHaveTextContent('concorrência');
    expect(localStorage.getItem(storageKey(tiny))).toBe(foreignRaw);
    expect(localStorage.getItem(reviewStorageKey(tiny))).toBe(archiveRaw);
    expect(
      screen.getByRole('heading', { name: 'Como deseja fazer esta tentativa?' }),
    ).toBeInTheDocument();
  });
  it('restart second-write failure restores the completed legacy current and missing history', async () => {
    const current = transition(tiny, createAttempt(tiny, '2026-10-03T10:00:00.000Z', 'old'), {
      type: 'finish',
      now: '2026-10-03T11:00:00.000Z',
    });
    const { mode: _mode, confirmedQuestionIds: _confirmed, ...legacy } = current;
    const raw = JSON.stringify({ storageVersion: 2, current: legacy });
    localStorage.setItem(storageKey(tiny), raw);
    render(<ExamPage exam={tiny} preference="exam" />);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === historyStorageKey(tiny)) throw new Error('quota');
      original.call(this, key, value);
    });
    await user().click(screen.getByRole('button', { name: 'Nova tentativa' }));
    expect(screen.getByRole('heading', { name: 'Seu resultado' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('nova tentativa não foi iniciada');
    expect(localStorage.getItem(storageKey(tiny))).toBe(raw);
    expect(localStorage.getItem(historyStorageKey(tiny))).toBeNull();
    expect(JSON.parse(localStorage.getItem(reviewStorageKey(tiny))!).attempts).toEqual([current]);
  });
});
describe('dashboard mode note reflects both validated modes', () => {
  it.each(['empty', 'exam', 'study', 'history-study', 'exam-with-study-history'] as const)(
    'conditional note for %s; rendering stays read-only',
    (kind) => {
      if (kind === 'exam' || kind === 'study' || kind === 'exam-with-study-history') {
        const current = createAttempt(
          poc,
          '2026-10-04T10:00:00.000Z',
          'dashboard',
          kind === 'study' ? 'study' : 'exam',
        );
        localStorage.setItem(storageKey(poc), JSON.stringify({ storageVersion: 3, current }));
      }
      if (kind === 'history-study' || kind === 'exam-with-study-history') {
        const current = finished('study', 'historical');
        const { id, startedAt, completedAt, result, mode } = current;
        localStorage.setItem(
          historyStorageKey(poc),
          JSON.stringify({
            storageVersion: 3,
            history: [{ id, startedAt, completedAt, result, mode }],
          }),
        );
      }
      const before = Object.fromEntries(Object.entries(localStorage)),
        writes = vi.spyOn(Storage.prototype, 'setItem');
      render(<DashboardPage catalog={{ schemaVersion: 1, exams: [catalogExam] }} />);
      expect(
        Boolean(
          screen.queryByText('As métricas atuais incluem tentativas em Modo Prova e Modo Estudo.'),
        ),
      ).toBe(kind === 'exam-with-study-history');
      expect(writes).not.toHaveBeenCalled();
      expect(Object.fromEntries(Object.entries(localStorage))).toEqual(before);
    },
  );
});
const filterExam = {
  ...poc,
  questions: [
    { ...structuredClone(first), id: 'correct', category: 'A', tags: ['x', 'z'] },
    { ...structuredClone(first), id: 'wrong', category: 'A', tags: ['x'] },
    { ...structuredClone(first), id: 'blank', category: 'B', tags: ['y'] },
    { ...structuredClone(firstEssay), id: 'essay', category: 'B', tags: ['x', 'y'] },
  ],
};
const filterState = transition(
  filterExam,
  {
    ...createAttempt(filterExam, '2026-10-03T10:00:00.000Z', 'filter', 'exam'),
    answers: { correct: 'option-2', wrong: 'option-1', essay: 'resposta' },
    flagged: ['wrong', 'essay'],
  },
  { type: 'finish', now: '2026-10-03T11:00:00.000Z' },
);
describe('review filters and read-only navigation', () => {
  it.each([
    ['all', [0, 1, 2, 3]],
    ['correct', [0]],
    ['incorrect', [1]],
    ['unanswered', [2]],
    ['essay', [3]],
  ] as [ReviewStatus, number[]][])(
    '%s classifies objectively; blanks are separate from errors',
    (status, indices) => {
      expect(
        reviewQuestionIndices(filterExam, filterState, { ...defaultReviewFilters, status }),
      ).toEqual(indices);
    },
  );
  it('AND combines exact category, exact tags and flags; counts include independent flags', () => {
    expect(
      reviewQuestionIndices(filterExam, filterState, {
        status: 'all',
        flaggedOnly: true,
        category: 'A',
        tag: 'x',
      }),
    ).toEqual([1]);
    expect(
      reviewQuestionIndices(filterExam, filterState, { ...defaultReviewFilters, category: 'a' }),
    ).toEqual([]);
    expect(
      reviewQuestionIndices(filterExam, filterState, { ...defaultReviewFilters, tag: 'X' }),
    ).toEqual([]);
    expect(reviewCounts(filterExam, filterState)).toEqual({
      correct: 1,
      incorrect: 1,
      unanswered: 1,
      essay: 1,
      flagged: 2,
    });
  });
  it('opening, navigation and filters never write; unmark moves to next remaining or empty', async () => {
    function Fixture() {
      const [attempt, setAttempt] = React.useState(filterState);
      return (
        <ReviewView
          exam={filterExam}
          attempt={attempt}
          onFlag={(questionId) =>
            setAttempt(transition(filterExam, attempt, { type: 'flag', questionId }))
          }
        />
      );
    }
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    render(<Fixture />);
    await user().selectOptions(screen.getByLabelText('Marcação'), 'flagged');
    expect(screen.getByRole('heading', { name: 'Questão 2 de 4' })).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: '⚑ Desmarcar da revisão' }));
    expect(screen.getByRole('heading', { name: 'Questão 4 de 4' })).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: '⚑ Desmarcar da revisão' }));
    expect(screen.getByText('Nenhuma questão corresponde aos filtros.')).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await user().click(screen.getByRole('button', { name: 'Próxima →' }));
    expect(writes).not.toHaveBeenCalled();
  });
  it('post-completion flag failure reports honestly, keeping previous UI state', async () => {
    const current = finished();
    localStorage.setItem(storageKey(poc), JSON.stringify({ storageVersion: 3, current }));
    new ReviewRepository(() => localStorage).capture(poc, current);
    render(<ExamPage exam={poc} />);
    await user().click(screen.getByRole('button', { name: 'Revisar respostas' }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await user().click(screen.getByRole('button', { name: '⚑ Marcar para revisão' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível alterar a marcação de revisão.',
    );
    expect(screen.getByRole('button', { name: '⚑ Marcar para revisão' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
  it('hub uses index and local summaries, selected attempt alone fetches full Exam', async () => {
    const current = finished();
    localStorage.setItem(storageKey(poc), JSON.stringify({ storageVersion: 3, current }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(poc)));
    vi.stubGlobal('fetch', fetcher);
    const writes = vi.spyOn(Storage.prototype, 'setItem'),
      catalog = { schemaVersion: 1 as const, exams: [catalogExam] };
    const view = render(<ReviewPage catalog={catalog} />);
    expect(screen.getByRole('heading', { name: 'Revisão' })).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Revisar tentativa de/ })).toHaveAttribute(
      'href',
      reviewUrl(poc.id, current.id),
    );
    view.unmount();
    render(<ReviewPage catalog={catalog} examId={poc.id} attemptId={current.id} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Questão 1 de 30' })).toBeInTheDocument(),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe(`/CHATGPT/generated/exams/${poc.id}.json`);
    expect(writes).not.toHaveBeenCalled();
  });
  it('review routes are distinct from exam routes; main nav exposes Review', async () => {
    expect(resolveRoute('?view=review&reviewExam=' + poc.id + '&attempt=a')).toEqual({
      view: 'review',
      reviewExam: poc.id,
      attempt: 'a',
    });
    expect(resolveRoute('?view=review&exam=' + poc.id)).toEqual({ view: 'exam', id: poc.id });
    window.history.replaceState({}, '', '/CHATGPT/?view=review');
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ schemaVersion: 1, exams: [catalogExam] })),
        ),
    );
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Revisão' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revisão' })).toHaveAttribute('aria-current', 'page');
    expect(localStorage.getItem(historyStorageKey(poc))).toBeNull();
  });
  it('preference setting saves v2 with choice and help', async () => {
    window.history.replaceState({}, '', '/CHATGPT/?view=settings');
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ schemaVersion: 1, exams: [catalogExam] })),
        ),
    );
    render(<App />);
    const control = await screen.findByLabelText('Modo padrão para novas tentativas');
    expect(control).toHaveValue('ask');
    await user().selectOptions(control, 'study');
    expect(JSON.parse(localStorage.getItem(uiPreferencesKey)!)).toEqual({
      ...defaultUiPreferences,
      attemptModePreference: 'study',
      setupPrompt: 'completed',
    });
    expect(
      screen.getByText(
        'Esta preferência vale apenas para novas tentativas e não altera provas já iniciadas.',
      ),
    ).toBeInTheDocument();
  });
});
