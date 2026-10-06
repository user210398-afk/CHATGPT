import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatementContent } from '../src/components/questions/AnnotatedStatement';
import {
  coordinateToStatementOffset,
  domPointToStatementOffset,
  type StatementTextMap,
} from '../src/engine/statement-selection';
import { projectStatement } from '../src/engine/statement-projection';
import type { RichText } from '../src/types/exam';
import { statement } from './phase8a-fixtures';
import { point } from './gesture-fixtures';
function fixture(content: RichText = statement) {
  const projection = projectStatement(content),
    fragments: StatementTextMap = new Map();
  const { container } = render(
    <div>
      <StatementContent
        projection={projection}
        highlights={[{ id: 'old', start: 2, end: 12, color: 'yellow' }]}
        fragments={fragments}
      />
    </div>,
  );
  const root = container.firstElementChild as HTMLElement;
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 10,
    right: 100,
    bottom: 100,
  } as DOMRect);
  return { root, projection, fragments };
}
describe('coordinate → shared canonical DOM boundary', () => {
  it.each([0, 2, 8, 12, 14, 16, 17, 18, 19, 21, 24, 25])(
    'fragmented rich repeated/emoji/combining offset %i',
    (offset) => {
      const f = fixture();
      const [offsetNode, local] = point(f.root, offset);
      expect(
        coordinateToStatementOffset(f.root, 20, 20, f.projection, f.fragments, {
          caretPositionFromPoint: () => ({ offsetNode, offset: local }),
        }),
      ).toBe(offset);
    },
  );
  it('fallback only when caretPosition API absent, using same mapping', () => {
    const f = fixture(),
      range = document.createRange();
    range.setStart(...point(f.root, 12));
    range.collapse(true);
    const fallback = vi.fn(() => range);
    expect(
      coordinateToStatementOffset(f.root, 20, 20, f.projection, f.fragments, {
        caretRangeFromPoint: fallback,
      }),
    ).toBe(12);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(
      coordinateToStatementOffset(f.root, 20, 20, f.projection, f.fragments, {
        caretPositionFromPoint: () => null,
        caretRangeFromPoint: fallback,
      }),
    ).toBeNull();
    expect(fallback).toHaveBeenCalledTimes(1);
  });
  it('Element boundaries deterministic; no DOM child index used as path identity', () => {
    const f = fixture();
    for (const [offset, expected] of [
      [0, 0],
      [1, 8],
      [2, 16],
      [3, 16],
      [4, 19],
      [6, 25],
    ]) {
      expect(domPointToStatementOffset(f.root, f.root, offset!, f.projection, f.fragments)).toBe(
        expected,
      );
    }
    expect(
      coordinateToStatementOffset(f.root, 20, 20, f.projection, f.fragments, {
        caretPositionFromPoint: () => ({ offsetNode: f.root, offset: 3 }),
      }),
    ).toBe(16);
  });
  it('identical reused RichNode maps by path, including nested reuse', () => {
    const text = { type: 'text' as const, text: 'igual' };
    const f = fixture([text, { type: 'element', tag: 'strong', children: [text] }, text]);
    const [node, offset] = point(f.root, 13);
    expect(domPointToStatementOffset(f.root, node, offset, f.projection, f.fragments)).toBe(13);
  });
  it.each([15, 20])(
    'surrogate boundary %i rejected; combining mark boundary remains exact',
    (offset) => {
      const f = fixture();
      const [node, local] = point(f.root, offset);
      expect(domPointToStatementOffset(f.root, node, local, f.projection, f.fragments)).toBeNull();
      const [combining, index] = point(f.root, 18);
      expect(domPointToStatementOffset(f.root, combining, index, f.projection, f.fragments)).toBe(
        18,
      );
    },
  );
  it('outside, non-finite, unmapped, invalid offsets, exceptions fail closed', () => {
    const f = fixture();
    const api = vi.fn(() => ({ offsetNode: f.root, offset: 0 }));
    for (const [x, y] of [
      [9, 20],
      [101, 20],
      [20, 9],
      [20, 101],
      [NaN, 20],
    ])
      expect(
        coordinateToStatementOffset(f.root, x!, y!, f.projection, f.fragments, {
          caretPositionFromPoint: api,
        }),
      ).toBeNull();
    expect(api).not.toHaveBeenCalled();
    expect(
      domPointToStatementOffset(f.root, document.body, 0, f.projection, f.fragments),
    ).toBeNull();
    for (const offset of [-1, 0.5, 500])
      expect(
        domPointToStatementOffset(f.root, f.root, offset, f.projection, f.fragments),
      ).toBeNull();
    expect(
      coordinateToStatementOffset(f.root, 20, 20, f.projection, f.fragments, {
        caretPositionFromPoint: () => {
          throw new Error('unsupported');
        },
      }),
    ).toBeNull();
  });
  it('tampered/foreign Text or reordered mapped DOM is never authority', () => {
    const f = fixture();
    const [node, offset] = point(f.root, 2);
    node.data = 'tampered';
    expect(domPointToStatementOffset(f.root, node, offset, f.projection, f.fragments)).toBeNull();
  });
  it('reordered registered nodes and invalid fragment boundaries fail closed', () => {
    const f = fixture();
    const nodes = [...f.fragments.keys()];
    const first = nodes[0]!,
      second = nodes[1]!;
    const record = f.fragments.get(first)!;
    f.fragments.set(first, { ...record, localStart: 0.5 });
    expect(domPointToStatementOffset(f.root, second, 0, f.projection, f.fragments)).toBeNull();
    f.fragments.set(first, record);
    f.root.prepend(nodes.at(-1)!);
    expect(domPointToStatementOffset(f.root, second, 0, f.projection, f.fragments)).toBeNull();
  });
  it('all rich tags/blocks/list/table keep deterministic canonical mapping', () => {
    // Valid HTML nesting for structural tags; every supported tag is represented.
    const content: RichText = [
      ...(['b', 'i', 'u', 's', 'p', 'div', 'strong', 'em', 'sub', 'sup', 'span'] as const).map(
        (tag) => ({
          type: 'element' as const,
          tag,
          children: [{ type: 'text' as const, text: 'igual' }],
        }),
      ),
      {
        type: 'element',
        tag: 'ul',
        children: [{ type: 'element', tag: 'li', children: [{ type: 'text', text: 'igual' }] }],
      },
      {
        type: 'element',
        tag: 'ol',
        children: [{ type: 'element', tag: 'li', children: [{ type: 'text', text: 'igual' }] }],
      },
      {
        type: 'element',
        tag: 'table',
        children: [
          {
            type: 'element',
            tag: 'thead',
            children: [
              {
                type: 'element',
                tag: 'tr',
                children: [
                  { type: 'element', tag: 'th', children: [{ type: 'text', text: 'igual' }] },
                ],
              },
            ],
          },
          {
            type: 'element',
            tag: 'tbody',
            children: [
              {
                type: 'element',
                tag: 'tr',
                children: [
                  { type: 'element', tag: 'td', children: [{ type: 'text', text: 'igual' }] },
                ],
              },
            ],
          },
        ],
      },
      { type: 'element', tag: 'br', children: [] },
    ];
    const f = fixture(content);
    for (let offset = 0; offset <= f.projection.length; offset++) {
      const [node, local] = point(f.root, offset);
      expect(domPointToStatementOffset(f.root, node, local, f.projection, f.fragments)).toBe(
        offset,
      );
    }
  });
});
