import { validStatementRange, type StatementProjection } from './statement-projection';
export interface TextFragment {
  leafPath: string;
  localStart: number;
  localEnd: number;
}
export type StatementTextMap = Map<Text, TextFragment>;
export function selectionToStatementRange(
  root: HTMLElement,
  selection: Selection | null,
  projection: StatementProjection,
  fragments: StatementTextMap,
) {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const records: { node: Text; start: number; end: number }[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const fragment = fragments.get(node as Text);
    const leaf = fragment && projection.leaves.find((leaf) => leaf.path === fragment.leafPath);
    if (
      !fragment ||
      !leaf ||
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
  const start = offset(range.startContainer, range.startOffset),
    end = offset(range.endContainer, range.endOffset);
  return start !== null && end !== null && validStatementRange(projection, start, end)
    ? { start, end }
    : null;
}
