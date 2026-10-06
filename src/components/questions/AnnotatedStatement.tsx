import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Exam, RichNode } from '../../types/exam';
import type { Highlight } from '../../engine/question-annotations';
import {
  projectStatement,
  validStatementRange,
  type StatementProjection,
} from '../../engine/statement-projection';
import {
  coordinateToStatementOffset,
  type StatementTextMap,
} from '../../engine/statement-selection';
import { useQuestionAnnotations } from '../../app/useQuestionAnnotations';
type Tool = 'off' | 'highlight' | 'eraser';
type Color = Highlight['color'];
interface Preview {
  start: number;
  end: number;
  tool: Exclude<Tool, 'off'>;
  color: Color;
}
export function StatementContent({
  projection,
  highlights,
  fragments,
  preview,
}: {
  projection: StatementProjection;
  highlights: Highlight[];
  fragments: StatementTextMap;
  preview?: Preview | null;
}) {
  const byPath = new Map(projection.leaves.map((leaf) => [leaf.path, leaf]));
  function renderNode(node: RichNode, path: string): React.ReactNode {
    if (node.type === 'element')
      return node.tag === 'br' ? (
        <br key={path} />
      ) : (
        createElement(
          node.tag,
          { key: path },
          node.children.map((child, index) => renderNode(child, `${path}.${index}`)),
        )
      );
    const leaf = byPath.get(path)!;
    const pieces: React.ReactNode[] = [];
    function piece(start: number, end: number, highlight?: Highlight) {
      if (start === end) return;
      let registered: Text | null = null;
      const pending = preview && start >= preview.start && end <= preview.end;
      const text = (
        <span
          key={start}
          className={
            pending
              ? `annotation-preview ${preview.tool === 'eraser' ? 'annotation-preview-eraser' : `annotation-${preview.color}`}`
              : undefined
          }
          data-annotation-preview={pending ? preview.tool : undefined}
          ref={(element) => {
            if (registered) fragments.delete(registered);
            registered = element?.firstChild as Text | null;
            if (registered)
              fragments.set(registered, {
                leafPath: leaf.path,
                localStart: start - leaf.start,
                localEnd: end - leaf.start,
              });
          }}
        >
          {leaf.node.text.slice(start - leaf.start, end - leaf.start)}
        </span>
      );
      pieces.push(
        highlight ? (
          <mark
            key={start}
            data-highlight-id={highlight.id}
            className={`annotation-${highlight.color}`}
          >
            {text}
          </mark>
        ) : (
          text
        ),
      );
    }
    const boundaries = new Set([leaf.start, leaf.end]);
    for (const range of [...highlights, ...(preview ? [preview] : [])]) {
      if (range.end <= leaf.start || range.start >= leaf.end) continue;
      boundaries.add(Math.max(range.start, leaf.start));
      boundaries.add(Math.min(range.end, leaf.end));
    }
    const points = [...boundaries].sort((a, b) => a - b);
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1]!,
        end = points[index]!;
      piece(
        start,
        end,
        highlights.find((h) => h.start <= start && h.end >= end),
      );
    }
    return (
      <span key={leaf.path} data-statement-leaf={leaf.path}>
        {pieces}
      </span>
    );
  }
  return <>{projection.content.map((node, index) => renderNode(node, String(index)))}</>;
}
export function AnnotatedStatement({
  exam,
  questionId,
  scopeIdentity = '',
}: {
  exam: Exam;
  questionId: string;
  scopeIdentity?: string;
}) {
  return (
    <GestureStatement
      key={`${exam.id}:${exam.revision}:${questionId}:${scopeIdentity}`}
      exam={exam}
      questionId={questionId}
    />
  );
}
function GestureStatement({ exam, questionId }: { exam: Exam; questionId: string }) {
  const question = exam.questions.find((q) => q.id === questionId)!;
  const projection = useMemo(() => projectStatement(question.statement), [question.statement]);
  const fragments = useRef<StatementTextMap>(new Map());
  const root = useRef<HTMLDivElement>(null);
  const highlightButton = useRef<HTMLButtonElement>(null);
  const [tool, setTool] = useState<Tool>('off');
  const [color, setColor] = useState<Color>('yellow');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const annotations = useQuestionAnnotations(exam, questionId);
  const stroke = useRef<{
    questionId: string;
    pointerId: number;
    tool: Exclude<Tool, 'off'>;
    color: Color;
    anchor: number;
    x: number;
    y: number;
    moved: boolean;
    element: HTMLDivElement;
  } | null>(null);
  function release() {
    const pending = stroke.current;
    stroke.current = null; // lostpointercapture must never finalize anything
    if (pending) {
      try {
        if (pending.element.hasPointerCapture?.(pending.pointerId))
          pending.element.releasePointerCapture(pending.pointerId);
      } catch {
        /* capture may already be lost */
      }
    }
  }
  function cancel() {
    release();
    setPreview(null);
  }
  function choose(next: Tool) {
    cancel();
    setActiveId(null);
    setTool(next === tool ? 'off' : next);
  }
  useLayoutEffect(() => {
    if (annotations.blocked) {
      cancel();
      setTool('off');
    }
  }, [annotations.blocked]);
  useLayoutEffect(() => () => release(), []);
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        cancel();
        setTool('off');
        setActiveId(null);
      }
    }
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);
  function hit(x: number, y: number) {
    return root.current
      ? coordinateToStatementOffset(root.current, x, y, projection, fragments.current)
      : null;
  }
  function rangeAt(pending: NonNullable<typeof stroke.current>, current: number) {
    const start = Math.min(pending.anchor, current),
      end = Math.max(pending.anchor, current);
    return pending.moved && validStatementRange(projection, start, end) ? { start, end } : null;
  }
  return (
    <div className="annotation-area">
      <div className="annotation-toolbar" role="group" aria-label="Ferramentas de grifo e borracha">
        <button
          ref={highlightButton}
          disabled={annotations.blocked}
          aria-pressed={tool === 'highlight'}
          onClick={() => choose('highlight')}
        >
          Grifar
        </button>
        <button
          disabled={annotations.blocked}
          aria-pressed={tool === 'eraser'}
          onClick={() => choose('eraser')}
        >
          Borracha
        </button>
        {(['yellow', 'green', 'blue'] as const).map((value, index) => (
          <button
            key={value}
            className={`annotation-${value}`}
            disabled={annotations.blocked}
            aria-pressed={color === value}
            onClick={() => {
              cancel();
              setColor(value);
            }}
          >
            {['Amarelo', 'Verde', 'Azul'][index]}
          </button>
        ))}
        {activeId && (
          <button
            disabled={annotations.blocked}
            onClick={() => {
              cancel();
              annotations.mutate({ type: 'remove', id: activeId });
              setActiveId(null);
              highlightButton.current?.focus();
            }}
          >
            Remover destaque
          </button>
        )}
      </div>
      <p className="muted small" aria-live="polite" aria-atomic="true">
        {tool === 'highlight'
          ? 'Grifo ativo — arraste sobre o enunciado.'
          : tool === 'eraser'
            ? 'Borracha ativa — arraste sobre as marcações.'
            : 'Ferramentas desligadas — escolha Grifar ou Borracha.'}
      </p>
      <div
        className="statement"
        ref={root}
        data-annotation-tool={tool}
        onPointerDown={(event) => {
          if (
            tool === 'off' ||
            annotations.blocked ||
            stroke.current ||
            !event.isPrimary ||
            event.button !== 0 ||
            (event.buttons & 1) === 0
          )
            return;
          const anchor = hit(event.clientX, event.clientY);
          if (anchor === null) return;
          event.preventDefault();
          const element = event.currentTarget;
          try {
            element.setPointerCapture?.(event.pointerId);
          } catch {
            /* unavailable capture: local events still safe */
          }
          stroke.current = {
            questionId,
            pointerId: event.pointerId,
            tool,
            color,
            anchor,
            x: event.clientX,
            y: event.clientY,
            moved: false,
            element,
          };
          setActiveId(null);
        }}
        onPointerMove={(event) => {
          const pending = stroke.current;
          if (!pending || pending.pointerId !== event.pointerId) return;
          if (
            annotations.blocked ||
            pending.tool !== tool ||
            pending.questionId !== questionId ||
            (event.buttons & 1) === 0
          ) {
            cancel();
            return;
          }
          event.preventDefault();
          // Small taps/caret jitter never produce an accidental character highlight.
          pending.moved ||= Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= 3;
          const current = hit(event.clientX, event.clientY);
          if (current === null) return; // keep last valid preview; outside release is zero-write
          const range = rangeAt(pending, current);
          setPreview(range ? { ...range, tool: pending.tool, color: pending.color } : null);
        }}
        onPointerUp={(event) => {
          const pending = stroke.current;
          if (!pending || pending.pointerId !== event.pointerId) return;
          const current = hit(event.clientX, event.clientY);
          const range = current === null ? null : rangeAt(pending, current);
          cancel();
          if (
            range &&
            !annotations.blocked &&
            pending.questionId === questionId &&
            pending.tool === tool
          )
            annotations.mutate(
              pending.tool === 'highlight'
                ? { type: 'paint', ...range, color: pending.color }
                : { type: 'erase', ...range },
            );
        }}
        onPointerCancel={(event) => {
          if (stroke.current?.pointerId === event.pointerId) cancel();
        }}
        onLostPointerCapture={(event) => {
          if (stroke.current?.pointerId === event.pointerId) cancel();
        }}
        onClick={(event) => {
          if (tool !== 'off' || !window.getSelection()?.isCollapsed) return;
          const mark = (event.target as Element).closest('mark[data-highlight-id]');
          if (mark && root.current?.contains(mark))
            setActiveId(mark.getAttribute('data-highlight-id'));
        }}
      >
        <div className="rich-content">
          <StatementContent
            projection={projection}
            highlights={annotations.highlights}
            fragments={fragments.current}
            preview={preview}
          />
        </div>
      </div>
      {annotations.highlights.length > 0 && (
        <details className="annotation-list">
          <summary>Marcações deste enunciado ({annotations.highlights.length})</summary>
          <ul>
            {annotations.highlights.map((h, index) => (
              <li key={h.id}>
                <span className={`annotation-${h.color}`}>
                  {projection.text.slice(h.start, h.end)}
                </span>{' '}
                <button
                  disabled={annotations.blocked}
                  aria-label={`Remover destaque ${index + 1}`}
                  onClick={() => {
                    cancel();
                    annotations.mutate({ type: 'remove', id: h.id });
                    setActiveId(null);
                    highlightButton.current?.focus();
                  }}
                >
                  Remover destaque
                </button>
              </li>
            ))}
          </ul>
          <button
            disabled={annotations.blocked}
            onClick={() => {
              cancel();
              annotations.mutate({ type: 'clear' });
              setActiveId(null);
              highlightButton.current?.focus();
            }}
          >
            Limpar marcações desta questão
          </button>
        </details>
      )}
      {annotations.warning && (
        <p role="status" className="notice">
          {annotations.warning}
        </p>
      )}
    </div>
  );
}
