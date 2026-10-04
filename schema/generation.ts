import { z } from 'zod';
import { identifier } from './exam';
import { reviewSchema } from './authoring';

// Academic content is plain text only; no model-supplied markup or remote URLs.
const text = z.string().trim().min(1).max(20000).refine(
  (value) => !/<\/?[a-z][^>]*>|(?:https?:\/\/|javascript:)|\bon\w+\s*=/i.test(value),
  'Use texto simples, sem HTML, handlers ou URLs externas',
);
const topics = z.array(text).max(100);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const providerName = z.enum(['export', 'mock', 'openai']);
export const pdfDetail = z.enum(['low', 'high', 'auto']);
export const promptVersion = 'exam-generation-v1' as const;
export const generationRequestSchema = z.strictObject({
  examId: identifier.max(120),
  subject: text,
  year: z.number().int().min(1900).max(2200).nullable(),
  division: text,
  title: text,
  language: z.enum(['pt-BR', 'pt-PT', 'en', 'es']).default('pt-BR'),
  objectiveCount: z.number().int().min(0).max(60),
  essayCount: z.number().int().min(0).max(60),
  optionsPerObjective: z.union([z.literal(4), z.literal(5)]),
  difficulty: z.strictObject({
    easy: z.number().min(0).max(1),
    medium: z.number().min(0).max(1),
    hard: z.number().min(0).max(1),
  }),
  focusTopics: topics.default([]),
  excludeTopics: topics.default([]),
  allowExternalKnowledge: z.boolean().default(false),
}).superRefine((request, ctx) => {
  const total = request.objectiveCount + request.essayCount;
  if (total < 1 || total > 60)
    ctx.addIssue({ code: 'custom', message: 'Total deve estar entre 1 e 60 questões' });
  const sum = Object.values(request.difficulty).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.001)
    ctx.addIssue({ code: 'custom', path: ['difficulty'], message: 'Difficulty deve somar 1 (tolerância 0.001)' });
});
const questionBase = {
  category: text,
  statement: text,
  explanation: text,
  tags: topics,
  sourceAnchors: z.array(text).min(1).max(20),
};
// Keep refinements outside the structure used to emit the API JSON Schema.
export const generationOutputStructure = z.strictObject({
  generationVersion: z.literal(1),
  exam: z.strictObject({
    title: text,
    description: z.string().max(20000).refine(
      (value) => !/<\/?[a-z][^>]*>|https?:\/\/|javascript:/i.test(value),
      'Descrição deve ser texto simples',
    ),
    tags: topics,
    questions: z.array(z.discriminatedUnion('type', [
      z.strictObject({
        ...questionBase,
        type: z.literal('multiple-choice'),
        options: z.array(z.strictObject({ text, rationale: text })).min(4).max(5),
        correctIndex: z.number().int().min(0).max(4),
      }),
      z.strictObject({
        ...questionBase,
        type: z.literal('essay'),
        modelAnswer: text,
        expectedPoints: z.array(text).min(1).max(20),
      }),
    ])).max(60),
  }),
  coverage: z.strictObject({ topicsDetected: topics, topicsUsed: topics, topicsSkipped: topics }),
  insufficiency: z.strictObject({ detected: z.boolean(), reason: text.nullable() }),
});
export const generationOutputSchema = generationOutputStructure.superRefine((output, ctx) => {
  if (output.insufficiency.detected !== (output.insufficiency.reason !== null))
    ctx.addIssue({ code: 'custom', path: ['insufficiency'], message: 'Insufficiency exige motivo somente quando detectada' });
  output.exam.questions.forEach((question, index) => {
    if (question.type === 'multiple-choice' && question.correctIndex >= question.options.length)
      ctx.addIssue({ code: 'custom', path: ['exam', 'questions', index, 'correctIndex'], message: 'correctIndex fora das alternativas' });
  });
});
export function generationJsonSchema() {
  const schema = z.toJSONSchema(generationOutputStructure, { target: 'draft-7' });
  delete schema.$schema;
  return schema;
}
export const sourceMetadataSchema = reviewSchema.shape.source.extend({
  sha256,
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
});
export const providerMetadataSchema = z.strictObject({
  name: providerName,
  model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/),
  promptVersion: z.literal(promptVersion),
  detail: pdfDetail.nullable(),
});
export const responseMetadataSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).nullable(),
  usage: z.strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }).nullable(),
});
export const generationRecordSchema = z.strictObject({
  generationVersion: z.literal(1),
  examId: identifier,
  source: sourceMetadataSchema,
  request: generationRequestSchema,
  provider: providerMetadataSchema,
  response: responseMetadataSchema,
  coverage: generationOutputStructure.shape.coverage,
  insufficiency: generationOutputStructure.shape.insufficiency,
  difficultyCounts: z.strictObject({
    easy: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    hard: z.number().int().nonnegative(),
  }),
  questions: z.array(z.strictObject({
    questionId: identifier,
    sourceAnchors: questionBase.sourceAnchors,
  })).min(1).max(60),
  createdAt: z.iso.datetime(),
});
export const exportManifestSchema = z.strictObject({
  exportVersion: z.literal(1),
  source: sourceMetadataSchema,
  request: generationRequestSchema,
  provider: providerMetadataSchema.extend({ name: z.literal('export') }),
  promptSha256: sha256,
  schemaSha256: sha256,
  createdAt: z.iso.datetime(),
  integritySha256: sha256,
});
export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export type GenerationOutput = z.infer<typeof generationOutputSchema>;
export type GenerationRecord = z.infer<typeof generationRecordSchema>;
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;
export type ProviderMetadata = z.infer<typeof providerMetadataSchema>;
export type ResponseMetadata = z.infer<typeof responseMetadataSchema>;

// Largest remainder; stable tie order easy → medium → hard.
export function difficultyCounts(request: GenerationRequest) {
  const total = request.objectiveCount + request.essayCount;
  const keys = ['easy', 'medium', 'hard'] as const;
  const sum = keys.reduce((value, key) => value + request.difficulty[key], 0);
  const exact = keys.map((key) => total * request.difficulty[key] / sum);
  const counts = exact.map(Math.floor);
  const order = keys.map((_, i) => i).sort((a, b) =>
    (exact[b]! - counts[b]!) - (exact[a]! - counts[a]!) || a - b);
  const remaining = total - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remaining; i++) counts[order[i]!]!++;
  return { easy: counts[0]!, medium: counts[1]!, hard: counts[2]! };
}
