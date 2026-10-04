import assert from 'node:assert/strict';
import { parseExam } from '../../schema/exam';
import { reviewSchema } from '../../schema/authoring';
import {
  difficultyCounts,
  generationOutputSchema,
  generationRecordSchema,
  generationRequestSchema,
  sourceMetadataSchema,
  providerMetadataSchema,
  responseMetadataSchema,
  type GenerationRequest,
  type SourceMetadata,
  type ProviderMetadata,
  type ResponseMetadata,
} from '../../schema/generation';
import { validateCandidate } from './core';

export function mapGeneration(
  raw: unknown,
  requestInput: GenerationRequest,
  sourceInput: SourceMetadata,
  providerInput: ProviderMetadata,
  responseInput: ResponseMetadata,
  createdAt = new Date().toISOString(),
) {
  const output = generationOutputSchema.parse(raw);
  const request = generationRequestSchema.parse(requestInput);
  const source = sourceMetadataSchema.parse(sourceInput);
  const provider = providerMetadataSchema.parse(providerInput);
  const response = responseMetadataSchema.parse(responseInput);
  const objectiveCount = output.exam.questions.filter((q) => q.type === 'multiple-choice').length;
  const essayCount = output.exam.questions.length - objectiveCount;
  assert.ok(
    objectiveCount <= request.objectiveCount && essayCount <= request.essayCount,
    'Resultado excede counts solicitados',
  );
  if (objectiveCount !== request.objectiveCount || essayCount !== request.essayCount)
    assert.ok(output.insufficiency.detected, 'Quantidade menor exige insufficiency estruturada');
  assert.ok(
    output.exam.questions.length > 0,
    'Fonte insuficiente: nenhuma questão; nenhum candidate foi gravado',
  );
  let objective = 0;
  let essay = 0;
  const rich = (value: string) => [{ type: 'text' as const, text: value }];
  const questions = output.exam.questions.map((q, index) => {
    const isObjective = q.type === 'multiple-choice';
    const id = `${isObjective ? 'objetivas' : 'dissertativas'}-${String(isObjective ? ++objective : ++essay).padStart(3, '0')}`;
    const base = {
      id,
      label: `Questão ${index + 1}`,
      category: q.category,
      statement: rich(q.statement),
      explanation: rich(q.explanation),
      images: [],
      tags: q.tags,
    };
    if (q.type === 'essay')
      return {
        ...base,
        type: 'essay' as const,
        modelAnswer: rich(`${q.modelAnswer}\nPontos esperados:\n${q.expectedPoints.join('\n')}`),
      };
    assert.equal(q.options.length, request.optionsPerObjective, 'optionsPerObjective divergente');
    return {
      ...base,
      type: 'multiple-choice' as const,
      options: q.options.map((option, i) => ({ id: `option-${i + 1}`, text: rich(option.text) })),
      correctAnswer: `option-${q.correctIndex + 1}`,
      explanation: rich(
        `${q.explanation}\n${q.options.map((option, i) => `Alternativa ${i + 1}: ${option.rationale}`).join('\n')}`,
      ),
    };
  });
  const exam = parseExam({
    schemaVersion: 1,
    revision: 1,
    id: request.examId,
    title: request.title,
    subject: request.subject,
    year: request.year,
    division: request.division,
    description: output.exam.description,
    tags: output.exam.tags,
    images: [],
    settings: { questionOrder: 'fixed', feedback: 'after-finish' },
    sections: [],
    groups: [],
    provenance: {
      sourceFile: source.fileName,
      sourceSha256: source.sha256,
      notes: [
        'Candidate assistido por IA; revisão humana obrigatória de fonte, gabaritos e explicações.',
        ...(provider.name === 'mock'
          ? ['Fixture mock determinística, sem conteúdo acadêmico real.']
          : []),
        ...(request.allowExternalKnowledge
          ? ['Conhecimento externo foi permitido explicitamente.']
          : []),
        ...(output.insufficiency.reason
          ? [`Fonte insuficiente: ${output.insufficiency.reason}`]
          : []),
      ],
    },
    questions,
  });
  const review = reviewSchema.parse({
    authoringVersion: 1,
    examId: request.examId,
    status: 'draft',
    source: { fileName: source.fileName, sha256: source.sha256 },
    generation: {
      mode: 'ai-assisted',
      provider: provider.name,
      model: provider.model,
      promptVersion: provider.promptVersion,
    },
    requirements: {
      objectiveCount,
      essayCount,
      optionsPerObjective: objectiveCount ? request.optionsPerObjective : null,
    },
    checks: {
      sourceCoverageReviewed: false,
      answerKeyReviewed: false,
      explanationsReviewed: false,
      duplicateCheckReviewed: false,
    },
    reviewedBy: null,
    notes: [
      'Schema válido não garante correção acadêmica. Source anchors auxiliam revisão, sem garantia factual.',
      ...(output.insufficiency.reason
        ? [
            `Solicitado ${request.objectiveCount}/${request.essayCount}; gerado ${objectiveCount}/${essayCount}. ${output.insufficiency.reason}`,
          ]
        : []),
    ],
  });
  validateCandidate(exam, review, `${request.examId}.json`);
  const record = generationRecordSchema.parse({
    generationVersion: 1,
    examId: request.examId,
    source,
    request,
    provider,
    response,
    coverage: output.coverage,
    insufficiency: output.insufficiency,
    difficultyCounts: difficultyCounts(request),
    questions: questions.map((q, i) => ({
      questionId: q.id,
      sourceAnchors: output.exam.questions[i]!.sourceAnchors,
    })),
    createdAt,
  });
  return { exam, review, record };
}
