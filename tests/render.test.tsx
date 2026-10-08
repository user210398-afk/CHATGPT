import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExamPage } from '../src/components/exam/ExamPage';
import { RichContent } from '../src/components/common/RichContent';
import { App } from '../src/app/App';
import { MultipleChoiceQuestion } from '../src/components/questions/MultipleChoiceQuestion';
import { poc, first, firstEssay } from './fixtures';
import { useExamSession } from '../src/app/useExamSession';
import {
  AttemptRepository,
  storageKey,
  historyStorageKey,
  summary,
  type StorageAdapter,
} from '../src/engine/persistence';
import { createAttempt, transition } from '../src/engine/exam-state';
import { ReviewRepository, reviewStorageKey } from '../src/engine/review-history';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});
it('renderiza e conclui a POC real, restaura dissertativa e exibe modelos somente na revisão', async () => {
  const user = userEvent.setup();
  const first = render(<ExamPage exam={poc} preference="exam" />);
  expect(screen.getByRole('heading', { name: 'Questão 1 de 30' })).toBeInTheDocument();
  const answerB = screen.getByRole('radio', { name: /b\) Substância química/ });
  await user.click(answerB);
  expect(answerB).toBeChecked();
  await user.click(screen.getByRole('radio', { name: /a\) Molécula/ }));
  expect(answerB).not.toBeChecked();
  await user.click(screen.getByRole('button', { name: '⚑ Marcar para revisão' }));
  await user.click(screen.getByRole('button', { name: 'Próxima →' }));
  await user.click(screen.getByRole('button', { name: '← Anterior' }));
  expect(screen.getByRole('radio', { name: /a\) Molécula/ })).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Ir para questão 21' }));
  await user.type(screen.getByRole('textbox', { name: 'Sua resposta' }), 'Resposta para revisar.');
  expect(screen.queryByText('Resposta-modelo')).not.toBeInTheDocument();
  first.unmount();
  render(<ExamPage exam={poc} preference="exam" />);
  expect(screen.getByRole('heading', { name: 'Questão 21 de 30' })).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('Resposta para revisar.');
  expect(screen.getByText(/Tentativa restaurada/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Finalizar tentativa' }));
  expect(screen.getByText(/28 questão\(ões\) sem resposta/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Confirmar finalização' }));
  expect(screen.getByRole('heading', { name: 'Seu resultado' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Seu resultado' })).toHaveFocus();
  expect(screen.getByText(/1 de 10 dissertativas respondidas/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Revisar respostas' }));
  expect(screen.getByRole('heading', { name: 'Resposta-modelo' })).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
  await user.click(
    screen.getByRole('button', { name: 'Ir para questão 1, respondida, marcada para revisão' }),
  );
  expect(screen.getByText('Resposta correta')).toBeInTheDocument();
  expect(screen.getAllByRole('radio')[0]).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Voltar ao resultado' }));
  expect(screen.getByRole('heading', { name: 'Seu resultado' })).toHaveFocus();
});
it('debounce da dissertativa evita escrita a cada tecla e permite restaurar após o prazo', async () => {
  const user = userEvent.setup();
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const view = render(<ExamPage exam={poc} preference="exam" />);
  await user.click(screen.getByRole('button', { name: 'Ir para questão 21' }));
  const writesBeforeTyping = setItem.mock.calls.length;
  const answer = screen.getByRole('textbox', { name: 'Sua resposta' });
  fireEvent.change(answer, { target: { value: 'a' } });
  fireEvent.change(answer, { target: { value: 'ab' } });
  fireEvent.change(answer, { target: { value: 'abc' } });
  expect(setItem).toHaveBeenCalledTimes(writesBeforeTyping);
  expect(screen.getByText('Salvando resposta…')).toBeInTheDocument();
  await waitFor(() => expect(setItem).toHaveBeenCalledTimes(writesBeforeTyping + 1));
  view.unmount();
  render(<ExamPage exam={poc} preference="exam" />);
  expect(screen.getByRole('textbox', { name: 'Sua resposta' })).toHaveValue('abc');
  const writesBeforeFinish = setItem.mock.calls.length;
  await user.click(screen.getByRole('button', { name: 'Finalizar tentativa' }));
  await user.click(screen.getByRole('button', { name: 'Confirmar finalização' }));
  expect(setItem.mock.calls.length).toBeGreaterThan(writesBeforeFinish);
  expect(screen.getByRole('heading', { name: 'Seu resultado' })).toBeInTheDocument();
  expect(
    JSON.parse(localStorage.getItem('chatgpt-exams:v1:fisiologia-m5-aula-1-2026:r1')!).current
      .completedAt,
  ).toBeTruthy();
  setItem.mockRestore();
});
it('erro de quota não interrompe a tentativa dissertativa', async () => {
  const user = userEvent.setup();
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  render(<ExamPage exam={poc} preference="exam" />);
  await user.click(screen.getByRole('button', { name: 'Ir para questão 21' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Sua resposta' }), {
    target: { value: 'resposta em memória' },
  });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('não conseguiu salvar'));
  expect(screen.getByRole('textbox', { name: 'Sua resposta' })).toHaveValue('resposta em memória');
  await user.click(screen.getByRole('button', { name: 'Finalizar tentativa' }));
  await user.click(screen.getByRole('button', { name: 'Confirmar finalização' }));
  expect(screen.queryByRole('heading', { name: 'Seu resultado' })).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('resposta em memória');
  expect(localStorage.getItem(storageKey(poc))).toBeNull();
  expect(localStorage.getItem(reviewStorageKey(poc))).toBeNull();
  setItem.mockRestore();
});
it('alternativa com parágrafo, lista e tabela mantém radio acessível e selecionável', async () => {
  const question = structuredClone(poc.questions[0]!);
  if (question.type !== 'multiple-choice') throw new Error('fixture objetiva');
  question.options[0]!.text = [
    { type: 'element', tag: 'p', children: [{ type: 'text', text: 'Parágrafo' }] },
    {
      type: 'element',
      tag: 'ul',
      children: [{ type: 'element', tag: 'li', children: [{ type: 'text', text: 'Lista' }] }],
    },
    {
      type: 'element',
      tag: 'table',
      children: [
        {
          type: 'element',
          tag: 'tbody',
          children: [
            {
              type: 'element',
              tag: 'tr',
              children: [
                { type: 'element', tag: 'td', children: [{ type: 'text', text: 'Dado' }] },
              ],
            },
          ],
        },
      ],
    },
  ];
  const onAnswer = vi.fn();
  render(
    <MultipleChoiceQuestion
      question={question}
      answer={undefined}
      readOnly={false}
      onAnswer={onAnswer}
    />,
  );
  const radio = screen.getByRole('radio', { name: /Parágrafo Lista Dado/ });
  expect(radio.closest('.option')?.querySelector('table')).toBeInTheDocument();
  expect(radio.closest('label')).toBeNull();
  await userEvent.setup().click(screen.getByText('Dado'));
  await vi.waitFor(() => expect(onAnswer).toHaveBeenCalledWith('option-1'));
  radio.focus();
  await userEvent.setup().keyboard('[Space]');
  await vi.waitFor(() => expect(onAnswer).toHaveBeenCalledWith('option-1'));
});
it('carrega o catálogo, filtra por texto sem acentos e salva tema', async () => {
  window.history.replaceState({}, '', '/CHATGPT/?view=all');
  const user = userEvent.setup();
  const catalog = {
    schemaVersion: 1,
    exams: [
      {
        id: poc.id,
        revision: 1,
        title: poc.title,
        subject: poc.subject,
        year: poc.year,
        division: poc.division,
        description: '',
        tags: poc.tags,
        questionCount: 30,
        objectiveCount: 20,
        essayCount: 10,
      },
    ],
  };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(catalog)));
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  const link = await screen.findByRole('link', { name: /Abrir prova/ });
  expect(link).toHaveAttribute('href', `/CHATGPT/?exam=${poc.id}`);
  await user.type(screen.getByRole('searchbox'), 'hipofise');
  expect(link).toBeInTheDocument();
  await user.clear(screen.getByRole('searchbox'));
  await user.type(screen.getByRole('searchbox'), 'inexistente');
  expect(screen.getByRole('status')).toHaveTextContent('Nenhuma prova encontrada');
  await user.click(screen.getByRole('button', { name: /Tema escuro/ }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('chatgpt-exams:v1:ui-preferences')).toContain('dark');
  expect(localStorage.getItem('chatgpt-exams:preferences:v1')).toBeNull();
});
it('realiza loader → estado → renderer sem HTML legado pela URL da aplicação', async () => {
  window.history.replaceState({}, '', `/CHATGPT/?exam=${poc.id}`);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(poc)));
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Iniciar em Modo Prova' }));
  expect(await screen.findByRole('heading', { name: 'Questão 1 de 30' })).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![0]).toBe(`/CHATGPT/generated/exams/${poc.id}.json`);
  expect(document.querySelector('iframe')).toBeNull();
});
it('renderiza texto com sintaxe HTML como texto, não como código', () => {
  render(<RichContent content={[{ type: 'text', text: '<img src=x onerror=alert(1)>' }]} />);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
});

function officialFixture(completed = false, partial = false) {
  let current = createAttempt(poc, '2026-10-03T10:00:00.000Z', 'lifecycle');
  current = { ...current, currentIndex: poc.questions.findIndex((q) => q.id === firstEssay.id) };
  if (completed)
    current = transition(poc, current, { type: 'finish', now: '2026-10-03T11:00:00.000Z' });
  const values = new Map<string, string>([
    [storageKey(poc), JSON.stringify({ storageVersion: 3, current })],
  ]);
  if (partial)
    values.set(
      historyStorageKey(poc),
      JSON.stringify({
        storageVersion: 3,
        history: [
          summary(transition(poc, current, { type: 'finish', now: '2026-10-03T11:00:00.000Z' })),
          { id: 'unknown' },
        ],
      }),
    );
  const store = {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, raw: string) => {
      values.set(key, raw);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  } satisfies StorageAdapter & { values: Map<string, string> };
  return { store, repo: new AttemptRepository(() => store) };
}

it.each(['timer', 'navigate', 'finish', 'pagehide', 'cleanup', 'pagehide-cleanup'] as const)(
  'RT-001 stale essay flush at %s preserves winner bytes and the in-memory draft',
  (event) => {
    vi.useFakeTimers();
    const { store, repo } = officialFixture();
    const A = renderHook(() => useExamSession(poc, 'ask', repo));
    const B = renderHook(() => useExamSession(poc, 'ask', repo));
    const oldToken = B.result.current.persistence;
    act(() => {
      B.result.current.dispatch({ type: 'answer', questionId: firstEssay.id, value: 'a' });
      B.result.current.dispatch({
        type: 'answer',
        questionId: firstEssay.id,
        value: 'final draft',
      });
    });
    expect(store.setItem).not.toHaveBeenCalled();
    act(() =>
      A.result.current.dispatch({ type: 'answer', questionId: first.id, value: 'option-1' }),
    );
    const winner = new Map(store.values),
      saves = vi.spyOn(repo, 'save');
    const capture = vi.spyOn(ReviewRepository.prototype, 'capture');
    if (event === 'timer') {
      act(() => vi.advanceTimersByTime(499));
      expect(saves).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
    }
    if (event === 'navigate') act(() => B.result.current.dispatch({ type: 'navigate', index: 1 }));
    if (event === 'finish')
      act(() => B.result.current.dispatch({ type: 'finish', now: '2026-10-04T11:00:00.000Z' }));
    if (event === 'pagehide' || event === 'pagehide-cleanup')
      act(() => window.dispatchEvent(new Event('pagehide')));
    if (event === 'cleanup' || event === 'pagehide-cleanup') B.unmount();
    expect(store.values).toEqual(winner);
    expect(saves).toHaveBeenCalledTimes(1);
    expect(saves.mock.results[0]!.value.status).toBe('conflict');
    expect(B.result.current.current?.answers[firstEssay.id]).toBe('final draft');
    expect(B.result.current.persistence).toBe(oldToken);
    expect(B.result.current.current?.completedAt).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    if (event !== 'cleanup' && event !== 'pagehide-cleanup') {
      expect(B.result.current.warning).toContain('concorrência');
      expect(B.result.current.saving).toBe(false);
      act(() =>
        B.result.current.dispatch({ type: 'answer', questionId: first.id, value: 'option-2' }),
      );
    }
    act(() => vi.advanceTimersByTime(1000));
    expect(saves).toHaveBeenCalledTimes(1);
    expect(store.values).toEqual(winner);
    A.unmount();
    B.unmount();
  },
);

it.each(['timer', 'navigate', 'finish', 'pagehide', 'cleanup', 'pagehide-cleanup'] as const)(
  'RT-P1 essay flush without conflict at %s writes once and uses the latest draft',
  (event) => {
    vi.useFakeTimers();
    const { store, repo } = officialFixture(),
      view = renderHook(() => useExamSession(poc, 'ask', repo));
    const oldToken = view.result.current.persistence,
      saves = vi.spyOn(repo, 'save');
    act(() => {
      view.result.current.dispatch({ type: 'answer', questionId: firstEssay.id, value: 'first' });
      view.result.current.dispatch({
        type: 'answer',
        questionId: firstEssay.id,
        value: 'last draft',
      });
    });
    expect(saves).not.toHaveBeenCalled();
    if (event === 'timer') act(() => vi.advanceTimersByTime(500));
    if (event === 'navigate')
      act(() => view.result.current.dispatch({ type: 'navigate', index: 1 }));
    if (event === 'finish')
      act(() => view.result.current.dispatch({ type: 'finish', now: '2026-10-04T11:00:00.000Z' }));
    if (event === 'pagehide' || event === 'pagehide-cleanup')
      act(() => window.dispatchEvent(new Event('pagehide')));
    if (event === 'cleanup' || event === 'pagehide-cleanup') view.unmount();
    expect(saves).toHaveBeenCalledTimes(1);
    expect(saves.mock.results[0]!.value.status).toBe('saved');
    expect(JSON.parse(store.values.get(storageKey(poc))!).current.answers[firstEssay.id]).toBe(
      'last draft',
    );
    if (event !== 'cleanup' && event !== 'pagehide-cleanup')
      expect(view.result.current.persistence).not.toBe(oldToken);
    if (event === 'finish')
      expect(
        JSON.parse(store.values.get(reviewStorageKey(poc))!).attempts[0].answers[firstEssay.id],
      ).toBe('last draft');
    act(() => vi.advanceTimersByTime(1000));
    expect(saves).toHaveBeenCalledTimes(1);
    view.unmount();
  },
);

it('RT-001 two consumers cannot capture a rejected completion after another finish', () => {
  const { store, repo } = officialFixture();
  const A = renderHook(() => useExamSession(poc, 'ask', repo)),
    B = renderHook(() => useExamSession(poc, 'ask', repo));
  const capture = vi.spyOn(ReviewRepository.prototype, 'capture');
  act(() => A.result.current.dispatch({ type: 'finish', now: '2026-10-04T10:00:00.000Z' }));
  const winner = new Map(store.values);
  expect(capture).toHaveBeenCalledTimes(1);
  act(() => B.result.current.dispatch({ type: 'finish', now: '2026-10-04T11:00:00.000Z' }));
  expect(B.result.current.current?.completedAt).toBeNull();
  expect(B.result.current.warning).toContain('concorrência');
  expect(capture).toHaveBeenCalledTimes(1);
  expect(store.values).toEqual(winner);
});

it('RT-002 partial history blocks restart before review capture or any write', () => {
  const { store, repo } = officialFixture(true, true),
    view = renderHook(() => useExamSession(poc, 'ask', repo));
  const before = new Map(store.values),
    capture = vi.spyOn(ReviewRepository.prototype, 'capture');
  act(() => {
    expect(view.result.current.restart()).toBe(false);
  });
  act(() => {
    expect(view.result.current.start('exam')).toBe(false);
  });
  expect(store.values).toEqual(before);
  expect(capture).not.toHaveBeenCalled();
  expect(store.setItem).not.toHaveBeenCalled();
  expect(view.result.current.current?.completedAt).not.toBeNull();
});

it('confirmed review flags advance only their own current bytes and allow guarded restart', () => {
  const { store, repo } = officialFixture(true),
    view = renderHook(() => useExamSession(poc, 'ask', repo));
  const oldToken = view.result.current.persistence;
  act(() => view.result.current.dispatch({ type: 'flag', questionId: first.id }));
  expect(view.result.current.current?.flagged).toEqual([first.id]);
  expect(view.result.current.persistence).not.toBe(oldToken);
  expect(view.result.current.persistence.current.raw).toBe(store.values.get(storageKey(poc)));
  act(() => {
    expect(view.result.current.start('exam')).toBe(true);
  });
  expect(view.result.current.current?.completedAt).toBeNull();
  expect(view.result.current.warning).toBeNull();
});

it('a quota-rejected finish keeps the draft and never captures review or publishes official completion', () => {
  const { store, repo } = officialFixture(),
    view = renderHook(() => useExamSession(poc, 'ask', repo));
  const token = view.result.current.persistence,
    before = new Map(store.values);
  const capture = vi.spyOn(ReviewRepository.prototype, 'capture');
  store.setItem.mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  act(() =>
    view.result.current.dispatch({ type: 'answer', questionId: first.id, value: 'option-1' }),
  );
  expect(view.result.current.current?.answers[first.id]).toBe('option-1');
  act(() => view.result.current.dispatch({ type: 'finish', now: '2026-10-04T10:00:00.000Z' }));
  expect(view.result.current.current?.completedAt).toBeNull();
  expect(view.result.current.persistence).toBe(token);
  expect(view.result.current.warning).toContain('não conseguiu salvar');
  expect(capture).not.toHaveBeenCalled();
  expect(store.values).toEqual(before);
});
