import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readLegacy, pocSource } from '../scripts/legacy-data';

const objective = `{ num: 1, type: 'objective', category: 'Tema', statement: 'Pergunta', options: ['a) A', 'b) B'], correct: 1, context: 'Explicação' }`;
const essay = `{ num: 1, type: 'dissertative', category: 'Tema', statement: 'Explique', gabarito: 'Modelo' }`;
const special = `{ num: 1, type: 'dissertative', category: 'Tema', statement: 'Explique', gabarito: 'Modelo', id: 'q1_a', mainNum: 'I', caseText: '<b>Caso</b>' }`;
async function readFixture(objectives: string, essays: string) {
  const directory = await mkdtemp(join(tmpdir(), 'medsim-legacy-'));
  const file = join(directory, 'exam.html');
  try {
    await writeFile(
      file,
      `const objectiveQuestions = [${objectives}]; const dissertativeQuestions = [${essays}];`,
    );
    return await readLegacy(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
it('aceita os três formatos legados conhecidos, incluindo id/mainNum/caseText', async () => {
  const data = await readFixture(objective, `${essay}, ${special}`);
  expect(data.objective).toHaveLength(1);
  expect(data.essay).toHaveLength(2);
  expect(data.essay[1]).toMatchObject({ id: 'q1_a', mainNum: 'I', caseText: '<b>Caso</b>' });
  const poc = await readLegacy(pocSource);
  expect([poc.objective.length, poc.essay.length]).toEqual([20, 10]);
  expect((await readLegacy('simulados/fisiologia-m5-Endocrino em Grupo.html')).essay).toHaveLength(
    8,
  );
});
it.each([
  ['objetiva', objective.replace('context:', "campoExtra: 'perderia dado', context:")],
  ['dissertativa', essay.replace('gabarito:', "campoExtra: 'perderia dado', gabarito:")],
  ['dissertativa especial', special.replace('caseText:', "campoExtra: 'perderia dado', caseText:")],
])('rejeita campo acadêmico desconhecido em %s', async (_type, changed) => {
  await expect(
    readFixture(_type === 'objetiva' ? changed : '', _type === 'objetiva' ? '' : changed),
  ).rejects.toThrow(/campoExtra/);
});
