import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnotatedStatement } from '../src/components/questions/AnnotatedStatement';
import { annotationStorageKey } from '../src/engine/question-annotations-storage';
import { exam, questionId } from './phase8a-fixtures';
import { drag, pointer } from './gesture-fixtures';
const button = (name: string) => screen.getByRole('button', { name });
const trigger = () => screen.getByRole('button', { name: /^Cor:/ });
const root = () => document.querySelector('.statement') as HTMLElement;
const key = annotationStorageKey(exam);
function choose(name: string) {
  fireEvent.click(trigger());
  fireEvent.click(button(name));
}
afterEach(() => {
  vi.restoreAllMocks();
  delete (document as any).caretPositionFromPoint;
});
describe('compact annotation disclosures', () => {
  it('closed colors hidden; repeated open/close, selected check, outside and Escape are zero-write', () => {
    render(<AnnotatedStatement exam={exam} questionId={questionId} />);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    expect(screen.getByRole('group', { name: 'Ferramentas de grifo e borracha' })).toBeVisible();
    for (const name of ['Amarelo', 'Verde', 'Azul', 'Vermelho'])
      expect(screen.queryByRole('button', { name })).toBeNull();
    for (let i = 0; i < 5; i++) {
      fireEvent.click(trigger());
      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      expect(button('Amarelo')).toHaveAttribute('aria-pressed', 'true');
      expect(button('Amarelo')).toHaveTextContent('✓');
      fireEvent.click(trigger());
      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    }
    fireEvent.click(trigger());
    fireEvent.pointerDown(document.body);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger());
    button('Verde').focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger()).toHaveFocus();
    expect(root()).toHaveAttribute('data-annotation-tool', 'off');
    fireEvent.click(button('Mais ações de grifo'));
    expect(screen.getByRole('region', { name: 'Destaques desta questão' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button('Mais ações de grifo')).toHaveFocus();
    expect(screen.queryByRole('region')).toBeNull();
    expect(writes).not.toHaveBeenCalled();
  });
  it.each(['Amarelo', 'Verde', 'Azul', 'Vermelho'])(
    '%s keyboard selection closes, activates Grifar and identifies selection on reopen',
    async (name) => {
      render(<AnnotatedStatement exam={exam} questionId={questionId} />);
      const user = userEvent.setup();
      fireEvent.click(button('Borracha'));
      trigger().focus();
      await user.keyboard('[Enter]');
      button(name).focus();
      await user.keyboard('[Space]');
      expect(trigger()).toHaveAccessibleName(`Cor: ${name}`);
      expect(trigger()).toHaveFocus();
      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(button('Grifar')).toHaveAttribute('aria-pressed', 'true');
      expect(button('Borracha')).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(trigger());
      expect(button(name)).toHaveAttribute('aria-pressed', 'true');
      expect(button(name)).toHaveTextContent('✓');
      expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(2);
    },
  );
  it('red strokes keep tool active; erase split preview leaves persisted marks intact until up; toggles off', () => {
    render(<AnnotatedStatement exam={exam} questionId={questionId} />);
    choose('Vermelho');
    drag(0, 4);
    drag(6, 12);
    expect(button('Grifar')).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem(key)!).questions[questionId]).toHaveLength(2);
    fireEvent.click(button('Borracha'));
    const raw = localStorage.getItem(key);
    pointer(root(), 'pointerdown', 7);
    pointer(root(), 'pointermove', 10);
    expect(document.querySelector('[data-annotation-preview="eraser"]')).toBeTruthy();
    expect(document.querySelector('mark.annotation-red')).toBeTruthy();
    expect(localStorage.getItem(key)).toBe(raw);
    pointer(root(), 'pointerup', 10);
    expect(button('Borracha')).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem(key)!).questions[questionId]).toHaveLength(3);
    fireEvent.click(button('Borracha'));
    expect(root()).toHaveAttribute('data-annotation-tool', 'off');
  });
  it.each(['color', 'highlight-to-eraser', 'eraser-to-highlight', 'Escape'])(
    '%s during stroke cancels with zero ghost writes',
    (change) => {
      render(<AnnotatedStatement exam={exam} questionId={questionId} />);
      choose('Vermelho');
      if (change === 'eraser-to-highlight') fireEvent.click(button('Borracha'));
      pointer(root(), 'pointerdown', 2);
      pointer(root(), 'pointermove', 12);
      const writes = vi.spyOn(Storage.prototype, 'setItem');
      if (change === 'color') choose('Amarelo');
      else if (change === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
      else fireEvent.click(button(change === 'eraser-to-highlight' ? 'Grifar' : 'Borracha'));
      pointer(root(), 'pointerup', 12);
      expect(writes).not.toHaveBeenCalled();
      expect(document.querySelector('[data-annotation-preview]')).toBeNull();
    },
  );
  it('question navigation keeps UI color in React while resetting gesture and panels', () => {
    const view = render(<AnnotatedStatement exam={exam} questionId={questionId} />);
    choose('Vermelho');
    pointer(root(), 'pointerdown', 2);
    pointer(root(), 'pointermove', 12);
    view.rerender(<AnnotatedStatement exam={exam} questionId={exam.questions[1]!.id} />);
    expect(trigger()).toHaveAccessibleName('Cor: Vermelho');
    expect(root()).toHaveAttribute('data-annotation-tool', 'off');
    expect(document.querySelector('[data-annotation-preview]')).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('legacy storage events render in memory, never rewrite bytes or create IDs', () => {
    render(<AnnotatedStatement exam={exam} questionId={questionId} />);
    const raw = JSON.stringify(
      {
        storageVersion: 1,
        examId: exam.id,
        examRevision: exam.revision,
        questions: { [questionId]: [{ id: 'legacy', start: 0, end: 8, color: 'green' }] },
      },
      null,
      2,
    );
    localStorage.setItem(key, raw);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue: raw, storageArea: localStorage }),
      ),
    );
    expect(document.querySelector('mark.annotation-green')).toBeTruthy();
    expect(localStorage.getItem(key)).toBe(raw);
    expect(writes).not.toHaveBeenCalled();
  });
});
