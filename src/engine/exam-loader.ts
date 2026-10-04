import { catalogSchema, type Catalog } from '../../schema/catalog';
import { identifier, parseExam } from '../../schema/exam';
import type { Exam } from '../types/exam';
import { sitePath } from '../utils/paths';

export type Fetcher = typeof fetch;
async function loadJson(path: string, fetcher: Fetcher, signal?: AbortSignal): Promise<unknown> {
  const response = await fetcher(sitePath(path), { signal });
  if (!response.ok) throw new Error(`Não foi possível carregar ${path} (HTTP ${response.status}).`);
  return response.json();
}
export async function loadCatalog(
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<Catalog> {
  return catalogSchema.parse(await loadJson('generated/exam-index.json', fetcher, signal));
}
export async function loadExam(
  id: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<Exam> {
  if (!identifier.safeParse(id).success)
    throw new Error('Identificador de prova inválido. Volte ao catálogo.');
  const path = `generated/exams/${id}.json`;
  const exam = parseExam(await loadJson(path, fetcher, signal), path);
  if (exam.id !== id) throw new Error('O identificador do arquivo difere da prova solicitada.');
  return exam;
}
