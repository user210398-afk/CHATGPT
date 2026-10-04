import assert from 'node:assert/strict';
import { extname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { generationRecordSchema, difficultyCounts } from '../../schema/generation';
import { type Review } from '../../schema/authoring';
import { type parseExam } from '../../schema/exam';

export function validateGenerationRecord(
  raw: unknown,
  exam: ReturnType<typeof parseExam>,
  review: Review,
) {
  const record = generationRecordSchema.parse(raw);
  assert.equal(record.examId, exam.id, 'Generation examId divergente');
  assert.equal(record.request.examId, exam.id, 'Generation request.examId divergente');
  for (const field of ['title', 'subject', 'year', 'division'] as const)
    assert.equal(record.request[field], exam[field], `Generation request.${field} divergente`);
  assert.equal(record.source.fileName, review.source.fileName, 'Generation sourceFile divergente');
  assert.equal(record.source.sha256, review.source.sha256, 'Generation SHA-256 divergente');
  assert.equal(review.generation.mode, 'ai-assisted', 'Generation exige review ai-assisted');
  for (const key of ['model', 'promptVersion'] as const)
    assert.equal(record.provider[key], review.generation[key], `Generation ${key} divergente`);
  assert.equal(record.provider.name, review.generation.provider, 'Generation provider divergente');
  assert.deepEqual(
    record.questions.map((q) => q.questionId),
    exam.questions.map((q) => q.id),
    'Generation question IDs divergentes',
  );
  assert.ok(
    isDeepStrictEqual(record.difficultyCounts, difficultyCounts(record.request)),
    'Generation difficulty divergente',
  );
  const { objectiveCount, essayCount } = review.requirements;
  assert.ok(
    objectiveCount <= record.request.objectiveCount && essayCount <= record.request.essayCount,
    'Generation counts excedidos',
  );
  if (objectiveCount !== record.request.objectiveCount || essayCount !== record.request.essayCount)
    assert.ok(record.insufficiency.detected, 'Generation counts menores exigem insufficiency');
  assert.equal(
    record.insufficiency.detected,
    record.insufficiency.reason !== null,
    'Generation insufficiency divergente',
  );
  assert.equal(
    record.request.optionsPerObjective,
    review.requirements.optionsPerObjective ?? record.request.optionsPerObjective,
    'Generation options divergentes',
  );
  if (extname(record.source.fileName).toLowerCase() !== '.pdf')
    assert.equal(record.provider.detail, null, 'Detail aplicável somente a PDF');
  return record;
}
