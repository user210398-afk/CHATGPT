import { z } from 'zod';
import { identifier } from './exam';
export const catalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  exams: z.array(
    z.strictObject({
      id: identifier,
      revision: z.number().int().positive(),
      title: z.string().min(1),
      subject: z.string().min(1),
      year: z.number().int().nullable(),
      division: z.string(),
      description: z.string(),
      tags: z.array(z.string()),
      questionCount: z.number().int().positive(),
      objectiveCount: z.number().int().nonnegative(),
      essayCount: z.number().int().nonnegative(),
    }),
  ),
});
export type Catalog = z.infer<typeof catalogSchema>;
