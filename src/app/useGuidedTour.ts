import { useCallback, useEffect, useRef, useState } from 'react';
import { guidedTourSteps } from './guided-tour';
import { resolveRoute, sitePath } from '../utils/paths';

const contextKey = 'medsimGuidedTour';
type TourContext = { version: 1; step: number; originalUrl: string; active: boolean };
type NavigationState = { context: TourContext | null; pageSearch: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}
function appUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.length || value.length > 1_000_000) return null;
  try {
    const url = new URL(value);
    const base = new URL(sitePath(''), window.location.href);
    return url.href === value &&
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === base.origin &&
      url.pathname === base.pathname &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}
function recoverContext(): TourContext | null {
  try {
    const state: unknown = window.history.state;
    if (!isRecord(state) || !Object.hasOwn(state, contextKey)) return null;
    const context = state[contextKey];
    if (
      !isRecord(context) ||
      Object.keys(context).sort().join(',') !== 'active,originalUrl,step,version' ||
      context.version !== 1 ||
      context.active !== true ||
      typeof context.step !== 'number' ||
      !Number.isInteger(context.step) ||
      context.step < 0 ||
      context.step >= guidedTourSteps.length ||
      !appUrl(context.originalUrl)
    )
      return null;
    const expected = new URL(guidedTourSteps[context.step]!.href(), window.location.href);
    if (!appUrl(window.location.href) || expected.href !== window.location.href) return null;
    return context as TourContext;
  } catch {
    return null;
  }
}
function writeContext(context: TourContext, href: string, push = false): boolean {
  try {
    const existing: unknown = window.history.state;
    // Unknown non-record state belongs to another consumer; never coerce or discard it.
    if (existing !== null && existing !== undefined && !isRecord(existing)) return false;
    const state = { ...(existing ?? {}), [contextKey]: context };
    if (push) window.history.pushState(state, '', href);
    else window.history.replaceState(state, '', href);
    return true;
  } catch {
    return false;
  }
}

export function useGuidedTour() {
  const [navigation, setNavigation] = useState<NavigationState>(() => ({
    context: recoverContext(),
    pageSearch: window.location.search,
  }));
  const current = useRef(navigation.context);
  const position = useRef<{ originalUrl: string; x: number; y: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const publish = useCallback((context: TourContext | null, pageSearch?: string) => {
    current.current = context;
    setNavigation((previous) => ({ context, pageSearch: pageSearch ?? previous.pageSearch }));
  }, []);
  const restoreFocus = useCallback((originalUrl: string) => {
    requestAnimationFrame(() => {
      if (current.current || window.location.href !== originalUrl) return;
      const saved = position.current;
      if (saved?.originalUrl === originalUrl)
        window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
      trigger.current?.focus({ preventScroll: true });
    });
  }, []);
  const visit = useCallback(
    (next: number) => {
      const context = current.current;
      if (!context) return;
      const updated = { ...context, step: next };
      if (writeContext(updated, guidedTourSteps[next]!.href())) publish(updated);
    },
    [publish],
  );
  const close = useCallback(() => {
    const context = current.current;
    if (!context) return;
    // Retire this entry before leaving it: Forward/reload can never reactivate it.
    if (!writeContext({ ...context, active: false }, context.originalUrl)) return;
    publish(null, new URL(context.originalUrl).search);
    restoreFocus(context.originalUrl);
  }, [publish, restoreFocus]);
  useEffect(() => {
    const onHistory = () => {
      const previous = current.current;
      const recovered = recoverContext();
      // Keep a mounted solver stable on Forward; normal destinations follow their actual URL.
      publish(recovered, recovered ? undefined : window.location.search);
      if (previous && !recovered) restoreFocus(previous.originalUrl);
    };
    window.addEventListener('popstate', onHistory);
    return () => window.removeEventListener('popstate', onHistory);
  }, [publish, restoreFocus]);
  const index = navigation.context?.step ?? null;
  const step = index === null ? null : guidedTourSteps[index]!;
  return {
    index,
    step,
    pageSearch: navigation.pageSearch,
    trigger,
    route: step ? resolveRoute(new URL(step.href(), window.location.href).search) : null,
    start: () => {
      if (current.current || !appUrl(window.location.href)) return;
      const originalUrl = window.location.href;
      const context: TourContext = { version: 1, step: 0, originalUrl, active: true };
      if (!writeContext(context, guidedTourSteps[0].href(), true)) return;
      position.current = { originalUrl, x: window.scrollX, y: window.scrollY };
      publish(context);
    },
    previous: () => {
      if (current.current && current.current.step > 0) visit(current.current.step - 1);
    },
    next: () => {
      if (!current.current) return;
      if (current.current.step === guidedTourSteps.length - 1) close();
      else visit(current.current.step + 1);
    },
    close,
  };
}
export type GuidedTourState = ReturnType<typeof useGuidedTour>;
