import { expect, it } from 'vitest';
import { readLegacy, convertRichText, extractArray } from '../scripts/legacy-data';
import { remainingExams } from '../scripts/phase3-inventory';
import { convertExam, migrateOne } from '../scripts/migrate-exam';
import { assertExamParity } from '../scripts/exam-parity';

it('protege a POC e impede sobrescrever dados já migrados', async () => {
  await expect(migrateOne('fisiologia-m5-aula-1-2026')).rejects.toThrow(/16 provas/);
});
it('representa três casos compartilhados, numeração e oito subitens sem perder continuações/tabelas', async () => {
  const entry = remainingExams.find((e) => e.essay === 8)!;
  const exam = await convertExam(entry);
  expect(exam.groups).toHaveLength(3);
  expect(exam.questions.map((q) => q.groupId)).toEqual([
    ...Array(3).fill(exam.groups[0]!.id),
    ...Array(2).fill(exam.groups[1]!.id),
    ...Array(3).fill(exam.groups[2]!.id),
  ]);
  expect(exam.questions[0]!.label).toBe('QUESTÃO I - Item a');
  const legacy = await readLegacy(entry.sourceFile);
  for (const mutate of [
    (e: typeof exam) => {
      e.questions.reverse();
    },
    (e: typeof exam) => {
      e.questions[1]!.groupId = e.groups[1]!.id;
    },
    (e: typeof exam) => {
      e.questions[1]!.context = [];
    },
    (e: typeof exam) => {
      e.groups[0]!.context = [];
    },
  ]) {
    const changed = structuredClone(exam);
    mutate(changed);
    expect(() => assertExamParity(legacy, changed)).toThrow();
  }
});
it('paridade bloqueia alternativa, correct e comentário adulterados', async () => {
  const entry = remainingExams[0]!;
  const legacy = await readLegacy(entry.sourceFile);
  const exam = await convertExam(entry);
  for (const field of ['statement', 'explanation', 'options', 'correctAnswer'] as const) {
    const changed = structuredClone(exam);
    const q = changed.questions[0]!;
    if (q.type !== 'multiple-choice') throw new Error('fixture');
    if (field === 'correctAnswer') q.correctAnswer = 'option-inventada';
    else if (field === 'options') q.options.pop();
    else q[field] = [{ type: 'text', text: 'Conteúdo alterado' }];
    expect(() => assertExamParity(legacy, changed)).toThrow();
  }
});
it.each([
  '<script>alert(1)</script>',
  '<a href="javascript:alert(1)">x</a>',
  '<p onclick="alert(1)">x</p>',
  '<custom>x</custom>',
  '<html>x</html>',
  '<body onclick="x">x</body>',
  'x</unknown>',
])('rejeita HTML não permitido: %s', (html) => {
  expect(() => convertRichText(html)).toThrow();
});
it.each([
  '[f()]',
  '[new Date()]',
  '[() => 1]',
  '[{ get num() { return 1; } }]',
  '[{ num: 1, num: 2 }]',
])('rejeita código/propriedades ambíguas: %s', (data) => {
  expect(() => extractArray(`const objectiveQuestions = ${data};`, 'objectiveQuestions')).toThrow();
});
