import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { validateAll, promote } from './core';
import { contentGate } from './gate';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      id: { type: 'string' },
      confirm: { type: 'string' },
      file: { type: 'string' },
      base: { type: 'string' },
    },
  });
  if (positionals.length !== 1) throw new Error('Informe exatamente um comando');
  const command = positionals[0];
  const allowed: Record<string, string[]> = {
    hash: ['file'],
    validate: ['id'],
    promote: ['id', 'confirm'],
    gate: ['base'],
  };
  if (!command || !allowed[command]) throw new Error('Comando desconhecido');
  for (const key of Object.keys(values))
    if (!allowed[command]!.includes(key)) throw new Error(`Argumento inválido: --${key}`);
  if (command === 'hash') {
    if (!values.file) throw new Error('Use --file <arquivo local>');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(values.file)) hash.update(chunk);
    console.log(`File: ${basename(values.file)}\nSHA-256: ${hash.digest('hex')}`);
  } else if (command === 'validate') {
    console.log(`Authoring OK: ${await validateAll('.', values.id)} candidate(s) reais.`);
  } else if (command === 'promote') {
    if (!values.id) throw new Error('Use --id <exam-id>');
    console.log(
      `Promovido localmente: ${await promote('.', values.id, values.confirm)}. Execute build/testes e abra um PR para revisão humana.`,
    );
  } else {
    if (!values.base) throw new Error('Use --base <SHA completo do base do PR>');
    console.log(
      `Content Gate OK: ${await contentGate('.', values.base)} adição(ões); baseline intacto.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
