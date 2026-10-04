import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parseExam } from '../schema/exam';
import { readLegacy } from '../scripts/legacy-data';
import { remainingExams, phase3Base } from '../scripts/phase3-inventory';
import { assertExamParity } from '../scripts/exam-parity';

it.each(remainingExams)('$id: paridade integral independente do conversor', async (entry) => {
  const path = `data/exams/${entry.id}.json`;
  const exam = parseExam(JSON.parse(await readFile(path, 'utf8')), path);
  const legacy = await readLegacy(entry.sourceFile);
  expect([legacy.objective.length, legacy.essay.length]).toEqual([entry.objective, entry.essay]);
  expect(exam).toMatchObject({
    id: entry.id,
    revision: 1,
    schemaVersion: 1,
    title: entry.title,
    subject: entry.subject,
    year: entry.year,
    division: entry.division,
    provenance: { sourceFile: entry.sourceFile, sourceCommit: phase3Base },
  });
  expect(() => assertExamParity(legacy, exam)).not.toThrow();
});
