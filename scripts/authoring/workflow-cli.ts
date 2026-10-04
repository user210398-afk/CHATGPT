import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { GenerationError } from './generation-files';
import {
  approveWorkflow,
  importWorkflow,
  initWorkflow,
  promoteWorkflow,
  workflowStatus,
} from './workflow';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: 'string' },
      id: { type: 'string' },
      subject: { type: 'string' },
      title: { type: 'string' },
      division: { type: 'string' },
      year: { type: 'string' },
      language: { type: 'string' },
      objective: { type: 'string' },
      essay: { type: 'string' },
      options: { type: 'string' },
      difficulty: { type: 'string' },
      focus: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      'allow-external-knowledge': { type: 'boolean' },
      result: { type: 'string' },
      'reviewed-by': { type: 'string' },
      confirm: { type: 'string' },
    },
  });
  const allowed: Record<string, string[]> = {
    init: [
      'file',
      'id',
      'subject',
      'title',
      'division',
      'year',
      'language',
      'objective',
      'essay',
      'options',
      'difficulty',
      'focus',
      'exclude',
      'allow-external-knowledge',
    ],
    status: ['id'],
    import: ['id', 'file', 'result'],
    approve: ['id', 'reviewed-by', 'confirm'],
    promote: ['id', 'confirm'],
  };
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    !command ||
    !Object.hasOwn(allowed, command) ||
    Object.keys(values).some((key) => !allowed[command]!.includes(key))
  )
    throw new GenerationError('Use init, status, import, approve ou promote com seus argumentos');
  if (!values.id) throw new GenerationError('--id obrigatório');
  const id = values.id;
  if (command === 'init') {
    if (!values.file || !values.subject || !values.title || !values.division)
      throw new GenerationError('Init exige --file, --id, --subject, --title e --division');
    const result = await initWorkflow('.', {
      file: values.file,
      id,
      subject: values.subject,
      title: values.title,
      division: values.division,
      year: values.year,
      language: values.language,
      objective: values.objective,
      essay: values.essay,
      options: values.options,
      difficulty: values.difficulty,
      focus: values.focus,
      exclude: values.exclude,
      allowExternalKnowledge: values['allow-external-knowledge'],
    });
    console.log(
      `ID: ${id}\nFonte: ${result.manifest.source.fileName}\nSHA-256: ${result.manifest.source.sha256}`,
    );
    console.log(
      `Counts: ${result.request.objectiveCount} objetivas, ${result.request.essayCount} dissertativas; ${result.request.optionsPerObjective} alternativas`,
    );
    console.log(`Difficulty: ${JSON.stringify(result.request.difficulty)}`);
    console.log(
      `Criados: .authoring-work/${id}/request.json; authoring/exports/${id}/{export-manifest.json,prompt.md,schema.json}`,
    );
    console.log(
      'Próxima etapa: ler fonte e contrato export; salvar result.json e executar author:flow import.',
    );
  } else if (command === 'status') {
    console.log(JSON.stringify(await workflowStatus('.', id), null, 2));
  } else if (command === 'import') {
    if (!values.file || !values.result) throw new GenerationError('Import exige --file e --result');
    await importWorkflow('.', { id, file: values.file, result: values.result });
    console.log('Candidate criado. Revisão humana obrigatória.');
  } else if (command === 'approve') {
    if (!values['reviewed-by']) throw new GenerationError('Approve exige --reviewed-by');
    await approveWorkflow('.', { id, reviewedBy: values['reviewed-by'], confirm: values.confirm });
    console.log('Aprovação explícita registrada; candidate aguarda promoção confirmada.');
  } else {
    const path = await promoteWorkflow('.', { id, confirm: values.confirm });
    console.log(`Promovido: ${path}`);
  }
} catch (error) {
  // Never inspect environment keys, echo raw arguments or dump untrusted JSON/Zod issues.
  console.error(
    error instanceof z.ZodError
      ? 'Parâmetros ou artefatos inválidos; confira o contrato de authoring.'
      : error instanceof GenerationError || error instanceof assert.AssertionError
        ? error.message.split('\n')[0]
        : 'Workflow falhou; confira arquivos, integridade e colisões antes de repetir.',
  );
  process.exitCode = 1;
}
