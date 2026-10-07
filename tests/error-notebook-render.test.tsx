import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorNotebookPage from '../src/app/ErrorNotebookPage';
import { App } from '../src/app/App';
import { DashboardPage } from '../src/app/DashboardPage';
import { errorNotebookUrl, resolveRoute, withReviewResume } from '../src/utils/paths';
import { storageKey, historyStorageKey, summary } from '../src/engine/persistence';
import { reviewStorageKey } from '../src/engine/review-history';
import { calculateResult } from '../src/engine/exam-state';
import {
  notebookExam as exam,
  notebookCatalog as catalog,
  notebookAttempt as attempt,
} from './error-notebook-fixtures';
import { storageFixtureJson } from './legacy-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});
function mockFetch(value = exam) {
  const fetcher = vi.fn(async (url: string | URL | Request) => ({
    ok: true,
    json: async () => (String(url).includes('exam-index') ? catalog : value),
  }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function seed(attempts = [attempt('incorrect')]) {
  localStorage.setItem(reviewStorageKey(exam), JSON.stringify({ storageVersion: 1, attempts }));
}
function spy() {
  const before = Object.fromEntries(Object.entries(localStorage));
  const writes = vi.spyOn(Storage.prototype, 'setItem'),
    removes = vi.spyOn(Storage.prototype, 'removeItem');
  return () => {
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
    expect(Object.fromEntries(Object.entries(localStorage))).toEqual(before);
  };
}
describe('read-only notebook page', () => {
  it('zero-history is useful, with zero Exam fetches or storage writes', async () => {
    const fetcher = mockFetch(),
      check = spy();
    render(<ErrorNotebookPage catalog={catalog} />);
    await screen.findByText('Nenhuma tentativa detalhada disponível ainda.');
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Caderno de Erros' })).toBeVisible();
    check();
  });
  it('distinguishes zero errors from zero history and filter empty', async () => {
    seed([attempt('correct')]);
    mockFetch();
    const check = spy();
    render(<ErrorNotebookPage catalog={catalog} />);
    await screen.findByText(
      'Nenhum erro objetivo foi encontrado nas tentativas detalhadas disponíveis.',
    );
    expect(screen.queryByText('Nenhuma tentativa detalhada disponível ainda.')).toBeNull();
    check();
  });
  it('cards show real statement/counts/time/tags; feedback and options stay outside DOM', async () => {
    seed([attempt('incorrect'), attempt('incorrect', 'two', 2), attempt('correct', 'three', 3)]);
    const special = {
      ...exam,
      questions: exam.questions.map((q) => ({
        ...q,
        explanation: [{ type: 'text' as const, text: 'secret-feedback' }],
      })),
    };
    const fetcher = mockFetch(special),
      check = spy();
    render(<ErrorNotebookPage catalog={catalog} />);
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    expect(screen.getByRole('article')).toHaveTextContent('2 erros em 3 respostas');
    expect(screen.getByRole('article')).toHaveTextContent('Último resultado respondido: Correto');
    expect(screen.getByRole('article')).toHaveTextContent('Tentativa concluída em');
    expect(screen.getByRole('article')).toHaveTextContent('Recorrente');
    expect(screen.getByRole('article')).toHaveTextContent('Superada');
    expect(document.body).not.toHaveTextContent('secret-feedback');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const user = userEvent.setup();
    await user.click(screen.getByText('Ver tentativas disponíveis (3)'));
    expect(screen.getAllByText(/Modo Prova/)).toHaveLength(3);
    await user.click(screen.getByText('Ver tentativas disponíveis (3)'));
    check();
  });
  it.each(['older-tie', 'latest-divergent-tie', 'latest-equal-tie'] as const)(
    'pre-staging P3: %s uses the appropriate last-result label and temporal explanation',
    async (kind) => {
      seed(
        kind === 'older-tie'
          ? [attempt('incorrect', 'a'), attempt('correct', 'Z'), attempt('correct', 'latest', 5)]
          : kind === 'latest-divergent-tie'
            ? [attempt('incorrect', 'a', 5), attempt('correct', 'Z', 5)]
            : [attempt('incorrect', 'a', 5), attempt('incorrect', 'Z', 5)],
      );
      mockFetch();
      const check = spy();
      render(<ErrorNotebookPage catalog={catalog} />);
      const card = await screen.findByRole('article');
      if (kind === 'latest-divergent-tie') {
        expect(card).toHaveTextContent('Resultado no desempate por ID: Incorreto');
        expect(card).toHaveTextContent('não comprovam uma sequência temporal entre essas tentativas');
        expect(card).not.toHaveTextContent('Último resultado respondido');
      } else {
        expect(card).toHaveTextContent(
          `Último resultado respondido: ${kind === 'older-tie' ? 'Correto' : 'Incorreto'}`,
        );
        expect(card).not.toHaveTextContent('Resultado no desempate por ID');
        expect(card).not.toHaveTextContent('não comprovam uma sequência temporal');
      }
      check();
    },
  );
  it('category filters work with keyboard and no fetch/write; filter empty is distinct', async () => {
    seed();
    const fetcher = mockFetch(),
      check = spy(),
      user = userEvent.setup();
    render(<ErrorNotebookPage catalog={catalog} />);
    await screen.findByRole('article');
    const button = screen.getByRole('button', { name: 'Superadas' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Nenhuma questão corresponde aos filtros atuais.')).toBeVisible();
    for (const name of ['Todas', 'Pendentes', 'Nunca acertei']) {
      await user.click(screen.getByRole('button', { name }));
      expect(screen.getAllByRole('article')).toHaveLength(1);
    }
    await user.click(screen.getByRole('button', { name: 'Recorrentes' }));
    expect(screen.queryByRole('article')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    check();
  });
  it('filters real Exam.subject and exam; changes reset dependent filter', async () => {
    const other = { ...exam, id: 'other-exam', title: 'Outra prova', subject: 'Outra matéria' };
    seed();
    localStorage.setItem(
      storageKey(other),
      JSON.stringify({
        storageVersion: 3,
        current: attempt('incorrect', 'same', 1, 'exam', other),
      }),
    );
    const input = {
      ...catalog,
      exams: [
        ...catalog.exams,
        { ...catalog.exams[0]!, id: other.id, title: other.title, subject: other.subject },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (url.includes(other.id) ? other : exam),
      })),
    );
    const check = spy(),
      user = userEvent.setup();
    render(<ErrorNotebookPage catalog={input} />);
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
    await user.selectOptions(screen.getByLabelText('Prova'), other.id);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article')).toHaveTextContent(other.title);
    await user.selectOptions(screen.getByLabelText('Matéria'), exam.subject);
    expect(screen.getByLabelText('Prova')).toHaveValue('');
    expect(screen.getByRole('article')).toHaveTextContent(exam.title);
    check();
  });
  it('v1 embedded only renders without offering an inaccessible Attempt link', async () => {
    localStorage.setItem(
      storageKey(exam),
      storageFixtureJson({
        storageVersion: 1,
        current: attempt('correct', 'current', 2),
        history: [attempt('incorrect', 'embedded')],
      }),
    );
    mockFetch();
    const check = spy();
    render(<ErrorNotebookPage catalog={catalog} />);
    await screen.findByRole('article');
    expect(screen.queryByRole('link', { name: /Revisar tentativa/ })).toBeNull();
    expect(document.querySelector('a[href*="attempt=embedded"]')).toBeNull();
    check();
  });
  it.each(['corrupt', 'summary-only', 'conflict', 'historical'] as const)(
    'coverage %s never silently becomes zero errors',
    async (kind) => {
      if (kind === 'corrupt') localStorage.setItem(storageKey(exam), '{invalid');
      if (kind === 'summary-only')
        localStorage.setItem(
          historyStorageKey(exam),
          JSON.stringify({ storageVersion: 3, history: [summary(attempt('incorrect'))] }),
        );
      if (kind === 'conflict') {
        seed();
        localStorage.setItem(
          storageKey(exam),
          JSON.stringify({ storageVersion: 3, current: attempt('correct') }),
        );
      }
      if (kind === 'historical') {
        const old = { ...exam, revision: exam.revision + 1 };
        localStorage.setItem(
          storageKey(old),
          JSON.stringify({
            storageVersion: 3,
            current: attempt('incorrect', 'old', 1, 'exam', old),
          }),
        );
      }
      mockFetch();
      const check = spy();
      render(<ErrorNotebookPage catalog={catalog} />);
      await screen.findByRole('heading', { name: 'Cobertura do histórico' });
      expect(
        screen.getByText('Há registros que não podem ser analisados por questão.'),
      ).toBeVisible();
      expect(
        screen.queryByText(
          'Nenhum erro objetivo foi encontrado nas tentativas detalhadas disponíveis.',
        ),
      ).toBeNull();
      expect(
        screen.getByRole('heading', { name: 'Questões — análise indisponível' }),
      ).toBeVisible();
      check();
    },
  );
  it('storage blocked is an alert, including a storage event with inaccessible localStorage', async () => {
    mockFetch();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<ErrorNotebookPage catalog={catalog} />);
    await screen.findByRole('alert');
    expect(
      screen.getByText('A análise está indisponível. Não foi possível determinar os erros.'),
    ).toBeVisible();
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key: storageKey(exam), storageArea: sessionStorage }),
      ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('indisponível');
  });
  it('pageshow/storage/manual refresh read only, reflect reset; ignored keys do not reload', async () => {
    seed();
    const fetcher = mockFetch(),
      user = userEvent.setup();
    render(<ErrorNotebookPage catalog={catalog} />);
    await screen.findByRole('article');
    const check = spy();
    act(() =>
      window.dispatchEvent(new StorageEvent('storage', { key: `${storageKey(exam)}:annotations` })),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Atualizar análise' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    check();
    vi.restoreAllMocks();
    localStorage.removeItem(reviewStorageKey(exam));
    const afterReset = spy();
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key: reviewStorageKey(exam), storageArea: localStorage }),
      ),
    );
    await screen.findByText('Nenhuma tentativa detalhada disponível ainda.');
    expect(screen.queryByRole('article')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
    afterReset();
  });
  it('overlapping refreshes cannot publish old async result; unmount aborts', async () => {
    seed();
    const pending: { signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options) =>
          new Promise((resolve) => pending.push({ signal: options.signal, resolve })),
      ),
    );
    const check = spy(),
      view = render(<ErrorNotebookPage catalog={catalog} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0]!.signal.aborted).toBe(true);
    await act(async () => {
      pending[1]!.resolve({ ok: true, json: async () => exam });
    });
    await screen.findByRole('article');
    await act(async () => {
      pending[0]!.resolve({ ok: false, status: 404 });
    });
    expect(screen.getByRole('article')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
    await waitFor(() => expect(pending).toHaveLength(3));
    view.unmount();
    expect(pending[2]!.signal.aborted).toBe(true);
    check();
  });
  it('equal timestamps explicitly explain ID ordering rather than claim temporal recovery', async () => {
    seed([attempt('incorrect', 'A'), attempt('correct', 'Z')]);
    mockFetch();
    render(<ErrorNotebookPage catalog={catalog} />);
    await screen.findByRole('article');
    expect(screen.getByRole('article')).toHaveTextContent('Resultado no desempate por ID');
    expect(screen.getByRole('article')).toHaveTextContent('não comprovam uma sequência temporal');
  });
  it('fragmented RichText and hostile strings are rendered safely', async () => {
    seed();
    const malicious = {
      ...exam,
      questions: exam.questions.map((q) => ({
        ...q,
        statement: [
          {
            type: 'element' as const,
            tag: 'p' as const,
            children: [
              { type: 'text' as const, text: '<img src=x onerror=' },
              {
                type: 'element' as const,
                tag: 'strong' as const,
                children: [{ type: 'text' as const, text: 'alert(1)>' }],
              },
            ],
          },
        ],
      })),
    };
    mockFetch(malicious);
    render(<ErrorNotebookPage catalog={catalog} />);
    await screen.findByRole('article');
    expect(screen.getByRole('article')).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(document.querySelector('article img')).toBeNull();
    expect(document.querySelector('article script')).toBeNull();
  });
  it('200+ UI items paginate in memory; repeated filtering does not fetch or write', async () => {
    const many = {
      ...exam,
      questions: Array.from({ length: 205 }, (_, i) => ({
        ...exam.questions[0]!,
        id: `ui-q-${i}`,
        label: `Questão ${i + 1}`,
      })),
    };
    const value = attempt('incorrect', 'many', 1, 'exam', many);
    value.answers = Object.fromEntries(
      many.questions.map((q) => [q.id, Object.values(value.answers)[0]!]),
    );
    value.result = calculateResult(many, value);
    localStorage.setItem(storageKey(many), JSON.stringify({ storageVersion: 3, current: value }));
    const fetcher = mockFetch(many),
      check = spy(),
      user = userEvent.setup();
    render(
      <ErrorNotebookPage
        catalog={{
          ...catalog,
          exams: [{ ...catalog.exams[0]!, questionCount: 205, objectiveCount: 205, essayCount: 0 }],
        }}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(50));
    await user.click(screen.getByRole('button', { name: 'Mostrar mais questões (50)' }));
    expect(screen.getAllByRole('article')).toHaveLength(100);
    await user.click(screen.getByRole('button', { name: 'Superadas' }));
    await user.click(screen.getByRole('button', { name: 'Todas' }));
    expect(screen.getAllByRole('article')).toHaveLength(50);
    expect(fetcher).toHaveBeenCalledTimes(1);
    check();
  });
});
describe('strict Pages route and summary-only Dashboard', () => {
  it('route resolves exact view and keeps existing exam precedence', () => {
    expect(resolveRoute('?view=error-notebook')).toEqual({ view: 'error-notebook' });
    expect(resolveRoute('?view=error-notebook-extra').view).toBe('catalog');
    expect(resolveRoute(`?view=error-notebook&exam=${exam.id}`)).toEqual({
      view: 'exam',
      id: exam.id,
    });
    expect(errorNotebookUrl()).toBe('/CHATGPT/?view=error-notebook');
  });
  it('URL helper preserves validated reviewResume; never writes storage', () => {
    const positions = [
      { examId: exam.id, examRevision: exam.revision, id: 'session', currentIndex: 1 },
    ];
    window.history.replaceState(
      {},
      '',
      `/?reviewResume=${encodeURIComponent(JSON.stringify(positions))}`,
    );
    const check = spy();
    expect(new URL(errorNotebookUrl(), window.location.href).searchParams.get('reviewResume')).toBe(
      JSON.stringify(positions),
    );
    expect(withReviewResume(errorNotebookUrl())).toBe(errorNotebookUrl());
    check();
  });
  it('direct App route exposes Erros with aria-current and lazy page', async () => {
    window.history.replaceState({}, '', '/?view=error-notebook');
    mockFetch();
    const check = spy();
    render(<App />);
    await screen.findByRole('heading', { name: 'Caderno de Erros' });
    await screen.findByText('Nenhuma tentativa detalhada disponível ainda.');
    expect(screen.getByRole('link', { name: 'Erros' })).toHaveAttribute('aria-current', 'page');
    expect(
      screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page'),
    ).toHaveLength(1);
    check();
  });
  it('Dashboard still fetches no complete Exams and has no notebook counters', () => {
    seed();
    const fetcher = mockFetch(),
      check = spy();
    render(<DashboardPage catalog={catalog} />);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByText('Com histórico de erro')).toBeNull();
    check();
  });
});
