import { z } from 'zod';
import { identifier } from '../../schema/exam';
import type { Exam } from '../types/exam';
import { storageKey, type StorageAdapter } from './persistence';
import { writeTransaction } from './storage-transaction';
export interface SolverScope {
  kind: 'attempt' | 'review-session';
  id: string;
}
export const scratchSchema = z.strictObject({
  storageVersion: z.literal(1),
  kind: z.enum(['attempt', 'review-session']),
  scopeId: z.string().min(1).max(256),
  examId: identifier,
  examRevision: z.number().int().positive(),
  questions: z.record(
    identifier,
    z
      .array(identifier)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
  ),
});
export type SolverScratch = z.infer<typeof scratchSchema>;
export function scratchOptions(value: SolverScratch, questionId: string): string[] {
  return Object.hasOwn(value.questions, questionId) ? value.questions[questionId]! : [];
}
export const MAX_SCRATCH_RAW_LENGTH = 200_000;
export const scratchStorageKey = (exam: Exam, scope: SolverScope) =>
  `${storageKey(exam)}:solver-scratch:${scope.kind}:${encodeURIComponent(scope.id)}`;
export function emptyScratch(exam: Exam, scope: SolverScope): SolverScratch {
  return {
    storageVersion: 1,
    kind: scope.kind,
    scopeId: scope.id,
    examId: exam.id,
    examRevision: exam.revision,
    questions: {},
  };
}
export function parseScratch(exam: Exam, scope: SolverScope, raw: string | null): SolverScratch {
  if (raw === null) return scratchSchema.parse(emptyScratch(exam, scope));
  if (raw.length > MAX_SCRATCH_RAW_LENGTH) throw new Error('Scratch acima do limite.');
  const value = scratchSchema.parse(JSON.parse(raw));
  if (
    value.examId !== exam.id ||
    value.examRevision !== exam.revision ||
    value.kind !== scope.kind ||
    value.scopeId !== scope.id
  )
    throw new Error('Scope incompatível.');
  for (const [id, options] of Object.entries(value.questions)) {
    const q = exam.questions.find((q) => q.id === id);
    if (
      !q ||
      q.type !== 'multiple-choice' ||
      options.some((id) => !q.options.some((o) => o.id === id))
    )
      throw new Error('Alternativa inexistente.');
  }
  return value;
}
export function readScratch(
  exam: Exam,
  scope: SolverScope,
  storage: () => Pick<StorageAdapter, 'getItem'> = () => window.sessionStorage,
) {
  try {
    const raw = storage().getItem(scratchStorageKey(exam, scope));
    return {
      value: parseScratch(exam, scope, raw),
      raw,
      blocked: false,
      warning: null as string | null,
    };
  } catch {
    return {
      value: emptyScratch(exam, scope),
      raw: null,
      blocked: true,
      warning:
        'Eliminações indisponíveis. O registro foi preservado; suas respostas continuam funcionando.',
    };
  }
}
export function saveScratch(
  exam: Exam,
  scope: SolverScope,
  snapshot: ReturnType<typeof readScratch>,
  questionId: string,
  optionId: string,
  eliminated: boolean,
  answers: Record<string, string>,
  storage: () => StorageAdapter = () => window.sessionStorage,
) {
  if (snapshot.blocked) throw new Error('Eliminações bloqueadas por armazenamento incompatível.');
  if (eliminated && answers[questionId] === optionId)
    throw new Error('Selecione outra alternativa antes de eliminar esta.');
  const questions = Object.fromEntries(
    Object.entries(snapshot.value.questions).map(([id, options]) => [
      id,
      options.filter((o) => answers[id] !== o),
    ]),
  );
  const current = Object.hasOwn(questions, questionId) ? questions[questionId]! : [];
  questions[questionId] = eliminated
    ? [...new Set([...current, optionId])]
    : current.filter((o) => o !== optionId);
  for (const [id, options] of Object.entries(questions)) if (!options.length) delete questions[id];
  const raw = JSON.stringify({ ...snapshot.value, questions });
  const value = parseScratch(exam, scope, raw);
  const key = scratchStorageKey(exam, scope);
  writeTransaction(storage(), new Map([[key, snapshot.raw]]), [
    { key, before: snapshot.raw, after: raw },
  ]);
  return { value, raw, blocked: false, warning: null };
}
