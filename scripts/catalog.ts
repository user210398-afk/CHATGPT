import { readdir, readFile, stat } from 'node:fs/promises';
import { parseExam } from '../schema/exam';
import type { Exam } from '../src/types/exam';
import { catalogSchema } from '../schema/catalog';

export async function readExamCatalog(directory = 'data/exams', publicDir = 'public') {
  const exams: Exam[] = [];
  const filenames = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();
  for (const file of filenames) {
    const path = `${directory}/${file}`;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      throw new Error(`${path} → prova → JSON → ${String(error)}`);
    }
    const exam = parseExam(raw, path);
    if (exams.some((existing) => existing.id === exam.id))
      throw new Error(`${path} → prova → id → ID de prova duplicado: ${exam.id}`);
    if (file !== `${exam.id}.json`)
      throw new Error(`${path} → prova → id → Nome do arquivo deve ser ${exam.id}.json`);
    const images = [
      ...exam.images.map((image) => ({ image, location: 'prova' })),
      ...exam.groups.flatMap((group) =>
        group.images.map((image) => ({ image, location: `grupo ${group.id}` })),
      ),
      ...exam.questions.flatMap((q) =>
        q.images.map((image) => ({ image, location: `questão ${q.id}` })),
      ),
    ];
    for (const { image, location } of images) {
      const exists = await stat(`${publicDir}/${image.src}`)
        .then((value) => value.isFile())
        .catch(() => false);
      if (!exists)
        throw new Error(`${path} → ${location} → images.src → Arquivo ausente: ${image.src}`);
    }
    exams.push(exam);
  }
  return {
    exams,
    catalog: catalogSchema.parse({
      schemaVersion: 1,
      exams: exams.map((exam) => ({
        id: exam.id,
        revision: exam.revision,
        title: exam.title,
        subject: exam.subject,
        year: exam.year,
        division: exam.division,
        description: exam.description,
        tags: exam.tags,
        questionCount: exam.questions.length,
        objectiveCount: exam.questions.filter((q) => q.type === 'multiple-choice').length,
        essayCount: exam.questions.filter((q) => q.type === 'essay').length,
      })),
    }),
  };
}
