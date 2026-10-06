import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatementContent } from '../src/components/questions/AnnotatedStatement';
import { projectStatement } from '../src/engine/statement-projection';
import {
  selectionToStatementRange,
  type StatementTextMap,
} from '../src/engine/statement-selection';
import {
  emptyAnnotations,
  mutateAnnotations,
  type Highlight,
} from '../src/engine/question-annotations';
import { exam, questionId, statement } from './phase8a-fixtures';
function fixture(highlights: Highlight[] = []) {
  const projection = projectStatement(statement),
    fragments: StatementTextMap = new Map();
  const { container, rerender } = render(
    <div>
      <StatementContent projection={projection} highlights={highlights} fragments={fragments} />
    </div>,
  );
  const root = container.firstElementChild as HTMLElement;
  return { root, projection, fragments, rerender };
}
function select(root: HTMLElement, start: number, end: number, reverse = false) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) texts.push(node as Text);
  function point(offset: number) {
    let previous = 0;
    for (const text of texts) {
      if (offset <= previous + text.length) return [text, offset - previous] as const;
      previous += text.length;
    }
    throw new Error('fixture range');
  }
  const a = point(start),
    b = point(end),
    selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.setBaseAndExtent(...(reverse ? b : a), ...(reverse ? a : b));
  return selection;
}
afterEach(() => window.getSelection()?.removeAllRanges());
describe('DOM Selection canonical offsets', () => {
  it.each([
    [0, 3],
    [8, 12],
    [4, 14],
    [14, 16],
    [16, 25],
    [8, 25],
  ])('multi-leaf/repeated/strong/em/sub/sup [%i,%i)', (start, end) => {
    const f = fixture();
    expect(
      selectionToStatementRange(f.root, select(f.root, start, end), f.projection, f.fragments),
    ).toEqual({ start, end });
  });
  it('reverse selection and element boundary offsets, br adds zero', () => {
    const f = fixture();
    expect(
      selectionToStatementRange(f.root, select(f.root, 2, 25, true), f.projection, f.fragments),
    ).toEqual({ start: 2, end: 25 });
    const range = document.createRange();
    range.setStart(f.root, 1);
    range.setEnd(f.root, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectionToStatementRange(f.root, selection, f.projection, f.fragments)).toEqual({
      start: 8,
      end: 19,
    });
  });
  it('empty/outside/partially outside and surrogate cuts rejected', () => {
    const f = fixture();
    expect(selectionToStatementRange(f.root, null, f.projection, f.fragments)).toBeNull();
    expect(
      selectionToStatementRange(f.root, select(f.root, 3, 3), f.projection, f.fragments),
    ).toBeNull();
    expect(
      selectionToStatementRange(f.root, select(f.root, 14, 15), f.projection, f.fragments),
    ).toBeNull();
    const outside = document.createTextNode('outside');
    document.body.append(outside);
    const selection = window.getSelection()!,
      range = document.createRange();
    range.setStart(f.root, 0);
    range.setEnd(outside, 3);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectionToStatementRange(f.root, selection, f.projection, f.fragments)).toBeNull();
    outside.remove();
  });
  it.each([
    [3, 5],
    [4, 10],
    [0, 4],
    [2, 12],
    [8, 18],
    [1, 24],
  ])('fragmented marks map [%i,%i) after reload/recolor/erase/split', (start, end) => {
    let value = mutateAnnotations(exam, emptyAnnotations(exam), questionId, {
      type: 'paint',
      start: 2,
      end: 12,
      color: 'yellow',
    });
    value = mutateAnnotations(exam, value, questionId, {
      type: 'paint',
      start: 5,
      end: 8,
      color: 'green',
    });
    value = mutateAnnotations(exam, value, questionId, { type: 'erase', start: 9, end: 10 });
    const ranges = JSON.parse(JSON.stringify(value.questions[questionId])) as Highlight[];
    const f = fixture(ranges);
    expect(
      selectionToStatementRange(f.root, select(f.root, start, end), f.projection, f.fragments),
    ).toEqual({ start, end });
  });
  it('one logical ID across tags yields multiple marks, source structure remains valid', () => {
    const f = fixture([{ id: 'logical', start: 4, end: 24, color: 'blue' }]);
    expect(f.root.querySelectorAll('mark[data-highlight-id="logical"]').length).toBe(5);
    expect(f.root.querySelectorAll('strong,em,sub,sup,br').length).toBe(5);
  });
  it('red team: identical object reused as two leaves maps by academic path', () => {
    const text = { type: 'text' as const, text: 'igual' };
    const projection = projectStatement([text, text]),
      fragments: StatementTextMap = new Map();
    const { container } = render(
      <div>
        <StatementContent projection={projection} fragments={fragments} highlights={[]} />
      </div>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(selectionToStatementRange(root, select(root, 6, 9), projection, fragments)).toEqual({
      start: 6,
      end: 9,
    });
  });
  it('tampered DOM is rejected instead of trusting DOM text authority', () => {
    const f = fixture();
    const first = f.fragments.keys().next().value!;
    first.data = 'tampered';
    expect(
      selectionToStatementRange(f.root, select(f.root, 0, 2), f.projection, f.fragments),
    ).toBeNull();
  });
});
