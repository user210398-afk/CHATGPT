import raw from '../data/exams/fisiologia-m5-aula-1-2026.json';
import { parseExam } from '../schema/exam';
export const poc = parseExam(raw);
export const first = poc.questions[0]!;
export const firstEssay = poc.questions.find((q) => q.type === 'essay')!;
