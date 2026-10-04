import { useEffect, useRef, useState } from 'react';
import type { Exam } from '../types/exam';
import { createAttempt, transition, type ExamAction } from '../engine/exam-state';
import { AttemptRepository, type Session } from '../engine/persistence';
const browserRepository = new AttemptRepository(() => window.localStorage);
export function useExamSession(exam: Exam, repository = browserRepository) {
  const [session, setSession] = useState(() => repository.load(exam));
  const latest = useRef(session);
  useEffect(() => {
    if (!latest.current.restored && !latest.current.warning) {
      const saved = repository.save(exam, latest.current.current, latest.current.history);
      latest.current = { ...latest.current, ...saved };
      setSession(latest.current);
    }
  }, [exam, repository]);
  function persist(next: Session) {
    const saved = repository.save(exam, next.current, next.history);
    latest.current = { ...next, ...saved };
    setSession(latest.current);
  }
  function dispatch(action: ExamAction) {
    const current = transition(exam, latest.current.current, action);
    if (current !== latest.current.current) persist({ ...latest.current, current });
  }
  function restart() {
    persist({ ...latest.current, current: createAttempt(exam), restored: false });
  }
  return { ...session, dispatch, restart };
}
