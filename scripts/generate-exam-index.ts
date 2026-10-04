import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { examStructure } from '../schema/exam';
import { readExamCatalog } from './catalog';

const { exams, catalog } = await readExamCatalog();
if (!process.argv.includes('--check')) {
  await rm('public/generated', { recursive: true, force: true });
  await mkdir('public/generated/exams', { recursive: true });
  for (const exam of exams)
    await writeFile(`public/generated/exams/${exam.id}.json`, JSON.stringify(exam));
  await writeFile('public/generated/exam-index.json', JSON.stringify(catalog));
  await writeFile(
    'schema/exam.schema.json',
    JSON.stringify(z.toJSONSchema(examStructure), null, 2) + '\n',
  );
  // Cópia transitória para comparação, independente do runtime da aplicação nova.
  await rm('public/legacy', { recursive: true, force: true });
  await mkdir('public/legacy', { recursive: true });
  for (const file of [
    'index.html',
    'simulados.json',
    'simulados',
    'desempenho-estatisticas.js',
    'ajustes-voltar-hub-v5.js',
    'branding-medsim.js',
    'backup-medsim.js',
    'grifar-borracha.js',
  ])
    await cp(file, `public/legacy/${file}`, { recursive: true });
}
console.log(
  `Validação OK: ${exams.length} prova(s), ${exams.reduce((sum, exam) => sum + exam.questions.length, 0)} questões. Catálogo automático ${process.argv.includes('--check') ? 'validado' : 'gerado'}.`,
);
