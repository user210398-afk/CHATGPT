import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewSessionPage } from '../src/app/ReviewSessionPage';
import { ReviewPage } from '../src/app/ReviewPage';
import { DashboardPage } from '../src/app/DashboardPage';
import { ReviewView } from '../src/components/review/ReviewView';
import {
  resolveRoute,
  reviewSessionUrl,
  reviewResumePosition,
  withReviewResume,
} from '../src/utils/paths';
import { reviewSessionStorageKey } from '../src/engine/review-session-storage';
import { reviewStorageKey } from '../src/engine/review-history';
import { storageKey, historyStorageKey, summary } from '../src/engine/persistence';
import { transitionReviewSession } from '../src/engine/review-session';
import { end, essay, objective, session, source, tiny, tinyCatalog } from './phase7b2b-fixtures';
import { defaultUiPreferences, uiPreferencesKey } from '../src/engine/ui-preferences';
import { catalogPreferencesKey } from '../src/engine/catalog-preferences';
function seed(mode: 'exam' | 'study' = 'exam') {
  localStorage.setItem(storageKey(tiny), JSON.stringify({ storageVersion: 3, current: source() }));
  localStorage.setItem(
    reviewSessionStorageKey(tiny),
    JSON.stringify({ storageVersion: 1, session: session(mode) }),
  );
}
const read = () => JSON.parse(localStorage.getItem(reviewSessionStorageKey(tiny))!).session;
const snap = () => Object.fromEntries(Object.entries(localStorage));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});
describe('isolated session UI', () => {
  it('red team: cancel finish and discard restore keyboard focus to their triggers', () => {
    seed();
    render(<ReviewSessionPage exam={tiny} />);
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar sessão' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar respondendo' }));
    expect(screen.getByRole('button', { name: 'Finalizar sessão' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar sessão de revisão' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar descarte' }));
    expect(screen.getByRole('button', { name: 'Descartar sessão de revisão' })).toHaveFocus();
  });
  it('red team: URL-only position follows resume links and cannot leak into a replacement session', () => {
    seed();
    render(<ReviewSessionPage exam={tiny} />);
    const before = snap();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima →' }));
    const search = window.location.search;
    expect(reviewResumePosition(session(), search)).toBe(1);
    expect(reviewResumePosition({ ...session(), id: 'replacement' }, search)).toBe(0);
    expect(reviewResumePosition({ ...session(), examRevision: 2 }, search)).toBe(0);
    const hub = withReviewResume('/CHATGPT/?view=review');
    window.history.replaceState(null, '', hub);
    expect(
      reviewResumePosition(
        session(),
        new URL(reviewSessionUrl(tiny.id), window.location.href).search,
      ),
    ).toBe(1);
    expect(snap()).toEqual(before);
  });
  it.each([
    '{bad',
    '[]',
    '{}',
    '[{"examId":"outside","examRevision":1,"id":"session","currentIndex":-1}]',
  ])('red team: invalid URL resume metadata is ignored without writes: %s', (raw) => {
    seed();
    const before = snap();
    window.history.replaceState(
      null,
      '',
      reviewSessionUrl(tiny.id) + '&reviewResume=' + encodeURIComponent(raw),
    );
    render(<ReviewSessionPage exam={tiny} />);
    expect(screen.getByRole('heading', { name: 'Questão 1 de 3 da sessão' })).toHaveFocus();
    expect(snap()).toEqual(before);
  });
  it('opening/restoring is zero-write and navigation uses URL without storage mutation', () => {
    seed();
    const before = snap(),
      writes = vi.spyOn(Storage.prototype, 'setItem');
    render(<ReviewSessionPage exam={tiny} />);
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima →' }));
    expect(screen.getByRole('heading', { name: 'Questão 2 de 3 da sessão' })).toBeInTheDocument();
    expect(snap()).toEqual(before);
    expect(window.location.search).toContain('reviewPosition=1');
  });
  it('Exam hides feedback until completed and keeps answer editable', () => {
    seed();
    render(<ReviewSessionPage exam={tiny} />);
    fireEvent.click(screen.getAllByRole('radio')[0]!);
    expect(document.querySelector('.feedback')).toBeNull();
    expect(screen.getAllByRole('radio')[0]).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar sessão' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar finalização da sessão' }));
    expect(
      screen.getByRole('heading', { name: 'Resultado desta sessão de revisão' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar respostas da sessão' }));
    expect(document.querySelector('.feedback')).not.toBeNull();
    expect(screen.getAllByRole('radio')[0]).toBeDisabled();
    expect(localStorage.getItem(historyStorageKey(tiny))).toBeNull();
  });
  it('Study confirms explicitly, shows feedback, locks response and remains at same question', () => {
    seed('study');
    render(<ReviewSessionPage exam={tiny} />);
    fireEvent.click(screen.getAllByRole('radio')[0]!);
    expect(document.querySelector('.feedback')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar resposta' }));
    expect(document.querySelector('.feedback')).not.toBeNull();
    expect(screen.getAllByRole('radio')[0]).toBeDisabled();
    expect(read().confirmedQuestionIds).toEqual([objective.id]);
    expect(screen.getByRole('heading', { name: 'Questão 1 de 3 da sessão' })).toBeInTheDocument();
  });
  it('Study pending confirmations block finish and provide direct navigation', () => {
    seed('study');
    render(<ReviewSessionPage exam={tiny} />);
    fireEvent.click(screen.getAllByRole('radio')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Próxima →' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar sessão' }));
    expect(screen.getByRole('button', { name: 'Confirmar finalização da sessão' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Finalizar sessão de revisão?' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Ir para primeira resposta pendente' }));
    expect(screen.getByRole('heading', { name: 'Questão 1 de 3 da sessão' })).toHaveFocus();
  });
  it.each(['timer', 'pagehide', 'unmount', 'finish'] as const)(
    'essay debounce flush at %s preserves text with no per-keystroke writes',
    (event) => {
      vi.useFakeTimers();
      seed();
      const writes = vi.spyOn(Storage.prototype, 'setItem'),
        view = render(<ReviewSessionPage exam={tiny} />);
      fireEvent.click(screen.getByRole('button', { name: /^Ir para questão 3/ }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'first draft' } });
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'final reasoning' } });
      expect(writes).not.toHaveBeenCalled();
      if (event === 'timer') {
        act(() => vi.advanceTimersByTime(499));
        expect(writes).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
      }
      if (event === 'pagehide') act(() => window.dispatchEvent(new Event('pagehide')));
      if (event === 'unmount') view.unmount();
      if (event === 'finish') {
        fireEvent.click(screen.getByRole('button', { name: 'Finalizar sessão' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar finalização da sessão' }));
      }
      expect(read().answers[essay.id]).toBe('final reasoning');
      expect(writes).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(1000));
      expect(writes).toHaveBeenCalledTimes(1);
    },
  );
  it('essay Study confirmation flushes immediately and compare locks textbox', () => {
    vi.useFakeTimers();
    seed('study');
    render(<ReviewSessionPage exam={tiny} />);
    fireEvent.click(
      screen.getByRole('button', { name: /^Ir para questão 3 da sessão, em branco/ }),
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'reasoning' } });
    expect(screen.queryByRole('heading', { name: 'Resposta-modelo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e comparar' }));
    expect(read().answers[essay.id]).toBe('reasoning');
    expect(read().confirmedQuestionIds).toContain(essay.id);
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
    expect(screen.getByRole('heading', { name: 'Resposta-modelo' })).toBeInTheDocument();
  });
  it('debounced storage failure surfaces alert and keeps in-memory text', () => {
    vi.useFakeTimers();
    seed();
    render(<ReviewSessionPage exam={tiny} />);
    fireEvent.click(screen.getByRole('button', { name: /^Ir para questão 3/ }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'keep draft' } });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível salvar');
    expect(screen.getByRole('textbox')).toHaveValue('keep draft');
    expect(read().answers).toEqual({});
  });
  it('failed completion never presents successful session result', () => {
    seed();
    render(<ReviewSessionPage exam={tiny} />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar sessão' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar finalização da sessão' }));
    expect(screen.queryByRole('heading', { name: 'Resultado desta sessão de revisão' })).toBeNull();
    expect(read().completedAt).toBeNull();
  });
  it('source missing does not prevent answering and never recreates official attempt', () => {
    seed();
    localStorage.removeItem(storageKey(tiny));
    render(<ReviewSessionPage exam={tiny} />);
    expect(screen.getByText(/tentativa fonte não está disponível/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('radio')[0]!);
    expect(read().answers[objective.id]).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '⚑ Marcar para revisão' }));
    expect(screen.getByRole('alert')).toHaveTextContent('marcação original');
    expect(localStorage.getItem(storageKey(tiny))).toBeNull();
  });
  it('flags synchronize source/current/archive while session raw stays unchanged', () => {
    seed();
    const before = localStorage.getItem(reviewSessionStorageKey(tiny));
    render(<ReviewSessionPage exam={tiny} />);
    fireEvent.click(screen.getByRole('button', { name: '⚑ Desmarcar da revisão' }));
    expect(screen.getByRole('button', { name: '⚑ Marcar para revisão' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(JSON.parse(localStorage.getItem(storageKey(tiny))!).current.flagged).not.toContain(
      objective.id,
    );
    expect(
      JSON.parse(localStorage.getItem(reviewStorageKey(tiny))!).attempts[0].flagged,
    ).not.toContain(objective.id);
    expect(localStorage.getItem(reviewSessionStorageKey(tiny))).toBe(before);
  });
  it('concurrent source flag change produces explicit error without simulating success', () => {
    seed();
    render(<ReviewSessionPage exam={tiny} />);
    localStorage.setItem(
      storageKey(tiny),
      JSON.stringify({ storageVersion: 3, current: { ...source(), flagged: [] } }),
    );
    fireEvent.click(screen.getByRole('button', { name: '⚑ Desmarcar da revisão' }));
    expect(screen.getByRole('alert')).toHaveTextContent('concorrência');
    expect(screen.getByRole('button', { name: '⚑ Desmarcar da revisão' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('restore position from URL and persisted confirmations survives remount', () => {
    seed('study');
    window.history.replaceState(null, '', reviewSessionUrl(tiny.id) + '&reviewPosition=2');
    render(<ReviewSessionPage exam={tiny} />);
    expect(screen.getByRole('heading', { name: 'Questão 3 de 3 da sessão' })).toHaveFocus();
  });
  it('corrupt session remains intact and explicit error is visible', () => {
    seed();
    localStorage.setItem(reviewSessionStorageKey(tiny), '{bad');
    const before = snap();
    render(<ReviewSessionPage exam={tiny} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(snap()).toEqual(before);
  });
  it('active session chooser is focused, read-only, modes require discard consent', () => {
    seed();
    const before = snap();
    render(<ReviewView exam={tiny} attempt={source()} onFlag={() => {}} allowSessions />);
    fireEvent.click(screen.getByRole('button', { name: 'Refazer erradas (1)' }));
    expect(
      screen.getByRole('heading', { name: 'Como deseja fazer esta sessão de revisão?' }),
    ).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Iniciar sessão em Modo Estudo' })).toBeDisabled();
    expect(snap()).toEqual(before);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Descartar sessão atual e iniciar nova' }),
    );
    expect(screen.getByRole('button', { name: 'Iniciar sessão em Modo Estudo' })).toBeEnabled();
    expect(snap()).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: /^Cancelar$/ }));
    expect(screen.getByRole('button', { name: 'Refazer erradas (1)' })).toHaveFocus();
  });
  it('Hub reports active sessions without loading full exams or writes', () => {
    seed();
    const before = snap();
    render(<ReviewPage catalog={tinyCatalog} />);
    expect(screen.getByRole('link', { name: 'Continuar sessão de revisão' })).toHaveAttribute(
      'href',
      reviewSessionUrl(tiny.id),
    );
    expect(snap()).toEqual(before);
  });
  it('completed session chooser clearly describes replacement', () => {
    seed();
    localStorage.setItem(
      reviewSessionStorageKey(tiny),
      JSON.stringify({
        storageVersion: 1,
        session: transitionReviewSession(tiny, session(), { type: 'finish', now: end }),
      }),
    );
    render(<ReviewView exam={tiny} attempt={source()} onFlag={() => {}} allowSessions />);
    fireEvent.click(screen.getByRole('button', { name: 'Refazer marcadas (2)' }));
    expect(screen.getByText(/sessão concluída anterior será substituída/)).toBeInTheDocument();
  });
  it('zero results never allow session creation', () => {
    render(
      <ReviewView
        exam={tiny}
        attempt={{ ...source(), flagged: [] }}
        onFlag={() => {}}
        allowSessions
      />,
    );
    expect(screen.getByRole('button', { name: 'Refazer marcadas (0)' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Respostas', { exact: true }), {
      target: { value: 'unanswered' },
    });
    expect(
      screen.getByRole('button', { name: 'Iniciar sessão com filtros atuais (0)' }),
    ).toBeDisabled();
  });
});
describe('Dashboard reset confirmation and immediate metrics update', () => {
  it('requires exact ZERAR, focuses confirmation, updates metrics and preserves favorites/preferences', () => {
    seed();
    localStorage.setItem(
      historyStorageKey(tiny),
      JSON.stringify({ storageVersion: 3, history: [summary(source())] }),
    );
    localStorage.setItem(
      catalogPreferencesKey,
      JSON.stringify({ storageVersion: 1, favorites: [tiny.id] }),
    );
    localStorage.setItem(uiPreferencesKey, JSON.stringify(defaultUiPreferences));
    const prefs = localStorage.getItem(uiPreferencesKey),
      favorite = localStorage.getItem(catalogPreferencesKey);
    const before = snap();
    render(<DashboardPage catalog={tinyCatalog} />);
    expect(snap()).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: 'Zerar histórico e estatísticas' }));
    expect(snap()).toEqual(before);
    expect(screen.getByRole('heading', { name: 'Confirmar remoção do histórico' })).toHaveFocus();
    const button = screen.getByRole('button', { name: 'Confirmar reset do histórico' });
    expect(button).toBeDisabled();
    for (const value of ['zerar', 'Zerar', ' ZERAR', 'ZERAR ']) {
      fireEvent.change(screen.getByLabelText('Digite ZERAR para confirmar'), { target: { value } });
      expect(button).toBeDisabled();
    }
    fireEvent.change(screen.getByLabelText('Digite ZERAR para confirmar'), {
      target: { value: 'ZERAR' },
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(screen.getByText(/Histórico zerado com sucesso/)).toBeInTheDocument();
    expect(localStorage.getItem(storageKey(tiny))).toBeNull();
    expect(localStorage.getItem(reviewSessionStorageKey(tiny))).toBeNull();
    expect(localStorage.getItem(uiPreferencesKey)).toBe(prefs);
    expect(localStorage.getItem(catalogPreferencesKey)).toBe(favorite);
    expect(screen.getByRole('button', { name: 'Zerar histórico e estatísticas' })).toHaveFocus();
    expect(document.querySelector('.metric dd')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma atividade salva neste navegador.')).toBeInTheDocument();
  });
  it('corrupt current blocks reset with alert and zero writes', () => {
    seed();
    localStorage.setItem(storageKey(tiny), '{bad');
    const before = snap();
    render(<DashboardPage catalog={tinyCatalog} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zerar histórico e estatísticas' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Reset abortado');
    expect(snap()).toEqual(before);
  });
});
describe('explicit routes do not collide', () => {
  it.each([
    ['?view=review-session&reviewExam=exam-id', { view: 'review-session', reviewExam: 'exam-id' }],
    ['?view=review-session', { view: 'review-session' }],
    ['?view=review-session&reviewExam=../bad', { view: 'review-session' }],
    ['?exam=official&view=review-session&reviewExam=review', { view: 'exam', id: 'official' }],
    ['?area=fisiologia&view=all', { view: 'catalog', area: 'fisiologia' }],
    [
      '?view=review-session&reviewExam=exam-id&area=fisiologia&extra=1',
      { view: 'review-session', reviewExam: 'exam-id' },
    ],
    [
      '?exam=../bad&view=review-session&reviewExam=exam-id',
      { view: 'review-session', reviewExam: 'exam-id' },
    ],
    [
      '?view=review&area=fisiologia&reviewExam=exam-id&attempt=source',
      { view: 'review', reviewExam: 'exam-id', attempt: 'source' },
    ],
    ['?view=dashboard&area=fisiologia', { view: 'dashboard' }],
    ['?view=settings&area=fisiologia', { view: 'settings' }],
    ['?view=all&area=fisiologia', { view: 'catalog', area: 'fisiologia' }],
    [
      '?view=review-session&view=dashboard&reviewExam=exam-id',
      { view: 'review-session', reviewExam: 'exam-id' },
    ],
    ['?view=review-session&reviewExam=&exam=../bad', { view: 'review-session' }],
  ])('route %s precedence', (search, expected) => expect(resolveRoute(search)).toEqual(expected));
  it('URL helper uses reviewExam and never official exam query', () =>
    expect(reviewSessionUrl(tiny.id)).toBe(`/CHATGPT/?view=review-session&reviewExam=${tiny.id}`));
});
