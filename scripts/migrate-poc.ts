import { writeFile } from 'node:fs/promises';
import { parseExam } from '../schema/exam';
import { readLegacy, convertRichText, pocSource, pocId } from './legacy-data';

const legacy = await readLegacy(pocSource);
const base = (
  q: (typeof legacy.objective)[number] | (typeof legacy.essay)[number],
  sectionId: string,
) => ({
  id: `${sectionId}-${String(q.num).padStart(3, '0')}`,
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
    id: pocId,
    title: 'Fisiologia 2026 — Sistema Endócrino / Introdução e Hipófise',
    subject: 'Fisiologia',
    year: 2026,
    division: 'M5, aula 1',
    description: '',
    tags: ['Sistema Endócrino', 'Introdução e Hipófise'],
    images: [],
    settings: { questionOrder: 'fixed', feedback: 'after-finish' },
    sections: [
      { id: 'objetivas', title: 'Questões objetivas' },
      { id: 'dissertativas', title: 'Questões dissertativas' },
    ],
    groups: [],
    provenance: {
      sourceFile: pocSource,
      sourceCommit: '8d90b35d38d0f4d36f7793ffa9b744262e40fe28',
      notes: [
        'O legado oferece dois módulos independentes, sem uma ordem global entre eles. A POC concatena objetivas e dissertativas, preservando a ordem interna e a numeração original de cada módulo.',
        'Os prefixos das alternativas permanecem no texto original. Os IDs option-1 etc. indicam a posição, sem inferir gabaritos pelas letras.',
        'Tags e título agregam identificações presentes no HTML; descrição vazia por não haver descrição acadêmica canônica separada.',
      ],
    },
    questions: [
      ...legacy.objective.map((q) => ({
        ...base(q, 'objetivas'),
        type: 'multiple-choice',
        options: q.options.map((text, i) => ({
          id: `option-${i + 1}`,
          text: convertRichText(text),
        })),
        correctAnswer: `option-${q.correct + 1}`,
        explanation: convertRichText(q.context),
      })),
      ...legacy.essay.map((q) => ({
        ...base(q, 'dissertativas'),
        type: 'essay',
        modelAnswer: convertRichText(q.gabarito),
        explanation: [],
      })),
    ],
  },
  pocSource,
);
await writeFile(`data/exams/${exam.id}.json`, JSON.stringify(exam, null, 2) + '\n');
console.log(`POC: ${exam.questions.length} questões preservadas em ${exam.id}.json`);
