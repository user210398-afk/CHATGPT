import type { z } from 'zod';
import type { examSchema, questionSchema } from '../../schema/exam';
export type { RichNode, RichText } from '../../schema/exam';
export type Exam = z.infer<typeof examSchema>;
export type Question = z.infer<typeof questionSchema>;
export type MultipleChoice = Extract<Question, { type: 'multiple-choice' }>;
export type Essay = Extract<Question, { type: 'essay' }>;
