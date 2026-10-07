import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewView } from '../src/components/review/ReviewView';
import { source } from './phase7b2b-fixtures';
import { AnnotatedStatement } from '../src/components/questions/AnnotatedStatement';
import { annotationStorageKey } from '../src/engine/question-annotations-storage';
import { emptyAnnotations, mutateAnnotations } from '../src/engine/question-annotations';
import { exam, questionId } from './phase8a-fixtures';
import { drag, pointer } from './gesture-fixtures';
const key = annotationStorageKey(exam);
const tool = (name = 'Grifar') => screen.getByRole('button', { name });
const colorTrigger = () => screen.getByRole('button', { name: /^Cor:/ });
function selectColor(name: string) {
  fireEvent.click(colorTrigger());
  fireEvent.click(tool(name));
}
function fixture() {
  const view = render(<AnnotatedStatement exam={exam} questionId={questionId} />);
  const root = document.querySelector('.statement') as HTMLElement;
  const capture = vi.fn(),
    release = vi.fn();
  root.setPointerCapture = capture;
  root.hasPointerCapture = () => true;
  root.releasePointerCapture = release;
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  return { ...view, root, capture, release, writes };
}
afterEach(() => {
  vi.restoreAllMocks();
  delete (document as any).caretPositionFromPoint;
});
describe('explicit gesture tools / lifecycle red team', () => {
  it('toolbar is available without Selection; modes exclusive; color activates Grifar; Escape and toggle off', () => {
    const f = fixture();
    expect(screen.getByRole('group', { name: 'Ferramentas de grifo e borracha' })).toBeVisible();
    expect(f.root).toHaveAttribute('data-annotation-tool', 'off');
    fireEvent.click(colorTrigger());
    expect(tool('Amarelo')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(colorTrigger());
    fireEvent.click(tool());
    expect(tool()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tool('Borracha'));
    expect(tool()).toHaveAttribute('aria-pressed', 'false');
    expect(tool('Borracha')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tool('Borracha'));
    expect(f.root).toHaveAttribute('data-annotation-tool', 'off');
    for (const name of ['Verde', 'Azul', 'Amarelo']) {
      selectColor(name);
      expect(colorTrigger()).toHaveAccessibleName(`Cor: ${name}`);
      expect(tool()).toHaveAttribute('aria-pressed', 'true');
    }
    fireEvent.click(tool());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(f.root).toHaveAttribute('data-annotation-tool', 'off');
    expect(f.writes).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
  it('keyboard operates modes, colors, removal and clear; no keyboard painting implied', async () => {
    localStorage.setItem(
      key,
      JSON.stringify(
        mutateAnnotations(exam, emptyAnnotations(exam), questionId, {
          type: 'paint',
          start: 2,
          end: 12,
          color: 'yellow',
        }),
      ),
    );
    const f = fixture(),
      user = userEvent.setup();
    tool().focus();
    await user.keyboard('[Space]');
    expect(tool()).toHaveAttribute('aria-pressed', 'true');
    colorTrigger().focus();
    await user.keyboard('[Enter]');
    tool('Azul').focus();
    await user.keyboard('[Enter]');
    expect(colorTrigger()).toHaveAccessibleName('Cor: Azul');
    expect(colorTrigger()).toHaveFocus();
    tool('Borracha').focus();
    await user.keyboard('[Space]');
    expect(tool()).toHaveAttribute('aria-pressed', 'false');
    expect(f.writes).not.toHaveBeenCalled();
    await user.keyboard('[Escape]');
    tool('Mais ações de grifo').focus();
    await user.keyboard('[Enter]');
    screen.getByRole('button', { name: 'Remover destaque 1' }).focus();
    await user.keyboard('[Enter]');
    expect(document.querySelector('mark')).toBeNull();
    expect(tool('Mais ações de grifo')).toHaveFocus();
    fireEvent.click(tool());
    drag(2, 12);
    fireEvent.click(tool('Mais ações de grifo'));
    screen.getByRole('button', { name: 'Limpar marcações desta questão' }).focus();
    await user.keyboard('[Enter]');
    expect(document.querySelector('mark')).toBeNull();
    expect(tool('Mais ações de grifo')).toHaveFocus();
  });
  it.each(['mouse', 'touch', 'pen'])(
    '%s unified down/move/up: preview only, then exactly one write, no Selection',
    (pointerType) => {
      const f = fixture();
      fireEvent.click(tool());
      pointer(f.root, 'pointerdown', 2, { pointerType });
      expect(f.capture).toHaveBeenCalledWith(1);
      expect(f.writes).not.toHaveBeenCalled();
      pointer(f.root, 'pointermove', 12, { pointerType });
      expect(document.querySelector('[data-annotation-preview="highlight"]')).toBeTruthy();
      expect(document.querySelector('mark[data-highlight-id]')).toBeNull();
      expect(f.writes).not.toHaveBeenCalled();
      pointer(f.root, 'pointermove', 10, { pointerType });
      expect(f.writes).not.toHaveBeenCalled();
      pointer(f.root, 'pointerup', 10, { pointerType, buttons: 0 });
      expect(f.writes).toHaveBeenCalledTimes(1);
      expect(f.release).toHaveBeenCalledWith(1);
      expect(JSON.parse(localStorage.getItem(key)!).questions[questionId]).toEqual([
        expect.objectContaining({ start: 2, end: 10, color: 'yellow' }),
      ]);
      expect(document.querySelector('[data-annotation-preview]')).toBeNull();
      expect(window.getSelection()?.isCollapsed).toBe(true);
    },
  );
  it.each([
    'pointercancel',
    'lostpointercapture',
    'unmount',
    'question',
    'scope',
    'switch',
    'Escape',
    'blocked',
  ])('%s cancels with zero ghost writes', (reason) => {
    const f = fixture();
    fireEvent.click(tool());
    pointer(f.root, 'pointerdown', 2);
    pointer(f.root, 'pointermove', 12);
    if (reason === 'unmount') f.unmount();
    else if (reason === 'question')
      f.rerender(<AnnotatedStatement exam={exam} questionId={exam.questions[1]!.id} />);
    else if (reason === 'scope')
      f.rerender(<AnnotatedStatement exam={exam} questionId={questionId} scopeIdentity="new" />);
    else if (reason === 'switch') fireEvent.click(tool('Borracha'));
    else if (reason === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else if (reason === 'blocked') {
      localStorage.setItem(key, '{bad');
      f.writes.mockClear();
      act(() =>
        window.dispatchEvent(
          new StorageEvent('storage', { key, newValue: '{bad', storageArea: localStorage }),
        ),
      );
      expect(tool()).toBeDisabled();
      expect(colorTrigger()).toBeDisabled();
    } else pointer(f.root, reason, 12);
    pointer(f.root, 'pointerup', 12, { buttons: 0 });
    expect(f.writes).not.toHaveBeenCalled();
    expect(document.querySelector('[data-annotation-preview]')).toBeNull();
    if (reason === 'question' || reason === 'scope')
      expect(document.querySelector('.statement')).toHaveAttribute('data-annotation-tool', 'off');
  });
  it.each([
    { button: 2, buttons: 2 },
    { button: 1, buttons: 4 },
    { isPrimary: false },
    { buttons: 0 },
  ])('invalid pointer %j ignored', (init) => {
    const f = fixture();
    fireEvent.click(tool());
    drag(2, 12, init);
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.writes).not.toHaveBeenCalled();
  });
  it('hover, off drag, tap and tiny caret jitter are zero-write', () => {
    const f = fixture();
    drag(2, 12);
    fireEvent.click(tool());
    pointer(f.root, 'pointermove', 12, { buttons: 0 });
    drag(3, 3);
    pointer(f.root, 'pointerdown', 3);
    pointer(f.root, 'pointermove', 4, { clientX: 41 });
    pointer(f.root, 'pointerup', 4, { buttons: 0 });
    expect(f.writes).not.toHaveBeenCalled();
  });
  it('second pointer never changes or finalizes first stroke', () => {
    const f = fixture();
    fireEvent.click(tool());
    pointer(f.root, 'pointerdown', 2);
    pointer(f.root, 'pointerdown', 20, { pointerId: 2 });
    pointer(f.root, 'pointermove', 24, { pointerId: 2 });
    pointer(f.root, 'pointerup', 24, { pointerId: 2 });
    pointer(f.root, 'pointercancel', 24, { pointerId: 2 });
    expect(f.writes).not.toHaveBeenCalled();
    pointer(f.root, 'pointermove', 12);
    pointer(f.root, 'pointerup', 12, { buttons: 0 });
    expect(f.writes).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(key)!).questions[questionId][0]).toMatchObject({
      start: 2,
      end: 12,
    });
  });
  it('outside move keeps preview; outside up cancels without inference', () => {
    const f = fixture();
    fireEvent.click(tool());
    pointer(f.root, 'pointerdown', 2);
    pointer(f.root, 'pointermove', 12);
    pointer(f.root, 'pointermove', 24, { clientX: 1100 });
    expect(document.querySelector('[data-annotation-preview]')).toBeTruthy();
    pointer(f.root, 'pointerup', 24, { clientX: 1100 });
    expect(f.writes).not.toHaveBeenCalled();
    expect(document.querySelector('[data-annotation-preview]')).toBeNull();
  });
  it('reverse across leaves/marks and existing 8A repaint/partial erase split, reload', () => {
    const old = mutateAnnotations(exam, emptyAnnotations(exam), questionId, {
      type: 'paint',
      start: 2,
      end: 12,
      color: 'yellow',
    });
    localStorage.setItem(key, JSON.stringify(old));
    const f = fixture();
    fireEvent.click(tool());
    selectColor('Verde');
    drag(10, 4);
    expect(
      JSON.parse(localStorage.getItem(key)!).questions[questionId].map(
        ({ start, end, color }: any) => ({ start, end, color }),
      ),
    ).toEqual([
      { start: 2, end: 4, color: 'yellow' },
      { start: 4, end: 10, color: 'green' },
      { start: 10, end: 12, color: 'yellow' },
    ]);
    fireEvent.click(tool('Borracha'));
    pointer(f.root, 'pointerdown', 5);
    pointer(f.root, 'pointermove', 8);
    expect(document.querySelector('[data-annotation-preview="eraser"]')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(key)!).questions[questionId]).toHaveLength(3);
    pointer(f.root, 'pointerup', 8, { buttons: 0 });
    expect(JSON.parse(localStorage.getItem(key)!).questions[questionId]).toHaveLength(4);
    const raw = localStorage.getItem(key);
    f.unmount();
    render(<AnnotatedStatement exam={exam} questionId={questionId} />);
    expect(localStorage.getItem(key)).toBe(raw);
    expect(document.querySelector('.statement')).toHaveAttribute('data-annotation-tool', 'off');
  });
  it.each(['corrupt', 'stale'])(
    '%s raw appearing immediately before up is preserved; no write',
    (kind) => {
      const f = fixture();
      fireEvent.click(tool());
      pointer(f.root, 'pointerdown', 2);
      pointer(f.root, 'pointermove', 12);
      const raw =
        kind === 'corrupt'
          ? '{bad'
          : JSON.stringify(
              mutateAnnotations(exam, emptyAnnotations(exam), questionId, {
                type: 'paint',
                start: 0,
                end: 3,
                color: 'blue',
              }),
            );
      localStorage.setItem(key, raw);
      f.writes.mockClear();
      pointer(f.root, 'pointerup', 12, { buttons: 0 });
      expect(localStorage.getItem(key)).toBe(raw);
      expect(f.writes).not.toHaveBeenCalled();
      expect(tool()).toBeDisabled();
    },
  );
  it('historical Review attempt switch with same question cancels the gesture and resets mode', () => {
    const attempt = source();
    const view = render(<ReviewView exam={exam} attempt={attempt} onFlag={() => {}} />);
    const root = document.querySelector('.statement') as HTMLElement;
    fireEvent.click(tool());
    pointer(root, 'pointerdown', 2);
    pointer(root, 'pointermove', 12);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    view.rerender(
      <ReviewView exam={exam} attempt={{ ...attempt, id: 'other-historical' }} onFlag={() => {}} />,
    );
    pointer(root, 'pointerup', 12);
    expect(writes).not.toHaveBeenCalled();
    expect(document.querySelector('.statement')).toHaveAttribute('data-annotation-tool', 'off');
    expect(document.querySelector('[data-annotation-preview]')).toBeNull();
  });
  it('color switch or released main button cancels an unfinished stroke', () => {
    const f = fixture();
    fireEvent.click(tool());
    pointer(f.root, 'pointerdown', 2);
    pointer(f.root, 'pointermove', 12);
    selectColor('Azul');
    pointer(f.root, 'pointerup', 12);
    expect(f.writes).not.toHaveBeenCalled();
    pointer(f.root, 'pointerdown', 2);
    pointer(f.root, 'pointermove', 12, { buttons: 0 });
    pointer(f.root, 'pointerup', 12);
    expect(f.writes).not.toHaveBeenCalled();
    expect(document.querySelector('[data-annotation-preview]')).toBeNull();
  });
  it('surrogate cut at anchor or final boundary never writes; combining marks retain exact offset', () => {
    const f = fixture();
    fireEvent.click(tool());
    drag(15, 24);
    drag(14, 15);
    expect(f.writes).not.toHaveBeenCalled();
    drag(17, 18);
    expect(JSON.parse(localStorage.getItem(key)!).questions[questionId][0]).toMatchObject({
      start: 17,
      end: 18,
    });
  });
  it('capture unavailable/throws remains safe; release failure does not duplicate a write', () => {
    const f = fixture();
    f.root.setPointerCapture = () => {
      throw new Error('capture unavailable');
    };
    f.root.releasePointerCapture = () => {
      throw new Error('already lost');
    };
    fireEvent.click(tool());
    drag(2, 12);
    pointer(f.root, 'pointerup', 12);
    expect(f.writes).toHaveBeenCalledTimes(1);
  });
});
