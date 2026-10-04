import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseExam } from '../schema/exam';
import type { Exam } from '../src/types/exam';
import { readLegacy, convertRichText, pocId } from './legacy-data';
import { phase3Base, remainingExams, type MigrationEntry } from './phase3-inventory';
import { assertExamParity } from './exam-parity';

export async function convertExam(entry: MigrationEntry): Promise<Exam> {
  assert.notEqual(entry.id, pocId, 'POC excluída da Fase 3');
  const legacy = await readLegacy(entry.sourceFile);
  assert.deepEqual([legacy.objective.length, legacy.essay.length], [entry.objective, entry.essay]);
  const groups: Exam['groups'] = [];
  const base = (
    q: (typeof legacy.objective)[number] | (typeof legacy.essay)[number],
    sectionId: string,
  ) => ({
    id: `${entry.id}-${sectionId}-${String(q.num).padStart(3, '0')}`,
    label: String(q.num),
    sectionId,
    category: q.category,
    statement: convertRichText(q.statement),
    images: [],
    tags: [q.category],
  });
  const exam = parseExam(
    {
      schemaVersion: 1,
      revision: 1,
      id: entry.id,
      title: entry.title,
      subject: entry.subject,
      year: entry.year,
      division: entry.division,
      description: '',
      tags: [],
      images: [],
      settings: { questionOrder: 'fixed', feedback: 'after-finish' },
      sections: [
        ...(legacy.objective.length ? [{ id: 'objetivas', title: 'Questões objetivas' }] : []),
        ...(legacy.essay.length ? [{ id: 'dissertativas', title: 'Questões dissertativas' }] : []),
      ],
      groups,
      provenance: {
        sourceFile: entry.sourceFile,
        sourceCommit: phase3Base,
        notes: [
          'Conteúdo acadêmico integral, prefixos e gabaritos posicionais preservados. Descrição e tags da prova vazias por ausência de metadados canônicos separados.',
          ...entry.notes,
        ],
      },
      questions: [
        ...legacy.objective.map((q) => {
          assert.ok(q.correct >= 0 && q.correct < q.options.length, 'Índice correct inválido');
          return {
            ...base(q, 'objetivas'),
            type: 'multiple-choice',
            options: q.options.map((text, i) => ({
              id: `option-${i + 1}`,
              text: convertRichText(text),
            })),
            correctAnswer: `option-${q.correct + 1}`,
            explanation: convertRichText(q.context),
          };
        }),
        ...legacy.essay.map((q) => {
          const fields: {
            groupId?: string;
            context?: Exam['questions'][number]['context'];
            id?: string;
            label?: string;
          } = {};
          if (q.id !== undefined || q.mainNum !== undefined || q.caseText !== undefined) {
            const match = q.id?.match(/^q(\d+)_([a-z]+)$/);
            assert.ok(
              match && q.mainNum !== undefined && q.caseText !== undefined,
              'Formato C incompleto/desconhecido',
            );
            const titleMatch = String(q.mainNum).match(/^(QUESTÃO [IVX]+) - Item ([a-z]+)$/);
            assert.ok(
              titleMatch && titleMatch[2] === match[2],
              'Identidade do caso/subitem inconsistente',
            );
            fields.id = `${base(q, 'dissertativas').id}-${q.id!.replaceAll('_', '-')}`;
            fields.label = String(q.mainNum);
            fields.groupId = `${entry.id}-caso-${match[1]}`;
            if (!groups.some((group) => group.id === fields.groupId)) {
              assert.equal(match[2], 'a', 'Caso deve começar pelo item a');
              groups.push({
                id: fields.groupId,
                title: titleMatch[1]!,
                context: convertRichText(q.caseText),
                images: [],
              });
            } else fields.context = convertRichText(q.caseText);
          }
          return {
            ...base(q, 'dissertativas'),
            ...fields,
            type: 'essay',
            modelAnswer: convertRichText(q.gabarito),
            explanation: [],
          };
        }),
      ],
    },
    entry.sourceFile,
  );
  assertExamParity(legacy, exam);
  return exam;
}
export async function migrateOne(id: string) {
  const entry = remainingExams.find((entry) => entry.id === id);
  assert.ok(entry, `Escolha exatamente uma das 16 provas restantes: ${id}`);
  const file = `data/exams/${id}.json`;
  assert.equal(
    await access(file)
      .then(() => true)
      .catch(() => false),
    false,
    'Não sobrescrever prova existente',
  );
  const exam = await convertExam(entry);
  // Schema e paridade também sobre a serialização que será persistida.
  const serialized = JSON.stringify(exam, null, 2) + '\n';
  assertExamParity(await readLegacy(entry.sourceFile), parseExam(JSON.parse(serialized), file));
  await writeFile(file, serialized, { flag: 'wx' });
  assertExamParity(
    await readLegacy(entry.sourceFile),
    parseExam(JSON.parse(await readFile(file, 'utf8')), file),
  );
  console.log(
    `CHECKPOINT OK: ${id}: ${entry.objective + entry.essay} = ${entry.objective} objetivas + ${entry.essay} dissertativas; schema, ordem, textos, opções, gabaritos, categorias, casos, tabelas e grupos preservados.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(
    process.argv.length,
    3,
    'Uso: node --import tsx scripts/migrate-exam.ts <id>; uma prova por vez',
  );
  await migrateOne(process.argv[2]!);
}
