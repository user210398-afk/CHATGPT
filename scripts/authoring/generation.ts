import assert from 'node:assert/strict';
import { link, lstat, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  exportManifestSchema,
  generationJsonSchema,
  generationRequestSchema,
  providerMetadataSchema,
  promptVersion,
} from '../../schema/generation';
import {
  assertAvailable,
  digest,
  GenerationError,
  json,
  readJson,
  readSource,
  withGenerationLock,
  writeArtifacts,
  writeExport,
} from './generation-files';
import { buildOpenAIRequest, buildPrompt, mockOutput, openAIOutput } from './generation-providers';
import { mapGeneration } from './generation-mapper';
import { validateGenerationRecord } from './generation-integrity';

const optionsSchema = z.strictObject({
  file: z.string().min(1),
  config: z.string().min(1),
  provider: z.enum(['export', 'mock', 'openai']).default('export'),
  model: providerMetadataSchema.shape.model.optional(),
  detail: z.enum(['low', 'high', 'auto']).default('low'),
  confirm: z.string().optional(),
  dryRun: z.boolean().default(false),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(30 * 60 * 1000)
    .default(5 * 60 * 1000),
});
export type GenerateOptions = z.input<typeof optionsSchema>;
export interface GenerationDependencies {
  fetcher?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  publish?: typeof link;
}
export async function generate(
  root: string,
  input: GenerateOptions,
  dependencies: GenerationDependencies = {},
) {
  const options = optionsSchema.parse(input);
  const request = generationRequestSchema.parse(await readJson(options.config));
  const local = await readSource(options.file);
  const provider = providerMetadataSchema.parse({
    name: options.provider,
    model:
      options.provider === 'mock'
        ? 'mock-v1'
        : options.provider === 'export'
          ? (options.model ?? 'external-manual')
          : (options.model ?? 'gpt-5.6-luna'),
    promptVersion,
    detail: local.extension === '.pdf' ? options.detail : null,
  });
  await assertAvailable(root, request.examId, provider.name === 'export');
  const destination =
    provider.name === 'export'
      ? `authoring/exports/${request.examId}/`
      : [
          `authoring/candidates/${request.examId}.json`,
          `authoring/reviews/${request.examId}.json`,
          `authoring/generations/${request.examId}.json`,
        ];
  const safe = {
    ...local.source,
    provider: provider.name,
    model: provider.model,
    detail: provider.detail,
    examId: request.examId,
    counts: { objective: request.objectiveCount, essay: request.essayCount },
    destination,
  };
  if (options.dryRun) {
    dependencies.log?.(json(safe));
    return { kind: 'dry-run' as const, metadata: safe };
  }
  // No request construction or external transport until both checks succeed.
  const env = dependencies.env ?? process.env;
  if (provider.name === 'openai') {
    if (options.confirm !== 'ENVIAR')
      throw new GenerationError(
        'Envio externo exige confirmação literal --confirm ENVIAR; nenhum byte foi enviado',
      );
    if (!env.OPENAI_API_KEY?.trim())
      throw new GenerationError(
        'OPENAI_API_KEY ausente: configure somente por variável de ambiente',
      );
    if (env.CI) throw new GenerationError('Geração OpenAI não é permitida em CI');
  }
  const prompt = await buildPrompt(request);
  return withGenerationLock(root, request.examId, async () => {
    await assertAvailable(root, request.examId, provider.name === 'export');
    if (provider.name === 'export') {
      const schema = json(generationJsonSchema());
      const unsigned = {
        exportVersion: 1 as const,
        source: local.source,
        request,
        provider: { ...provider, name: 'export' as const },
        promptSha256: digest(prompt),
        schemaSha256: digest(schema),
        createdAt: new Date().toISOString(),
      };
      const manifest = exportManifestSchema.parse({
        ...unsigned,
        integritySha256: digest(json(unsigned)),
      });
      await writeExport(root, request.examId, {
        'export-manifest.json': json(manifest),
        'prompt.md': prompt,
        'schema.json': schema,
      });
      return { kind: 'export' as const, manifest };
    }
    let result;
    if (provider.name === 'mock')
      result = { output: mockOutput(request), response: { id: null, usage: null } };
    else {
      dependencies.log?.(`Este comando enviará ${local.source.fileName} ao provider externo.`);
      result = await openAIOutput(
        buildOpenAIRequest(prompt, local.source, local.bytes, local.extension, provider),
        env.OPENAI_API_KEY!,
        options.timeoutMs,
        dependencies.fetcher,
      );
    }
    const artifacts = mapGeneration(
      result!.output,
      request,
      local.source,
      provider,
      result!.response,
    );
    validateGenerationRecord(artifacts.record, artifacts.exam, artifacts.review);
    await assertAvailable(root, request.examId);
    await writeArtifacts(root, request.examId, artifacts, dependencies.publish);
    return { kind: 'generation' as const, artifacts };
  });
}

// Shared read-only export contract, also used by the workflow status command.
export async function validateExport(file: string) {
  const manifest = exportManifestSchema.parse(await readJson(file));
  const { integritySha256, ...unsigned } = manifest;
  assert.equal(digest(json(unsigned)), integritySha256, 'Export manifest integrity inválida');
  const directory = dirname(file);
  for (const name of ['prompt.md', 'schema.json'])
    assert.ok((await lstat(join(directory, name))).isFile(), 'Export exige arquivos regulares');
  const prompt = await readFile(join(directory, 'prompt.md'), 'utf8');
  const schema = await readFile(join(directory, 'schema.json'), 'utf8');
  assert.equal(digest(prompt), manifest.promptSha256, 'Export prompt hash divergente');
  assert.equal(digest(schema), manifest.schemaSha256, 'Export schema hash divergente');
  assert.equal(
    prompt,
    await buildPrompt(manifest.request),
    'Export prompt/config incompatível com versão atual',
  );
  assert.equal(schema, json(generationJsonSchema()), 'Export schema incompatível com versão atual');
  return manifest;
}

// Re-read the original source locally: import never trusts a caller-supplied hash.
export async function importGeneration(
  root: string,
  input: { result: string; export: string; file: string },
  dependencies: Pick<GenerationDependencies, 'publish'> = {},
) {
  const manifest = await validateExport(input.export);
  const local = await readSource(input.file);
  assert.ok(
    isDeepStrictEqual(local.source, manifest.source),
    'Fonte/config/hash do export divergentes',
  );
  const id = manifest.request.examId;
  await assertAvailable(root, id);
  const artifacts = mapGeneration(
    await readJson(input.result),
    manifest.request,
    local.source,
    manifest.provider,
    { id: null, usage: null },
  );
  validateGenerationRecord(artifacts.record, artifacts.exam, artifacts.review);
  return withGenerationLock(root, id, async () => {
    await assertAvailable(root, id);
    await writeArtifacts(root, id, artifacts, dependencies.publish);
    return artifacts;
  });
}

export function safeGenerationError(error: unknown, key?: string) {
  // Zod issues may contain attacker-controlled text; return only a bounded generic message.
  if (error instanceof z.ZodError)
    return 'Configuração, structured output ou metadata inválidos; nenhum candidate foi gravado. Nenhuma segunda chamada foi feita (zero retry).';
  if (error instanceof GenerationError || error instanceof assert.AssertionError) {
    const message = error.message.includes('zero retry')
      ? error.message
      : `${error.message}. Nenhuma segunda chamada foi feita (zero retry).`;
    return key ? message.split(key).join('[REDACTED]') : message;
  }
  return 'Geração falhou; nenhum candidate parcial foi mantido. Não houve retry automático';
}
