import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  open,
  lstat,
  mkdir,
  mkdtemp,
  link,
  rm,
  unlink,
  readdir,
  readFile,
  writeFile,
  rename,
} from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { sourceMetadataSchema } from '../../schema/generation';
import { identifier } from '../../schema/exam';

export class GenerationError extends Error {}
export const maximumSourceBytes = 50 * 1024 * 1024;
export const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export async function readSource(file: string) {
  const extension = extname(file).toLowerCase();
  if (!['.pdf', '.docx', '.pptx', '.txt', '.md'].includes(extension))
    throw new GenerationError('Extensão não suportada: use PDF, DOCX, PPTX, TXT ou MD');
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) throw new GenerationError('Fonte deve ser arquivo regular');
    if (info.size > maximumSourceBytes) throw new GenerationError('Fonte excede limite de 50 MB');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > maximumSourceBytes) throw new GenerationError('Fonte excede limite de 50 MB');
      chunks.push(buffer);
    }
    const bytes = Buffer.concat(chunks);
    const source = sourceMetadataSchema.parse({
      fileName: basename(file),
      sha256: digest(bytes),
      sizeBytes: size,
    });
    return { source, extension, bytes };
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    throw new GenerationError(
      'Fonte inexistente, vazia, inválida ou não acessível (symlinks não são aceitos)',
    );
  } finally {
    await handle?.close();
  }
}
export async function readJson(file: string): Promise<unknown> {
  try {
    if (!(await lstat(file)).isFile()) throw new Error();
    if ((await lstat(file)).size > 10 * 1024 * 1024) throw new Error();
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new GenerationError('JSON local inexistente, inválido ou maior que 10 MB');
  }
}
export async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
// Refuse symlink output directories. Every directory component is controlled by code.
export async function safeDirectory(root: string, parts: string[]) {
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (!(await lstat(current)).isDirectory())
      throw new GenerationError('Diretório de authoring inválido ou symlink');
  }
  return current;
}
export async function assertAvailable(root: string, id: string, exporting = false) {
  identifier.parse(id);
  for (const directory of [
    'candidates',
    'reviews',
    'generations',
    ...(exporting ? ['exports'] : []),
  ]) {
    if (
      await exists(join(root, 'authoring', directory, directory === 'exports' ? id : `${id}.json`))
    )
      throw new GenerationError(
        `Destino já existe em authoring/${directory}; use novo ID ou remova manualmente`,
      );
  }
  // Check all production IDs, not just matching filenames.
  for (const file of await readdir(join(root, 'data/exams'))) {
    if (
      file === `${id}.json` ||
      (file.endsWith('.json') &&
        ((await readJson(join(root, 'data/exams', file))) as { id?: string }).id === id)
    )
      throw new GenerationError('ID já existe em produção; geração permite somente nova prova');
  }
}
export async function withGenerationLock<T>(root: string, id: string, action: () => Promise<T>) {
  identifier.parse(id);
  const locks = await safeDirectory(root, ['authoring', '.generation-locks']);
  const lock = join(locks, id);
  try {
    await mkdir(lock);
  } catch {
    throw new GenerationError(
      'Geração em andamento ou lock existente; confira antes de remover manualmente',
    );
  }
  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
// Each publication is atomic and exclusive. On failure, remove only our own links.
// A process crash can leave evidence/lock; it never overwrites another run.
export async function writeArtifacts(
  root: string,
  id: string,
  artifacts: { exam: unknown; review: unknown; record: unknown },
  publish: typeof link = link,
) {
  const authoring = await safeDirectory(root, ['authoring']);
  const stage = await mkdtemp(join(authoring, '.generation-stage-'));
  const published: string[] = [];
  try {
    for (const [directory, value] of [
      ['candidates', artifacts.exam],
      ['reviews', artifacts.review],
      ['generations', artifacts.record],
    ] as const) {
      const destination = await safeDirectory(root, ['authoring', directory]);
      const temporary = join(stage, `${directory}.json`);
      await writeFile(temporary, json(value), { flag: 'wx', mode: 0o600 });
      const target = join(destination, `${id}.json`);
      await publish(temporary, target);
      published.push(target);
    }
  } catch (error) {
    for (const target of published.reverse()) await unlink(target);
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
export async function writeExport(root: string, id: string, files: Record<string, string>) {
  const destination = await safeDirectory(root, ['authoring', 'exports']);
  const stage = await mkdtemp(join(destination, '.generation-stage-'));
  try {
    for (const [name, content] of Object.entries(files))
      await writeFile(join(stage, name), content, { flag: 'wx', mode: 0o600 });
    if (await exists(join(destination, id))) throw new GenerationError('Export já existe');
    await rename(stage, join(destination, id));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
