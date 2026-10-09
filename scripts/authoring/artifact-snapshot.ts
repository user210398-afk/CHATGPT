import { constants, type BigIntStats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { GenerationError } from './generation-files';

export type FileSnapshot = { present: false } | { present: true; bytes: Buffer; info: BigIntStats };
const approvalChanged = () =>
  new GenerationError('Artefatos mudaram durante a aprovação; revise novamente antes de aprovar.');

function sameFileInfo(left: BigIntStats, right: BigIntStats) {
  return (['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs', 'nlink'] as const).every(
    (field) => left[field] === right[field],
  );
}

// Identity/type checks detect replacement even when bytes are identical. Never follow symlinks.
export async function snapshotFile(path: string, optional = false): Promise<FileSnapshot> {
  let handle;
  try {
    const info = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (optional && error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!info) return { present: false };
    if (!info.isFile()) throw approvalChanged();
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!sameFileInfo(info, await handle.stat({ bigint: true }))) throw approvalChanged();
    const bytes = await handle.readFile();
    if (
      !sameFileInfo(info, await handle.stat({ bigint: true })) ||
      !sameFileInfo(info, await lstat(path, { bigint: true }))
    )
      throw approvalChanged();
    return { present: true, bytes, info };
  } catch {
    throw approvalChanged();
  } finally {
    await handle?.close();
  }
}

export async function assertStable(path: string, original: FileSnapshot) {
  const current = await snapshotFile(path, true);
  if (
    original.present !== current.present ||
    (original.present &&
      current.present &&
      (!original.bytes.equals(current.bytes) || !sameFileInfo(original.info, current.info)))
  )
    throw approvalChanged();
}
