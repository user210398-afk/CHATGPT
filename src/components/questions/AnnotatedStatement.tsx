import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { Exam, RichNode } from '../../types/exam';
import type { Highlight } from '../../engine/question-annotations';
import { projectStatement, type StatementProjection } from '../../engine/statement-projection';
import { selectionToStatementRange, type StatementTextMap } from '../../engine/statement-selection';
import { useQuestionAnnotations } from '../../app/useQuestionAnnotations';
export function StatementContent({
  projection,
  highlights,
  fragments,
}: {
  projection: StatementProjection;
  highlights: Highlight[];
  fragments: StatementTextMap;
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
    let cursor = leaf.start;
    function piece(start: number, end: number, highlight?: Highlight) {
      if (start === end) return;
      let registered: Text | null = null;
      const text = (
        <span
          key={start}
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
    for (const h of highlights) {
      if (h.end <= leaf.start || h.start >= leaf.end) continue;
      const start = Math.max(h.start, leaf.start),
        end = Math.min(h.end, leaf.end);
      piece(cursor, start);
      piece(start, end, h);
      cursor = end;
    }
    piece(cursor, leaf.end);
    return (
      <span key={leaf.path} data-statement-leaf={leaf.path}>
        {pieces}
      </span>
    );
  }
  return <>{projection.content.map((node, index) => renderNode(node, String(index)))}</>;
}
export function AnnotatedStatement({ exam, questionId }: { exam: Exam; questionId: string }) {
  const question = exam.questions.find((q) => q.id === questionId)!;
  const projection = useMemo(() => projectStatement(question.statement), [question.statement]);
  const fragments = useRef<StatementTextMap>(new Map());
  const root = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const annotations = useQuestionAnnotations(exam, questionId);
  function close() {
    setRange(null);
    setActiveId(null);
  }
  useEffect(() => {
    function selectionChanged() {
      const next = root.current
        ? selectionToStatementRange(
            root.current,
            window.getSelection(),
            projection,
            fragments.current,
          )
        : null;
      if (
        !next &&
        (toolbar.current?.contains(document.activeElement) ||
          document.activeElement === toolsTrigger.current)
      )
        return;
      setRange(next);
      if (next) setActiveId(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (toolbar.current?.contains(document.activeElement)) toolsTrigger.current?.focus();
      close();
    }
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !root.current?.contains(target) &&
        !toolbar.current?.contains(target) &&
        !toolsTrigger.current?.contains(target)
      )
        close();
    }
    document.addEventListener('selectionchange', selectionChanged);
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('selectionchange', selectionChanged);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('pointerdown', outside);
    };
  }, [projection]);
  return (
    <div className="annotation-area">
      <div
        className="statement"
        ref={root}
        onClick={(event) => {
          if (!window.getSelection()?.isCollapsed) return;
          const mark = (event.target as Element).closest('mark[data-highlight-id]');
          if (mark && root.current?.contains(mark)) {
            setActiveId(mark.getAttribute('data-highlight-id'));
            setRange(null);
          }
        }}
      >
        <div className="rich-content">
          <StatementContent
            projection={projection}
            highlights={annotations.highlights}
            fragments={fragments.current}
          />
        </div>
      </div>
      <p className="muted small">
        Selecione um trecho do enunciado para destacar ou apagar marcações.
      </p>
      <button
        ref={toolsTrigger}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => toolbar.current?.querySelector('button')?.focus()}
      >
        Focar ferramentas de marcação
      </button>
      {(range || activeId) && (
        <div
          className="annotation-toolbar"
          role="group"
          aria-label="Ferramentas de marcação"
          ref={toolbar}
        >
          {range && (
            <>
              {(['yellow', 'green', 'blue'] as const).map((color, index) => (
                <button
                  key={color}
                  className={`annotation-${color}`}
                  disabled={annotations.blocked}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    annotations.mutate({ type: 'paint', ...range, color });
                    close();
                    toolsTrigger.current?.focus();
                  }}
                >
                  {['Amarelo', 'Verde', 'Azul'][index]}
                </button>
              ))}
              <button
                disabled={annotations.blocked}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  annotations.mutate({ type: 'erase', ...range });
                  close();
                  toolsTrigger.current?.focus();
                }}
              >
                Borracha
              </button>
            </>
          )}
          {activeId && (
            <button
              disabled={annotations.blocked}
              onClick={() => {
                annotations.mutate({ type: 'remove', id: activeId });
                close();
                toolsTrigger.current?.focus();
              }}
            >
              Remover destaque
            </button>
          )}
          <button
            onClick={() => {
              close();
              toolsTrigger.current?.focus();
            }}
          >
            Fechar ferramentas
          </button>
        </div>
      )}
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
                    annotations.mutate({ type: 'remove', id: h.id });
                    toolsTrigger.current?.focus();
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
              annotations.mutate({ type: 'clear' });
              toolsTrigger.current?.focus();
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
