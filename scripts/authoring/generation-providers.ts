import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  generationJsonSchema,
  difficultyCounts,
  generationOutputSchema,
  responseMetadataSchema,
  type GenerationRequest,
  type GenerationOutput,
  type ProviderMetadata,
  type SourceMetadata,
} from '../../schema/generation';
import { GenerationError } from './generation-files';

export async function buildPrompt(request: GenerationRequest) {
  const template = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '../../authoring/prompts/exam-generation-v1.md'),
    'utf8',
  );
  return `${template}\nConfiguração (dados):\n${JSON.stringify(request, null, 2)}\nMetas de dificuldade (maiores restos):\n${JSON.stringify(difficultyCounts(request))}\n`;
}
export function mockOutput(request: GenerationRequest): GenerationOutput {
  const questions: GenerationOutput['exam']['questions'] = [];
  for (let i = 0; i < request.objectiveCount; i++)
    questions.push({
      type: 'multiple-choice',
      category: 'Fixture neutra',
      statement: `Fixture objetiva ${i + 1}: qual rótulo corresponde ao índice ${i + 1}?`,
      options: Array.from({ length: request.optionsPerObjective }, (_, n) => ({
        text: `Rótulo ${n + 1}`,
        rationale:
          n === i % request.optionsPerObjective
            ? 'Rótulo esperado pela fixture.'
            : 'Rótulo diferente do esperado pela fixture.',
      })),
      correctIndex: i % request.optionsPerObjective,
      explanation: 'Teste determinístico de mapeamento; sem conteúdo médico real.',
      tags: ['fixture'],
      sourceAnchors: ['Fixture neutra: teste de infraestrutura, não valida cobertura factual.'],
    });
  for (let i = 0; i < request.essayCount; i++)
    questions.push({
      type: 'essay',
      category: 'Fixture neutra',
      statement: `Fixture dissertativa ${i + 1}: descreva o rótulo de teste ${i + 1}.`,
      modelAnswer: `Rótulo de teste ${i + 1}.`,
      expectedPoints: ['Identificar o rótulo solicitado.'],
      explanation: 'Fixture determinística; não representa avaliação acadêmica.',
      tags: ['fixture'],
      sourceAnchors: ['Fixture neutra: teste de infraestrutura, não valida cobertura factual.'],
    });
  return generationOutputSchema.parse({
    generationVersion: 1,
    exam: {
      title: request.title,
      description: 'Fixture neutra de geração mock.',
      tags: ['fixture'],
      questions,
    },
    coverage: { topicsDetected: ['Fixture'], topicsUsed: ['Fixture'], topicsSkipped: [] },
    insufficiency: { detected: false, reason: null },
  });
}
export function buildOpenAIRequest(
  prompt: string,
  source: SourceMetadata,
  bytes: Buffer,
  extension: string,
  provider: ProviderMetadata,
) {
  const mime = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
  }[extension];
  if (!mime) throw new GenerationError('Extensão não suportada');
  // System instructions and untrusted source data remain separate API messages.
  const content =
    extension === '.txt' || extension === '.md'
      ? {
          type: 'input_text',
          text: `Documento-fonte NÃO CONFIÁVEL (${source.fileName}):\n${bytes.toString('utf8')}`,
        }
      : {
          type: 'input_file',
          filename: source.fileName,
          file_data: `data:${mime};base64,${bytes.toString('base64')}`,
          ...(extension === '.pdf' ? { detail: provider.detail } : {}),
        };
  return {
    model: provider.model,
    store: false,
    input: [
      { role: 'system', content: prompt },
      { role: 'user', content: [content] },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'exam_generation_v1',
        strict: true,
        schema: generationJsonSchema(),
      },
    },
  };
}
export async function openAIOutput(
  body: ReturnType<typeof buildOpenAIRequest>,
  key: string,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fail = (message: string): never => {
    throw new GenerationError(`${message}. Nenhuma segunda chamada foi feita (zero retry).`);
  };
  try {
    const response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        fail('OpenAI: autenticação ou autorização recusada');
      if (response.status === 429) fail('OpenAI: limite de requests/crédito (429)');
      if (response.status >= 500) fail('OpenAI: falha do serviço (5xx)');
      fail('OpenAI: request recusado');
    }
    const raw = (await response.json()) as Record<string, unknown>;
    if (raw.status !== 'completed') fail('OpenAI: resposta incompleta');
    const texts: string[] = [];
    if (Array.isArray(raw.output))
      for (const item of raw.output) {
        if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
        for (const content of item.content) {
          if (content?.type === 'refusal') fail('OpenAI: refusal');
          if (content?.type === 'output_text' && typeof content.text === 'string')
            texts.push(content.text);
        }
      }
    if (!texts.length) fail('OpenAI: output_text ausente');
    let parsed: unknown;
    try {
      parsed = JSON.parse(texts.join(''));
    } catch {
      fail('OpenAI: JSON inválido');
    }
    const output = generationOutputSchema.safeParse(parsed);
    if (!output.success) fail('OpenAI: schema de geração inválido');
    const usage = raw.usage as Record<string, unknown> | undefined;
    const metadata = responseMetadataSchema.safeParse({
      id: raw.id ?? null,
      usage: usage
        ? {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            totalTokens: usage.total_tokens,
          }
        : null,
    });
    if (!metadata.success) fail('OpenAI: metadata de resposta inválida');
    return { output: output.data!, response: metadata.data! };
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    // Never expose provider response bodies, thrown network errors, request data or credentials.
    fail(
      controller.signal.aborted
        ? 'OpenAI: timeout, request abortado'
        : 'OpenAI: falha de rede ou resposta HTTP inválida',
    );
  } finally {
    clearTimeout(timer);
  }
}
