import { fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
export function point(root: HTMLElement, offset: number): [Text, number] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    if (offset <= text.length) return [text, offset];
    offset -= text.length;
  }
  throw new Error('fixture boundary');
}
export function pointer(
  root: HTMLElement,
  type: string,
  offset: number,
  init: Partial<PointerEventInit> = {},
) {
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 1000,
  } as DOMRect);
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true,
    value: () => {
      const [offsetNode, boundary] = point(root, offset);
      return { offsetNode, offset: boundary };
    },
  });
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: offset * 10 + 10,
    clientY: 10,
    buttons: 1,
    button: 0,
    ...init,
  });
  for (const [key, value] of Object.entries({
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    ...init,
  }))
    Object.defineProperty(event, key, { value, configurable: true });
  fireEvent(root, event);
}
export function drag(start: number, end: number, init: Partial<PointerEventInit> = {}) {
  const root = document.querySelector('.statement') as HTMLElement;
  pointer(root, 'pointerdown', start, init);
  pointer(root, 'pointermove', end, init);
  pointer(root, 'pointerup', end, { ...init, buttons: 0 });
}
