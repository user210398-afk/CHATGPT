import type { Exam } from '../types/exam';
import { storageKey, type StorageAdapter } from './persistence';
import { writeTransaction } from './storage-transaction';
import {
  emptyAnnotations,
  validateAnnotations,
  mutateAnnotations,
  MAX_ANNOTATION_RAW_LENGTH,
  type Annotations,
  type AnnotationAction,
} from './question-annotations';
export const annotationStorageKey = (exam: Pick<Exam, 'id' | 'revision'>) =>
  `${storageKey(exam)}:annotations`;
export interface AnnotationSnapshot {
  value: Annotations;
  raw: string | null;
  blocked: boolean;
  warning: string | null;
}
export function parseAnnotationsRaw(exam: Exam, raw: string | null): Annotations {
  if (raw === null) return emptyAnnotations(exam);
  if (raw.length > MAX_ANNOTATION_RAW_LENGTH) throw new Error('Marcações acima do limite.');
  return validateAnnotations(exam, JSON.parse(raw));
}
export function readAnnotations(
  exam: Exam,
  storage: () => Pick<StorageAdapter, 'getItem'> = () => window.localStorage,
  previous?: AnnotationSnapshot,
): AnnotationSnapshot {
  let raw: string | null = null;
  try {
    raw = storage().getItem(annotationStorageKey(exam));
    return { value: parseAnnotationsRaw(exam, raw), raw, blocked: false, warning: null };
  } catch {
    return {
      value: previous?.value ?? emptyAnnotations(exam),
      raw,
      blocked: true,
      warning:
        'Marcações indisponíveis ou incompatíveis. O registro foi preservado; edição bloqueada.',
    };
  }
}
export function saveAnnotationMutation(
  exam: Exam,
  snapshot: AnnotationSnapshot,
  questionId: string,
  action: AnnotationAction,
  storage: () => StorageAdapter = () => window.localStorage,
  idFactory?: () => string,
): AnnotationSnapshot {
  if (snapshot.blocked)
    throw new Error('Edição bloqueada. Reabra a prova após resolver o armazenamento.');
  const store = storage(),
    key = annotationStorageKey(exam);
  if (store.getItem(key) !== snapshot.raw)
    throw new Error('As marcações mudaram em outra aba. Reabra a questão.');
  // Validate expected raw as well as the proposed mutation; never repair incompatible storage.
  parseAnnotationsRaw(exam, snapshot.raw);
  const value = mutateAnnotations(exam, snapshot.value, questionId, action, idFactory);
  const raw = JSON.stringify(value);
  if (raw.length > MAX_ANNOTATION_RAW_LENGTH)
    throw new Error('Limite de armazenamento das marcações.');
  writeTransaction(store, new Map([[key, snapshot.raw]]), [
    { key, before: snapshot.raw, after: raw },
  ]);
  return { value, raw, blocked: false, warning: null };
}
