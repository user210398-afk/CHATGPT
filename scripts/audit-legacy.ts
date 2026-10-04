import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { extractArray, readLegacy } from './legacy-data';

const files = (await readdir('simulados')).filter((file) => file.endsWith('.html')).sort();
const hub = await readFile('index.html', 'utf8');
const inline = extractArray(hub, 'MEUS_ARQUIVOS_MANUAIS');
const catalog = JSON.parse(await readFile('simulados.json', 'utf8')) as { arquivo: string }[];
assert.deepEqual(
  inline.sort(),
  files.map((file) => `simulados/${file}`),
);
assert.deepEqual(catalog.map((entry) => entry.arquivo).sort(), [...inline].sort());
let objectives = 0,
  essays = 0,
  mixed = 0,
  objectiveOnly = 0,
  essayOnly = 0;
for (const file of files) {
  const exam = await readLegacy(`simulados/${file}`);
  for (const q of exam.objective)
    assert.ok(q.correct >= 0 && q.correct < q.options.length, `${file}: gabarito inválido`);
  objectives += exam.objective.length;
  essays += exam.essay.length;
  if (exam.objective.length && exam.essay.length) mixed++;
  else if (exam.objective.length) objectiveOnly++;
  else essayOnly++;
  assert.ok(!/<img\b|data:image/i.test(exam.html), `${file}: imagem encontrada`);
}
assert.deepEqual(
  [files.length, objectives, essays, objectiveOnly, mixed, essayOnly],
  [17, 462, 23, 14, 2, 1],
);
console.log('Paridade: 17 HTMLs = 17 entradas inline = 17 entradas em simulados.json.');
console.log(
  '485 questões: 462 objetivas + 23 dissertativas; 14 objetivas, 2 mistas, 1 dissertativa. Sem imagens.',
);
console.log(
  'Divergência documental: backup-medsim.js e grifar-borracha.js estão carregados no hub atual.',
);
