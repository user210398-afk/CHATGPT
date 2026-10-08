import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GuidedTourState } from '../../app/useGuidedTour';
import { guidedTourSteps } from '../../app/guided-tour';

type Box = { left: number; top: number; width: number; height: number };

export function GuidedTour({ tour }: { tour: GuidedTourState }) {
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const step = tour.step!;

  useEffect(() => {
    const body = document.body;
    const oldOverflow = body.style.overflow;
    const oldPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0)
      body.style.paddingRight = `${(parseFloat(getComputedStyle(body).paddingRight) || 0) + scrollbar}px`;
    return () => {
      body.style.overflow = oldOverflow;
      body.style.paddingRight = oldPadding;
    };
  }, []);

  useLayoutEffect(() => {
    if (panel.current) {
      panel.current.scrollTop = 0;
      panel.current.scrollLeft = 0;
    }
    heading.current?.focus({ preventScroll: true });
    let target: Element | null = null;
    let frame = 0;
    const measure = () => {
      const found = document.querySelector(step.target);
      if (found !== target) {
        target = found;
        // Instant positioning also respects both reduced-motion preferences.
        target?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const offsetX = viewport?.offsetLeft ?? 0;
      const offsetY = viewport?.offsetTop ?? 0;
      if (panel.current) {
        panel.current.style.maxWidth = `${Math.max(0, width - 32)}px`;
        panel.current.style.maxHeight = `${Math.max(0, height - 32)}px`;
      }
      const rect = target?.getBoundingClientRect();
      const left = Math.max(offsetX + 8, (rect?.left ?? 0) - 6);
      const top = Math.max(offsetY + 8, (rect?.top ?? 0) - 6);
      const right = Math.min(offsetX + width - 8, (rect?.right ?? 0) + 6);
      const bottom = Math.min(offsetY + height - 8, (rect?.bottom ?? 0) + 6);
      const nextBox =
        rect && rect.width > 0 && rect.height > 0 && right > left && bottom > top
          ? { left, top, width: right - left, height: bottom - top }
          : null;
      setBox(nextBox);
      const panelRect = panel.current?.getBoundingClientRect();
      if (!panelRect) return;
      const gap = 16;
      let panelTop = offsetY + (height - panelRect.height) / 2;
      let panelLeft = offsetX + (width - panelRect.width) / 2;
      if (nextBox) {
        if (bottom + gap + panelRect.height <= offsetY + height - gap) panelTop = bottom + gap;
        else if (top - gap - panelRect.height >= offsetY + gap)
          panelTop = top - gap - panelRect.height;
        else if (right + gap + panelRect.width <= offsetX + width - gap) panelLeft = right + gap;
        else if (left - gap - panelRect.width >= offsetX + gap)
          panelLeft = left - gap - panelRect.width;
        // On short/narrow screens the panel is a bottom sheet; its own content scrolls.
        else panelTop = offsetY + height - panelRect.height - gap;
      }
      setPosition({
        left: Math.max(offsetX + gap, Math.min(panelLeft, offsetX + width - panelRect.width - gap)),
        top: Math.max(offsetY + gap, Math.min(panelTop, offsetY + height - panelRect.height - gap)),
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    // Lazy pages and missing/replaced targets must never block navigation.
    const observer = new MutationObserver(schedule);
    const surface = document.getElementById('app-surface');
    if (surface) observer.observe(surface, { childList: true, subtree: true, attributes: true });
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (surface) resize?.observe(surface);
    if (panel.current) resize?.observe(panel.current);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      observer.disconnect();
      resize?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [step]);

  return createPortal(
    <div className={`tour-layer${box ? '' : ' tour-layer-fallback'}`}>
      {box && <div className="tour-spotlight" aria-hidden="true" style={box} />}
      <div
        ref={panel}
        className="card tour-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-progress tour-description tour-keyboard"
        style={position ?? undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            tour.close();
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            tour.next();
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            tour.previous();
          }
          if (event.key !== 'Tab') return;
          const buttons = [
            ...panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ];
          const first = buttons[0]!,
            last = buttons[buttons.length - 1]!;
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === heading.current)
          ) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || document.activeElement === heading.current)
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <p className="eyebrow" id="tour-progress">
          CONHECER O MEDSIM · ETAPA {tour.index! + 1} DE {guidedTourSteps.length}
        </p>
        <h2 id="tour-title" ref={heading} tabIndex={-1}>
          {step.title}
        </h2>
        <p id="tour-description">{step.description}</p>
        {!box && (
          <p className="muted small">
            O destaque desta etapa está indisponível. Você pode continuar a apresentação.
          </p>
        )}
        <p id="tour-keyboard" className="muted small">
          Use Tab para os botões, as setas para navegar ou Escape para sair.
        </p>
        <div className="tour-actions">
          <button onClick={tour.previous} disabled={tour.index === 0}>
            Anterior
          </button>
          <button className="primary" onClick={tour.next}>
            {tour.index === guidedTourSteps.length - 1 ? 'Concluir' : 'Próximo'}
          </button>
          <button onClick={tour.close}>Sair</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
