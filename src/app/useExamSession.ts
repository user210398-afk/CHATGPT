import { useEffect, useRef, useState } from 'react';
import type { Exam } from '../types/exam';
import { createAttempt, transition, type ExamAction, type AttemptMode } from '../engine/exam-state';
import {
  AttemptRepository,
  storageKey,
  historyStorageKey,
  type ReadSession,
  type PersistenceSnapshot,
  type StorageAdapter,
} from '../engine/persistence';
import { ReviewRepository } from '../engine/review-history';
import type { UiPreferences } from '../engine/ui-preferences';
const browserRepository = new AttemptRepository(() => window.localStorage);
const ESSAY_SAVE_DELAY_MS = 500;
export function useExamSession(
  exam: Exam,
  preference: UiPreferences['attemptModePreference'] = 'ask',
  repository = browserRepository,
) {
  const [session, setSession] = useState(() => repository.read(exam));
  const [choosing, setChoosing] = useState(() => session.current === null);
  const [saving, setSaving] = useState(false);
  const latest = useRef(session);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const conflicted = useRef(false);
  function publish(next: ReadSession) {
    latest.current = next;
    if (mounted.current) setSession(next);
  }
  function stopSaving() {
    if (mounted.current) setSaving(false);
  }
  function reviewOperation<T>(
    snapshot: PersistenceSnapshot,
    rewriteHistory: boolean,
    operation: (reviews: ReviewRepository) => T,
  ) {
    const warning = repository.guard(exam, snapshot, rewriteHistory);
    if (warning) throw new Error(warning);
    const store = repository.storage();
    const ownRaws = new Map<string, string | null>([
      [storageKey(exam), snapshot.current.raw!],
      [historyStorageKey(exam), snapshot.history.raw!],
    ]);
    // The existing ReviewRepository remains unchanged. Its current/history reads
    // must match this consumer, and only its confirmed own writes advance our token.
    const guarded: StorageAdapter = {
      getItem: (key) => {
        const raw = store.getItem(key);
        if (ownRaws.has(key) && raw !== ownRaws.get(key))
          throw new Error('A tentativa mudou por concorrência. Reabra a prova.');
        return raw;
      },
      setItem: (key, raw) => {
        if (ownRaws.has(key)) ownRaws.set(key, raw);
        store.setItem(key, raw);
      },
      ...(store.removeItem
        ? {
            removeItem: (key: string) => {
              if (ownRaws.has(key)) ownRaws.set(key, null);
              store.removeItem!(key);
            },
          }
        : {}),
    };
    const value = operation(new ReviewRepository(() => guarded));
    const ownCurrent = ownRaws.get(storageKey(exam))!;
    const persistence =
      ownCurrent !== snapshot.current.raw && ownCurrent !== null
        ? repository.afterCurrentWrite(exam, snapshot, ownCurrent)
        : snapshot;
    return { value, persistence };
  }
  function persist(
    next: ReadSession,
    capture = false,
    additionalExpected?: Map<string, string | null>,
    starting = false,
  ) {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = null;
    if (!next.current || conflicted.current) {
      stopSaving();
      return false;
    }
    const saved = repository.save(
      exam,
      next.current,
      next.history,
      next.persistence,
      additionalExpected,
    );
    if (saved.status !== 'saved') {
      if (saved.status === 'conflict' || saved.rollbackComplete === false)
        conflicted.current = true;
      // Retain answer drafts, but never publish a rejected completion or replace a
      // completed current with a new attempt whose start was rejected.
      const draft =
        !capture && (!starting || (!latest.current.current && saved.status === 'storage-error'))
          ? next
          : latest.current;
      publish({
        ...draft,
        warning: starting ? `A nova tentativa não foi iniciada. ${saved.warning}` : saved.warning,
      });
      stopSaving();
      return false;
    }
    let warning = saved.warning,
      persistence = saved.persistence;
    if (capture) {
      try {
        persistence = reviewOperation(persistence, false, (reviews) =>
          reviews.capture(exam, next.current!),
        ).persistence;
      } catch {
        warning = [
          warning,
          'A tentativa foi concluída, mas o histórico detalhado de revisão não pôde ser salvo.',
        ]
          .filter(Boolean)
          .join(' ');
      }
    }
    publish({ ...next, history: saved.history, persistence, warning });
    stopSaving();
    return true;
  }
  function start(mode: AttemptMode) {
    const current = latest.current.current;
    if (current && !current.completedAt) return false;
    let expected: Map<string, string | null> | undefined;
    if (current?.completedAt) {
      try {
        expected = reviewOperation(latest.current.persistence, true, (reviews) =>
          reviews.capture(exam, current, true),
        ).value;
      } catch {
        publish({
          ...latest.current,
          warning:
            'Não foi possível preservar o histórico detalhado. A nova tentativa não foi iniciada.',
        });
        return false;
      }
    }
    const started = persist(
      {
        ...latest.current,
        current: createAttempt(exam, undefined, undefined, mode),
        restored: false,
      },
      false,
      expected,
      true,
    );
    if (started || (latest.current.current && !latest.current.current.completedAt))
      setChoosing(false);
    return started;
  }
  useEffect(() => {
    mounted.current = true;
    if (!latest.current.current && preference !== 'ask' && !latest.current.warning)
      start(preference);
    const flushOnExit = () => {
      if (pending.current !== null && latest.current.current) {
        clearTimeout(pending.current);
        pending.current = null;
        persist(latest.current);
      }
    };
    window.addEventListener('pagehide', flushOnExit);
    return () => {
      window.removeEventListener('pagehide', flushOnExit);
      mounted.current = false;
      flushOnExit();
    };
    // Preference changes affect only the next explicit start/restart.
  }, [exam, repository]);
  function dispatch(action: ExamAction) {
    const previous = latest.current.current;
    if (!previous || choosing || conflicted.current) return;
    if (previous.completedAt && action.type === 'navigate') return;
    if (previous.completedAt && action.type === 'flag') {
      try {
        const changed = reviewOperation(latest.current.persistence, false, (reviews) =>
          reviews.toggleFlag(exam, previous, action.questionId),
        );
        publish({
          ...latest.current,
          current: changed.value,
          persistence: changed.persistence,
          warning: latest.current.warning,
        });
      } catch (error) {
        publish({
          ...latest.current,
          warning: `Não foi possível alterar a marcação de revisão. ${error instanceof Error ? error.message : ''}`,
        });
      }
      return;
    }
    const current = transition(exam, previous, action);
    if (current === previous) return;
    const next = { ...latest.current, current };
    if (
      action.type === 'answer' &&
      exam.questions.some((q) => q.id === action.questionId && q.type === 'essay')
    ) {
      if (pending.current !== null) clearTimeout(pending.current);
      publish(next);
      setSaving(true);
      pending.current = setTimeout(() => persist(latest.current), ESSAY_SAVE_DELAY_MS);
    } else persist(next, action.type === 'finish');
  }
  function restart() {
    const current = latest.current.current;
    if (!current?.completedAt || conflicted.current) return false;
    try {
      reviewOperation(latest.current.persistence, true, (reviews) =>
        reviews.capture(exam, current, true),
      );
    } catch {
      publish({
        ...latest.current,
        warning:
          'Não foi possível preservar o histórico detalhado. A nova tentativa não foi iniciada.',
      });
      return false;
    }
    if (preference === 'ask') setChoosing(true);
    else return start(preference);
    return true;
  }
  return { ...session, choosing, saving, dispatch, restart, start };
}
