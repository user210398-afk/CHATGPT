import { useEffect, useRef, useState } from 'react';
import type { Exam } from '../types/exam';
import { createAttempt, transition, type ExamAction } from '../engine/exam-state';
import { AttemptRepository, type Session } from '../engine/persistence';
const browserRepository = new AttemptRepository(() => window.localStorage);
const ESSAY_SAVE_DELAY_MS = 500;
export function useExamSession(exam: Exam, repository = browserRepository) {
  const [session, setSession] = useState(() => repository.load(exam));
  const [saving, setSaving] = useState(false);
  const latest = useRef(session);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!latest.current.restored && !latest.current.warning) {
      const saved = repository.save(exam, latest.current.current, latest.current.history);
      latest.current = { ...latest.current, ...saved };
      setSession(latest.current);
    }
    // Um fechamento/reload antes do prazo do debounce ainda tenta salvar o texto atual.
    const flushOnExit = () => {
      if (pending.current !== null) {
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
  }, [exam, repository]);
  function persist(next: Session) {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = null;
    const saved = repository.save(exam, next.current, next.history);
    latest.current = { ...next, ...saved };
    setSession(latest.current);
    setSaving(false);
  }
  function dispatch(action: ExamAction) {
    const current = transition(exam, latest.current.current, action);
    if (current === latest.current.current) return;
    const next = { ...latest.current, current };
    if (
      action.type === 'answer' &&
      exam.questions.some((q) => q.id === action.questionId && q.type === 'essay')
    ) {
      if (pending.current !== null) clearTimeout(pending.current);
      latest.current = next;
      setSession(next);
      setSaving(true);
      pending.current = setTimeout(() => persist(latest.current), ESSAY_SAVE_DELAY_MS);
    } else {
      // Navegação, marcação e finalização gravam o texto pendente na mesma escrita.
      persist(next);
    }
  }
  function restart() {
    persist({ ...latest.current, current: createAttempt(exam), restored: false });
  }
  return { ...session, saving, dispatch, restart };
}
