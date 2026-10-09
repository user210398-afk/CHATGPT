import { z } from 'zod';
import { identifier } from './exam';
const text = z.string().trim().min(1);
export const reviewSchema = z
  .strictObject({
    authoringVersion: z.literal(1),
    examId: identifier,
    status: z.enum(['draft', 'in-review', 'approved']),
    source: z.strictObject({
      fileName: text.refine(
        (name) => !/[\\/]/.test(name) && name !== '.' && name !== '..',
        'Use somente basename',
      ),
      sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    }),
    generation: z.strictObject({
      mode: z.enum(['manual', 'ai-assisted']),
      provider: text.nullable(),
      model: text.nullable(),
      promptVersion: text.nullable(),
    }),
    requirements: z.strictObject({
      objectiveCount: z.number().int().nonnegative(),
      essayCount: z.number().int().nonnegative(),
      optionsPerObjective: z.union([z.literal(4), z.literal(5), z.null()]),
    }),
    checks: z.strictObject({
      sourceCoverageReviewed: z.boolean(),
      answerKeyReviewed: z.boolean(),
      explanationsReviewed: z.boolean(),
      duplicateCheckReviewed: z.boolean(),
    }),
    approval: z.strictObject({ candidateSha256: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
    reviewedBy: text.nullable(),
    notes: z.array(text),
  })
  .superRefine((review, ctx) => {
    const error = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (review.requirements.objectiveCount > 0 && review.requirements.optionsPerObjective === null)
      error(['requirements', 'optionsPerObjective'], 'Objetivas exigem 4 ou 5 alternativas');
    if (review.status !== 'approved' && review.approval !== undefined)
      error(
        ['approval'],
        'Vínculo de aprovação exige status approved; remova ao invalidar o review',
      );
    // Missing bindings are checked against the pinned historical evidence by authoring validators.
    if (review.status === 'approved') {
      for (const [check, done] of Object.entries(review.checks))
        if (!done) error(['checks', check], 'Aprovação exige checklist completo');
      if (!review.reviewedBy) error(['reviewedBy'], 'Aprovação exige revisão humana identificada');
      if (review.generation.mode === 'ai-assisted')
        for (const field of ['provider', 'model', 'promptVersion'] as const)
          if (!review.generation[field])
            error(['generation', field], 'Aprovação assistida exige metadata de geração');
    }
  });
export type Review = z.infer<typeof reviewSchema>;
