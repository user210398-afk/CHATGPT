import {
  validBoundary,
  validStatementRange,
  type StatementProjection,
} from './statement-projection';
export interface TextFragment {
  leafPath: string;
  localStart: number;
  localEnd: number;
}
export type StatementTextMap = Map<Text, TextFragment>;
// All DOM points share the renderer's path/fragment map; DOM text only validates it.
export function domPointToStatementOffset(
  root: HTMLElement,
  container: Node,
  localOffset: number,
  projection: StatementProjection,
  fragments: StatementTextMap,
): number | null {
  if (!root.contains(container) || !Number.isSafeInteger(localOffset) || localOffset < 0)
    return null;
  const records: { node: Text; start: number; end: number }[] = [];
  const byPath = new Map(projection.leaves.map((leaf) => [leaf.path, leaf]));
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const fragment = fragments.get(node as Text);
    const leaf = fragment && byPath.get(fragment.leafPath);
    if (
      !fragment ||
      !leaf ||
      !Number.isSafeInteger(fragment.localStart) ||
      !Number.isSafeInteger(fragment.localEnd) ||
      fragment.localEnd < fragment.localStart ||
      fragment.localStart < 0 ||
      fragment.localEnd > leaf.node.text.length ||
      (node as Text).data !== leaf.node.text.slice(fragment.localStart, fragment.localEnd)
    )
      return null;
    records.push({
      node: node as Text,
      start: leaf.start + fragment.localStart,
      end: leaf.start + fragment.localEnd,
    });
  }
  if (
    records.some((record, index) => record.start !== (index ? records[index - 1]!.end : 0)) ||
    (records.at(-1)?.end ?? 0) !== projection.length
  )
    return null;
  function offset(container: Node, localOffset: number): number | null {
    if (container.nodeType === Node.TEXT_NODE) {
      const record = records.find((record) => record.node === container);
      return record && localOffset >= 0 && localOffset <= record.end - record.start
        ? record.start + localOffset
        : null;
    }
    if (container.nodeType !== Node.ELEMENT_NODE || localOffset > container.childNodes.length)
      return null;
    const point = root.ownerDocument.createRange();
    point.setStart(container, localOffset);
    point.collapse(true);
    let result = 0;
    for (const record of records) {
      const boundary = root.ownerDocument.createRange();
      boundary.setStart(record.node, 0);
      boundary.collapse(true);
      if (point.compareBoundaryPoints(Range.START_TO_START, boundary) <= 0) return record.start;
      boundary.setStart(record.node, record.end - record.start);
      if (point.compareBoundaryPoints(Range.START_TO_START, boundary) < 0) return null;
      result = record.end;
    }
    return result;
  }
  const result = offset(container, localOffset);
  // Reject caret boundaries inside surrogate pairs; never snap/infer a character.
  return result !== null && validBoundary(projection, result) ? result : null;
}
export function selectionToStatementRange(
  root: HTMLElement,
  selection: Selection | null,
  projection: StatementProjection,
  fragments: StatementTextMap,
) {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const start = domPointToStatementOffset(
    root,
    range.startContainer,
    range.startOffset,
    projection,
    fragments,
  );
  const end = domPointToStatementOffset(
    root,
    range.endContainer,
    range.endOffset,
    projection,
    fragments,
  );
  return start !== null && end !== null && validStatementRange(projection, start, end)
    ? { start, end }
    : null;
}

export interface CaretDocument {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}
// Injecting the caret APIs makes the browser hit-test independently testable.
export function coordinateToStatementOffset(
  root: HTMLElement,
  x: number,
  y: number,
  projection: StatementProjection,
  fragments: StatementTextMap,
  caret: CaretDocument = root.ownerDocument as Document & CaretDocument,
): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const box = root.getBoundingClientRect();
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
  try {
    if (caret.caretPositionFromPoint) {
      const point = caret.caretPositionFromPoint(x, y);
      return point
        ? domPointToStatementOffset(root, point.offsetNode, point.offset, projection, fragments)
        : null;
    }
    const range = caret.caretRangeFromPoint?.(x, y);
    return range
      ? domPointToStatementOffset(
          root,
          range.startContainer,
          range.startOffset,
          projection,
          fragments,
        )
      : null;
  } catch {
    return null;
  }
}
