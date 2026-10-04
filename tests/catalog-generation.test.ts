import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readExamCatalog } from '../scripts/catalog';
import { poc } from './fixtures';
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'medsim-catalog-'));
  await writeFile(join(directory, `${poc.id}.json`), JSON.stringify(poc));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
it('adicionar um JSON válido basta para entrar no catálogo, sem tocar na homepage', async () => {
  expect((await readExamCatalog(directory)).catalog.exams).toHaveLength(1);
  const second = { ...poc, id: 'prova-fixture' };
  await writeFile(join(directory, 'prova-fixture.json'), JSON.stringify(second));
  const { catalog } = await readExamCatalog(directory);
  expect(catalog.exams.map((exam) => exam.id)).toEqual([poc.id, second.id]);
  expect(catalog.exams[0]).toMatchObject({ questionCount: 30, objectiveCount: 20, essayCount: 10 });
});
it('rejeita IDs duplicados entre arquivos e nomes divergentes', async () => {
  await writeFile(join(directory, 'zzz.json'), JSON.stringify(poc));
  await expect(readExamCatalog(directory)).rejects.toThrow(/zzz.json.*ID de prova duplicado/);
  await rm(join(directory, 'zzz.json'));
  await rm(join(directory, `${poc.id}.json`));
  await writeFile(join(directory, 'outro.json'), JSON.stringify(poc));
  await expect(readExamCatalog(directory)).rejects.toThrow(/Nome do arquivo/);
});
it('indica arquivo, questão e campo para imagem ausente; aceita arquivo existente', async () => {
  const exam = structuredClone(poc);
  exam.questions[0]!.images = [{ src: 'media/figura.png', alt: 'Figura de teste' }];
  await writeFile(join(directory, `${poc.id}.json`), JSON.stringify(exam));
  await expect(readExamCatalog(directory, directory)).rejects.toThrow(
    /questão objetivas-001 → images.src → Arquivo ausente/,
  );
  await mkdir(join(directory, 'media'));
  await writeFile(join(directory, 'media/figura.png'), new Uint8Array());
  expect((await readExamCatalog(directory, directory)).catalog.exams).toHaveLength(1);
});
it('impede build com JSON malformado', async () => {
  await writeFile(join(directory, `${poc.id}.json`), '{');
  await expect(readExamCatalog(directory)).rejects.toThrow(/json → prova → JSON/);
});
