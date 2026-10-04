import { parseArgs } from 'node:util';
import { generate, importGeneration, safeGenerationError } from './generation';
import { GenerationError } from './generation-files';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: 'string' },
      config: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      detail: { type: 'string' },
      confirm: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'timeout-ms': { type: 'string' },
      result: { type: 'string' },
      export: { type: 'string' },
    },
  });
  if (positionals.length !== 1) throw new GenerationError('Informe generate ou import');
  const command = positionals[0];
  const allowed =
    command === 'generate'
      ? ['file', 'config', 'provider', 'model', 'detail', 'confirm', 'dry-run', 'timeout-ms']
      : command === 'import'
        ? ['file', 'result', 'export']
        : [];
  if (!allowed.length || Object.keys(values).some((key) => !allowed.includes(key)))
    throw new GenerationError('Comando ou argumentos inválidos');
  if (command === 'generate') {
    if (!values.file || !values.config)
      throw new GenerationError('Use --file <fonte> --config <request.json>');
    const result = await generate(
      '.',
      {
        file: values.file,
        config: values.config,
        provider: values.provider as 'export' | 'mock' | 'openai' | undefined,
        model: values.model,
        detail: values.detail as 'low' | 'high' | 'auto' | undefined,
        confirm: values.confirm,
        dryRun: values['dry-run'],
        timeoutMs: values['timeout-ms'] === undefined ? undefined : Number(values['timeout-ms']),
      },
      { log: (message) => console.log(message) },
    );
    if (result.kind !== 'dry-run')
      console.log(
        result.kind === 'export'
          ? 'Export local criado; nenhum envio externo. Importe o resultado para gerar candidate draft.'
          : 'Candidate, review draft e generation record validados e gravados. Revisão humana obrigatória.',
      );
  } else {
    if (!values.file || !values.result || !values.export)
      throw new GenerationError(
        'Use --result <output.json> --export <export-manifest.json> --file <fonte original para conferir SHA-256>',
      );
    await importGeneration('.', {
      result: values.result,
      export: values.export,
      file: values.file,
    });
    console.log(
      'Resultado importado e validado; review draft gravado. Revisão humana obrigatória.',
    );
  }
} catch (error) {
  console.error(safeGenerationError(error, process.env.OPENAI_API_KEY));
  process.exitCode = 1;
}
