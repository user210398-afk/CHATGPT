import { createElement } from 'react';
import type { RichNode, RichText } from '../../types/exam';
function renderNode(node: RichNode, key: number): React.ReactNode {
  if (node.type === 'text') return node.text;
  if (node.tag === 'br') return <br key={key} />;
  return createElement(node.tag, { key }, node.children.map(renderNode));
}
export function RichContent({ content }: { content: RichText }) {
  return <div className="rich-content">{content.map(renderNode)}</div>;
}
