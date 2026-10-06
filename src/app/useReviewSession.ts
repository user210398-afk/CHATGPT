import { useEffect, useRef, useState } from 'react';
import type { Exam } from '../types/exam';
import { ReviewSessionRepository } from '../engine/review-session-storage';
import { ReviewRepository } from '../engine/review-history';
import { rememberReviewPosition, reviewResumePosition } from '../utils/paths';
import {
  transitionReviewSession,
  type ReviewSession,
  type ReviewSessionAction,
} from '../engine/review-session';
const repository = new ReviewSessionRepository(() => window.localStorage);
const reviews = new ReviewRepository(() => window.localStorage);
export function useReviewSession(exam: Exam) {
  const [loaded] = useState(() => {
    try {
      return { ...repository.read(exam), error: null };
    } catch (error) {
      return {
        session: null,
        raw: null,
        error:
          error instanceof Error
            ? error.message
            : 'Sessão indisponível. O registro foi preservado.',
      };
    }
  });
  const [session, setSession] = useState(loaded.session);
  const [error, setError] = useState(loaded.error);
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState(() => {
    try {
      return loaded.session ? reviews.load(exam, loaded.session.sourceAttemptId) : null;
    } catch {
      return null;
    }
  });
  const sourceRef = useRef(source);
  const latest = useRef(session);
  const raw = useRef(loaded.raw);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function publish(next: ReviewSession) {
    latest.current = next;
    setSession(next);
  }
  function clearTimer() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  function persist(next: ReviewSession) {
    clearTimer();
    try {
      raw.current = repository.save(exam, next, raw.current);
      publish(next);
      setError(null);
      setSaving(false);
      return true;
    } catch (error) {
      setError(`Não foi possível salvar a sessão. ${error instanceof Error ? error.message : ''}`);
      setSaving(false);
      return false;
    }
  }
  useEffect(() => {
    // Session navigation lives in the URL so reloading it does not require a storage write.
    const params = new URLSearchParams(window.location.search);
    const position = latest.current
      ? params.has('reviewResume')
        ? reviewResumePosition(latest.current, window.location.search)
        : Number(params.get('reviewPosition') ?? latest.current.currentIndex)
      : -1;
    if (latest.current && position >= 0)
      publish(transitionReviewSession(exam, latest.current, { type: 'navigate', index: position }));
    function flush() {
      if (timer.current !== null && latest.current) {
        clearTimer();
        try {
          raw.current = repository.save(exam, latest.current, raw.current);
        } catch (error) {
          setError(`Falha ao salvar a resposta: ${error instanceof Error ? error.message : ''}`);
        }
      }
    }
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [exam]);
  function dispatch(action: ReviewSessionAction) {
    if (!latest.current) return;
    const next = transitionReviewSession(exam, latest.current, action);
    if (next === latest.current) return;
    if (action.type === 'navigate') {
      publish(next);
      rememberReviewPosition(next);
      return;
    }
    if (
      action.type === 'answer' &&
      exam.questions.find((q) => q.id === action.questionId)?.type === 'essay'
    ) {
      clearTimer();
      publish(next);
      setSaving(true);
      timer.current = setTimeout(() => persist(latest.current!), 500);
    } else persist(next);
  }
  function toggleFlag(questionId: string) {
    if (!sourceRef.current) {
      setError(
        'A tentativa fonte não está disponível. A marcação original não pôde ser atualizada; você pode continuar respondendo.',
      );
      return;
    }
    try {
      const next = reviews.toggleFlag(exam, sourceRef.current, questionId);
      sourceRef.current = next;
      setSource(next);
      setError(null);
    } catch (error) {
      setError(
        `Não foi possível atualizar a marcação original. ${error instanceof Error ? error.message : ''}`,
      );
    }
  }
  function discard() {
    if (!raw.current) return false;
    try {
      repository.discard(exam, raw.current);
      clearTimer();
      raw.current = null;
      latest.current = null;
      setSession(null);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível descartar.');
      return false;
    }
  }
  return { session, error, saving, source, dispatch, toggleFlag, discard };
}
