import type { RichNode, RichText } from '../types/exam';
export interface StatementLeaf {
  node: Extract<RichNode, { type: 'text' }>;
  path: string;
  start: number;
  end: number;
}
// Persistent v1 contract: exact UTF-16, DFS, text only; br/structure add zero units.
export function projectStatement(statement: RichText) {
  const leaves: StatementLeaf[] = [];
  let text = '';
  function visit(nodes: RichText, parent: string) {
    nodes.forEach((node, index) => {
      const path = `${parent}${index}`;
      if (node.type === 'text') {
        const start = text.length;
        text += node.text;
        leaves.push({ node, path, start, end: text.length });
      } else visit(node.children, `${path}.`);
    });
  }
  visit(statement, '');
  return { leaves, text, length: text.length, content: statement };
}
export type StatementProjection = ReturnType<typeof projectStatement>;
export function validBoundary(projection: StatementProjection, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > projection.length) return false;
  const before = projection.text.charCodeAt(offset - 1);
  const after = projection.text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
export function validStatementRange(projection: StatementProjection, start: number, end: number) {
  return start < end && validBoundary(projection, start) && validBoundary(projection, end);
}
