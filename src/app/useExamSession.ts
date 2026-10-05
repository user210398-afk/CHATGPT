import { useEffect, useRef, useState } from 'react';
import type { Exam } from '../types/exam';
import { createAttempt, transition, type ExamAction, type AttemptMode } from '../engine/exam-state';
import { AttemptRepository, type ReadSession } from '../engine/persistence';
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
  const reviews = useRef(new ReviewRepository(repository.storage));
  function publish(next: ReadSession) {
    latest.current = next;
    setSession(next);
  }
  function persist(next: ReadSession, capture = false, expected?: Map<string, string | null>) {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = null;
    if (!next.current) return false;
    const saved = repository.save(exam, next.current, next.history, expected);
    if (saved.aborted) {
      publish({ ...latest.current, warning: saved.warning });
      setSaving(false);
      return false;
    }
    let warning = saved.warning;
    if (capture) {
      try {
        reviews.current.capture(exam, next.current);
      } catch {
        warning = [
          warning,
          'A tentativa foi concluída, mas o histórico detalhado de revisão não pôde ser salvo.',
        ]
          .filter(Boolean)
          .join(' ');
      }
    }
    publish({ ...next, ...saved, warning });
    setSaving(false);
    return true;
  }
  function start(mode: AttemptMode) {
    const current = latest.current.current;
    if (current && !current.completedAt) return false;
    let expected: Map<string, string | null> | undefined;
    if (current?.completedAt) {
      try {
        expected = reviews.current.capture(exam, current, true);
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
    );
    if (started) setChoosing(false);
    return started;
  }
  useEffect(() => {
    if (!latest.current.current && preference !== 'ask' && !latest.current.warning)
      start(preference);
    const flushOnExit = () => {
      if (pending.current !== null && latest.current.current) {
        clearTimeout(pending.current);
        pending.current = null;
        repository.save(exam, latest.current.current, latest.current.history);
      }
    };
    window.addEventListener('pagehide', flushOnExit);
    return () => {
      window.removeEventListener('pagehide', flushOnExit);
      flushOnExit();
    };
    // Preference changes affect only the next explicit start/restart.
  }, [exam, repository]);
  function dispatch(action: ExamAction) {
    const previous = latest.current.current;
    if (!previous || choosing) return;
    if (previous.completedAt && action.type === 'navigate') return;
    if (previous.completedAt && action.type === 'flag') {
      try {
        publish({
          ...latest.current,
          current: reviews.current.toggleFlag(exam, previous, action.questionId),
          warning: null,
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
    if (!current?.completedAt) return false;
    try {
      reviews.current.capture(exam, current, true);
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
