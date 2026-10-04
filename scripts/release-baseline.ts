import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pocId } from './legacy-data';
import { remainingExams } from './phase3-inventory';
import type { Exam } from '../src/types/exam';

export const releaseBaselineCommit = 'edc645c78633e28b21c4dcf5722d347f095a7f9e';
export const migratedExamIds = [pocId, ...remainingExams.map((exam) => exam.id)];
const run = promisify(execFile);

// A proteção é individual: futuras adições não alteram o conjunto migrado.
export async function assertReleaseBaseline(root = '.') {
  assert.equal(new Set(migratedExamIds).size, 17);
  for (const id of migratedExamIds) {
    const file = `data/exams/${id}.json`;
    const { stdout } = await run('git', ['show', `${releaseBaselineCommit}:${file}`], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.deepEqual(await readFile(join(root, file)), stdout, `Baseline alterado: ${file}`);
  }
}

export function migratedBaseline(exams: Exam[]) {
  return migratedExamIds.map((id) => {
    const exam = exams.find((item) => item.id === id);
    assert.ok(exam, `Baseline ausente: ${id}`);
    return exam;
  });
}

export function examCounts(exams: Exam[]) {
  const questions = exams.flatMap((exam) => exam.questions);
  const objective = questions.filter((question) => question.type === 'multiple-choice');
  return {
    exams: exams.length,
    questions: questions.length,
    objective: objective.length,
    essay: questions.length - objective.length,
    options: objective.reduce((sum, question) => sum + question.options.length, 0),
    groups: exams.reduce((sum, exam) => sum + exam.groups.length, 0),
  };
}
