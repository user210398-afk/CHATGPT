import { useRef, useState } from 'react';
import type { Exam } from '../types/exam';
import {
  readScratch,
  saveScratch,
  scratchOptions,
  type SolverScope,
} from '../engine/solver-scratch';
export function useSolverScratch(
  exam: Exam,
  scope: SolverScope,
  questionId: string,
  answers: Record<string, string>,
) {
  const [snapshot, setSnapshot] = useState(() => readScratch(exam, scope));
  const latest = useRef(snapshot);
  function setEliminated(optionId: string, eliminated: boolean) {
    try {
      latest.current = saveScratch(
        exam,
        scope,
        latest.current,
        questionId,
        optionId,
        eliminated,
        answers,
      );
    } catch (error) {
      latest.current = {
        ...latest.current,
        warning: error instanceof Error ? error.message : 'Não foi possível salvar a eliminação.',
      };
    }
    setSnapshot(latest.current);
  }
  return {
    eliminated: scratchOptions(snapshot.value, questionId).filter(
      (id) => id !== answers[questionId],
    ),
    warning: snapshot.warning,
    setEliminated,
  };
}
