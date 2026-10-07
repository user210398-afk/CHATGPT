import { z } from 'zod';
import { identifier } from '../../schema/exam';
import type { Exam } from '../types/exam';
import { projectStatement, validStatementRange } from './statement-projection';
export const MAX_HIGHLIGHTS_PER_QUESTION = 200;
export const MAX_HIGHLIGHTS_PER_EXAM = 4000;
export const MAX_ANNOTATION_RAW_LENGTH = 1_000_000;
const legacyHighlightSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(128)
    .refine((id) => id.trim().length > 0),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  color: z.enum(['yellow', 'green', 'blue']),
});
export const annotationsV1Schema = z.strictObject({
  storageVersion: z.literal(1),
  examId: identifier,
  examRevision: z.number().int().positive(),
  questions: z.record(identifier, z.array(legacyHighlightSchema).max(MAX_HIGHLIGHTS_PER_QUESTION)),
});
export const highlightSchema = legacyHighlightSchema.extend({
  color: z.enum(['yellow', 'green', 'blue', 'red']),
});
export const annotationsV2Schema = annotationsV1Schema.extend({
  storageVersion: z.literal(2),
  questions: z.record(identifier, z.array(highlightSchema).max(MAX_HIGHLIGHTS_PER_QUESTION)),
});
// Validate the frozen legacy domain before normalizing in memory. Reads never serialize it.
export const annotationsSchema = z.union([
  annotationsV2Schema,
  annotationsV1Schema.transform((value) => ({ ...value, storageVersion: 2 as const })),
]);
export type Highlight = z.infer<typeof highlightSchema>;
export type Annotations = z.infer<typeof annotationsSchema>;
export function questionHighlights(value: Annotations, questionId: string): Highlight[] {
  return Object.hasOwn(value.questions, questionId) ? value.questions[questionId]! : [];
}
export type AnnotationAction =
  | { type: 'paint'; start: number; end: number; color: Highlight['color'] }
  | { type: 'erase'; start: number; end: number }
  | { type: 'remove'; id: string }
  | { type: 'clear' };
export function emptyAnnotations(exam: Exam): Annotations {
  return { storageVersion: 2, examId: exam.id, examRevision: exam.revision, questions: {} };
}
export function validateAnnotations(exam: Exam, input: unknown): Annotations {
  const value = annotationsSchema.parse(input);
  if (value.examId !== exam.id || value.examRevision !== exam.revision)
    throw new Error('Prova ou revision incompatível.');
  const ids = new Set<string>();
  let count = 0;
  for (const [id, highlights] of Object.entries(value.questions)) {
    const question = exam.questions.find((q) => q.id === id);
    if (!question) throw new Error('Questão inexistente.');
    const projection = projectStatement(question.statement);
    let previousEnd = -1;
    for (const h of highlights) {
      if (
        ids.has(h.id) ||
        !validStatementRange(projection, h.start, h.end) ||
        h.start < previousEnd
      )
        throw new Error('ID, intervalo ou overlap inválido.');
      ids.add(h.id);
      previousEnd = h.end;
      count++;
    }
  }
  if (count > MAX_HIGHLIGHTS_PER_EXAM) throw new Error('Limite de marcações por prova.');
  return value;
}
export function mutateAnnotations(
  exam: Exam,
  input: Annotations,
  questionId: string,
  action: AnnotationAction,
  idFactory: () => string = () => crypto.randomUUID(),
): Annotations {
  const value = validateAnnotations(exam, input);
  const q = exam.questions.find((q) => q.id === questionId);
  if (!q) throw new Error('Questão inexistente.');
  const old = questionHighlights(value, questionId);
  const used = new Set(
    Object.values(value.questions)
      .flat()
      .map((h) => h.id),
  );
  const nextId = () => {
    const id = idFactory();
    if (used.has(id)) throw new Error('ID duplicado na mutação.');
    used.add(id);
    return id;
  };
  let next: Highlight[];
  if (action.type === 'clear') next = [];
  else if (action.type === 'remove') next = old.filter((h) => h.id !== action.id);
  else {
    if (!validStatementRange(projectStatement(q.statement), action.start, action.end))
      throw new Error('Seleção incompatível.');
    next = old.flatMap((h): Highlight[] => {
      if (h.end <= action.start || h.start >= action.end) return [h];
      const fragments: Highlight[] = [];
      if (h.start < action.start) fragments.push({ ...h, id: nextId(), end: action.start });
      if (h.end > action.end) fragments.push({ ...h, id: nextId(), start: action.end });
      return fragments;
    });
    if (action.type === 'paint')
      next.push({ id: nextId(), start: action.start, end: action.end, color: action.color });
    next.sort((a, b) => a.start - b.start);
  }
  const questions = { ...value.questions };
  if (next.length) questions[questionId] = next;
  else delete questions[questionId];
  return validateAnnotations(exam, { ...value, questions });
}
