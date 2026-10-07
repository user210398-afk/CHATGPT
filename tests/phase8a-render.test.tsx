import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExamPage } from '../src/components/exam/ExamPage';
import { MultipleChoiceQuestion } from '../src/components/questions/MultipleChoiceQuestion';
import { AnnotatedStatement } from '../src/components/questions/AnnotatedStatement';
import { ReviewSessionPage } from '../src/app/ReviewSessionPage';
import { ReviewView } from '../src/components/review/ReviewView';
import { createAttempt } from '../src/engine/exam-state';
import { storageKey } from '../src/engine/persistence';
import { annotationStorageKey } from '../src/engine/question-annotations-storage';
import { emptyAnnotations, mutateAnnotations } from '../src/engine/question-annotations';
import { scratchStorageKey } from '../src/engine/solver-scratch';
import { reviewSessionStorageKey } from '../src/engine/review-session-storage';
import { exam, questionId, scope } from './phase8a-fixtures';
import { drag } from './gesture-fixtures';
import { source, session } from './phase7b2b-fixtures';
const q = exam.questions[0]!;
if (q.type !== 'multiple-choice') throw new Error('fixture');
const a = q.options[0]!.id;
function body(index = 0) {
  return document.querySelectorAll('.option-content > .rich-content')[index]!;
}
function current() {
  return JSON.parse(localStorage.getItem(storageKey(exam))!).current;
}
function seedAttempt() {
  localStorage.setItem(
    storageKey(exam),
    JSON.stringify({ storageVersion: 3, current: createAttempt(exam, undefined, scope.id) }),
  );
}
function select(start: number, end: number) {
  const root = document.querySelector('.statement')!;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
    texts: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) texts.push(node as Text);
  function point(offset: number): [Text, number] {
    for (const text of texts) {
      if (offset <= text.length) return [text, offset];
      offset -= text.length;
    }
    throw new Error('range fixture');
  }
  act(() => {
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.setBaseAndExtent(...point(start), ...point(end));
    document.dispatchEvent(new Event('selectionchange'));
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  sessionStorage.clear();
  window.getSelection()?.removeAllRanges();
  window.history.replaceState(null, '', '/');
});
describe('radio/button/body integration', () => {
  it.each(['summary', 'contenteditable', 'slider'])(
    'red team: future interactive %s never enters body arbiter',
    (kind) => {
      vi.useFakeTimers();
      const answer = vi.fn(),
        toggle = vi.fn();
      render(
        <MultipleChoiceQuestion
          question={q}
          answer={undefined}
          readOnly={false}
          onAnswer={answer}
          solver={{ eliminated: [], warning: null, setEliminated: toggle }}
        />,
      );
      const control = document.createElement(kind === 'summary' ? 'summary' : 'span');
      if (kind === 'contenteditable') control.setAttribute('contenteditable', '');
      if (kind === 'slider') control.setAttribute('role', 'slider');
      body().append(control);
      fireEvent.click(control, { detail: 1 });
      fireEvent.click(control, { detail: 2 });
      act(() => vi.runAllTimers());
      expect(answer).not.toHaveBeenCalled();
      expect(toggle).not.toHaveBeenCalled();
    },
  );
  it('body single delay; double eliminate, later double restore, triple zero answers', () => {
    vi.useFakeTimers();
    seedAttempt();
    render(<ExamPage exam={exam} />);
    const before = localStorage.getItem(storageKey(exam));
    fireEvent.click(body(), { detail: 1 });
    fireEvent.click(body(), { detail: 2 });
    fireEvent.click(body(), { detail: 3 });
    act(() => vi.runAllTimers());
    expect(localStorage.getItem(storageKey(exam))).toBe(before);
    expect(document.querySelector('.option.eliminated')).toBeTruthy();
    act(() => vi.advanceTimersByTime(601));
    fireEvent.click(body(), { detail: 1 });
    fireEvent.click(body(), { detail: 2 });
    act(() => vi.runAllTimers());
    expect(document.querySelector('.option.eliminated')).toBeNull();
    act(() => vi.advanceTimersByTime(601));
    fireEvent.click(body(), { detail: 1 });
    expect(current().answers).toEqual({});
    act(() => vi.advanceTimersByTime(600));
    expect(current().answers[questionId]).toBe(a);
  });
  it.each(['navigation', 'scope', 'readOnly', 'unmount'])(
    'pending timer cancelled on %s',
    (change) => {
      vi.useFakeTimers();
      const answer = vi.fn(),
        toggle = vi.fn();
      const props = {
        question: q,
        answer: undefined,
        readOnly: false,
        onAnswer: answer,
        solver: { eliminated: [], warning: null, setEliminated: toggle },
        scopeIdentity: 'old',
      };
      const view = render(<MultipleChoiceQuestion {...props} />);
      fireEvent.click(body(), { detail: 1 });
      if (change === 'unmount') view.unmount();
      else
        view.rerender(
          <MultipleChoiceQuestion
            {...props}
            {...(change === 'navigation'
              ? { question: { ...q, id: 'new-question' } }
              : change === 'scope'
                ? { scopeIdentity: 'new' }
                : { readOnly: true })}
          />,
        );
      act(() => vi.runAllTimers());
      expect(answer).not.toHaveBeenCalled();
      expect(toggle).not.toHaveBeenCalled();
    },
  );
  it('radio single/double normal; selected elimination rejected without changing answer', () => {
    seedAttempt();
    render(<ExamPage exam={exam} />);
    const radio = screen.getAllByRole('radio')[0]!;
    fireEvent.click(radio);
    fireEvent.click(radio, { detail: 2 });
    fireEvent.doubleClick(radio);
    expect(current().answers[questionId]).toBe(a);
    expect(sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar alternativa 1' }));
    expect(screen.getByRole('status')).toHaveTextContent('Selecione outra');
    expect(document.querySelector('.option.eliminated')).toBeNull();
  });
  it('explicit button keyboard Space/Enter; double button never answers through bubbling', async () => {
    seedAttempt();
    render(<ExamPage exam={exam} />);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Eliminar alternativa 1' });
    button.focus();
    await user.keyboard('[Space]');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('[Enter]');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.dblClick(button);
    expect(current().answers).toEqual({});
  });
  it.each(['corrupt', 'quota'])(
    'answer wins scratch %s failure, UI never selected+eliminated',
    (kind) => {
      seedAttempt();
      render(<ExamPage exam={exam} />);
      fireEvent.click(screen.getByRole('button', { name: 'Eliminar alternativa 1' }));
      const raw = sessionStorage.getItem(scratchStorageKey(exam, scope));
      if (kind === 'corrupt') sessionStorage.setItem(scratchStorageKey(exam, scope), '{bad');
      else {
        const original = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
          this: Storage,
          key,
          raw,
        ) {
          if (this === sessionStorage) throw new Error('quota');
          original.call(this, key, raw);
        });
      }
      fireEvent.click(screen.getAllByRole('radio')[0]!);
      expect(current().answers[questionId]).toBe(a);
      expect(document.querySelector('.option.selected.eliminated')).toBeNull();
      expect(screen.getByRole('status')).toBeTruthy();
      expect(sessionStorage.getItem(scratchStorageKey(exam, scope))).toBe(
        kind === 'corrupt' ? '{bad' : raw,
      );
    },
  );
  it('Study confirmation and Exam finish replace scratch with academic feedback', () => {
    render(<ExamPage exam={exam} preference="study" />);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar alternativa 1' }));
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    const radios = screen.getAllByRole('radio');
    expect(document.querySelector('.feedback')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar resposta' }));
    for (const radio of radios) expect(radio).toBeDisabled();
    expect(document.querySelector('.feedback')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Eliminar alternativa/ })).toBeNull();
    expect(document.querySelector('.option.eliminated')).toBeNull();
  });
});
describe('annotations UI zero-write and synchronization', () => {
  it('reads zero-write; colors, recolor, eraser, logical remove and clear', () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    render(<AnnotatedStatement exam={exam} questionId={questionId} />);
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Grifar' }));
    fireEvent.click(screen.getByRole('button', { name: /^Cor:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Amarelo' }));
    drag(2, 12);
    expect(document.querySelectorAll('mark.annotation-yellow')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /^Cor:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Verde' }));
    drag(4, 10);
    expect(document.querySelector('mark.annotation-green')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Cor:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Azul' }));
    drag(5, 8);
    expect(document.querySelector('mark.annotation-blue')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Borracha' }));
    drag(6, 7);
    const envelope = JSON.parse(localStorage.getItem(annotationStorageKey(exam))!);
    expect(
      envelope.questions[questionId].some(
        (h: { start: number; end: number }) => h.start <= 6 && h.end > 6,
      ),
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Borracha' }));
    window.getSelection()?.removeAllRanges();
    fireEvent.click(document.querySelector('mark')!);
    fireEvent.click(screen.getByRole('button', { name: /^Remover destaque$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de grifo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Limpar marcações desta questão' }));
    expect(screen.getByRole('button', { name: 'Mais ações de grifo' })).toHaveFocus();
    expect(document.querySelector('mark')).toBeNull();
    expect(writes.mock.calls.every(([key]) => key === annotationStorageKey(exam))).toBe(true);
  });
  it('toolbar exists without Selection; keyboard/Escape disables tool and preserves native selection', async () => {
    render(<AnnotatedStatement exam={exam} questionId={questionId} />);
    select(0, 4);
    const trigger = screen.getByRole('button', { name: 'Grifar' });
    await userEvent.setup().click(trigger);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().keyboard('[Escape]');
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('group', { name: 'Ferramentas de grifo e borracha' })).toBeTruthy();
    expect(trigger).toHaveAttribute('aria-pressed', 'false');
  });
  it('storage event valid is read-only; corrupt retains last good and blocks; wrong key/area/stale ignored', () => {
    render(<AnnotatedStatement exam={exam} questionId={questionId} />);
    const key = annotationStorageKey(exam),
      value = mutateAnnotations(exam, emptyAnnotations(exam), questionId, {
        type: 'paint',
        start: 0,
        end: 3,
        color: 'blue',
      });
    const raw = JSON.stringify(value);
    localStorage.setItem(key, raw);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue: raw, storageArea: localStorage }),
      ),
    );
    expect(document.querySelector('mark.annotation-blue')).toBeTruthy();
    expect(writes).not.toHaveBeenCalled();
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue: null, storageArea: localStorage }),
      ),
    );
    expect(document.querySelector('mark')).toBeTruthy();
    localStorage.setItem(key, '{bad');
    writes.mockClear();
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: `${key}-other`,
          newValue: '{bad',
          storageArea: localStorage,
        }),
      ),
    );
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue: '{bad', storageArea: sessionStorage }),
      ),
    );
    expect(screen.queryByRole('status')).toBeNull();
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue: '{bad', storageArea: localStorage }),
      ),
    );
    expect(document.querySelector('mark')).toBeTruthy();
    expect(screen.getByRole('status')).toHaveTextContent('bloqueada');
    expect(writes).not.toHaveBeenCalled();
    select(3, 5);
    expect(screen.getByRole('button', { name: /^Cor:/ })).toBeDisabled();
    expect(localStorage.getItem(key)).toBe('{bad');
    localStorage.setItem(key, raw);
    writes.mockClear();
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue: raw, storageArea: localStorage }),
      ),
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(writes).not.toHaveBeenCalled();
  });
  it('same revision historical editing does not modify academic snapshot; ReviewSession validates full exam', () => {
    let value = mutateAnnotations(exam, emptyAnnotations(exam), exam.questions[1]!.id, {
      type: 'paint',
      start: 0,
      end: 3,
      color: 'blue',
    });
    value = mutateAnnotations(exam, value, questionId, {
      type: 'paint',
      start: 0,
      end: 3,
      color: 'yellow',
    });
    localStorage.setItem(annotationStorageKey(exam), JSON.stringify(value));
    const attempt = source(),
      original = JSON.stringify(attempt);
    const view = render(<ReviewView exam={exam} attempt={attempt} onFlag={() => {}} />);
    expect(document.querySelector('mark')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Eliminar alternativa/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de grifo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Limpar marcações desta questão' }));
    expect(JSON.stringify(attempt)).toBe(original);
    view.unmount();
    localStorage.setItem(storageKey(exam), JSON.stringify({ storageVersion: 3, current: attempt }));
    localStorage.setItem(
      reviewSessionStorageKey(exam),
      JSON.stringify({ storageVersion: 1, session: session('exam', { kind: 'incorrect' }) }),
    );
    render(<ReviewSessionPage exam={exam} />);
    expect(screen.queryByText(/edição bloqueada/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Eliminar alternativa 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar alternativa 1' }));
    expect(
      JSON.parse(
        sessionStorage.getItem(scratchStorageKey(exam, { kind: 'review-session', id: 'session' }))!,
      ).scopeId,
    ).toBe('session');
    expect(
      JSON.parse(localStorage.getItem(annotationStorageKey(exam))!).questions[
        exam.questions[1]!.id
      ],
    ).toBeTruthy();
  });
});
