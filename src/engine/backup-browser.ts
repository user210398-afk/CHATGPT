import { MAX_BACKUP_BYTES, parseBackup, type Backup } from './backup';
export async function readBackupFile(file: File) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('Arquivo acima do limite de 10 MiB.');
  return parseBackup(await file.text());
}
export function downloadBackup(backup: Backup) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = `medsim-backup-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Allow the browser to start the download before revocation.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
