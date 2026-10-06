import { useEffect, useRef, useState } from 'react';
import type { Exam } from '../types/exam';
import { questionHighlights, type AnnotationAction } from '../engine/question-annotations';
import {
  annotationStorageKey,
  readAnnotations,
  saveAnnotationMutation,
} from '../engine/question-annotations-storage';
export function useQuestionAnnotations(exam: Exam, questionId: string) {
  const [snapshot, setSnapshot] = useState(() => readAnnotations(exam));
  const latest = useRef(snapshot);
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key !== annotationStorageKey(exam)) return;
      try {
        if (event.storageArea !== window.localStorage) return;
        // An old queued event must not publish a stale snapshot.
        if (window.localStorage.getItem(event.key) !== event.newValue) return;
      } catch {
        /* readAnnotations reports blocked storage */
      }
      latest.current = readAnnotations(exam, undefined, latest.current);
      setSnapshot(latest.current);
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [exam]);
  function mutate(action: AnnotationAction) {
    try {
      latest.current = saveAnnotationMutation(exam, latest.current, questionId, action);
    } catch (error) {
      latest.current = {
        ...latest.current,
        blocked: true,
        warning: error instanceof Error ? error.message : 'Não foi possível salvar a marcação.',
      };
    }
    setSnapshot(latest.current);
  }
  return {
    highlights: questionHighlights(snapshot.value, questionId),
    blocked: snapshot.blocked,
    warning: snapshot.warning,
    mutate,
  };
}
