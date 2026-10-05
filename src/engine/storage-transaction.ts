import type { StorageAdapter } from './persistence';
export type StorageChange = { key: string; before: string | null; after: string };
export function writeTransaction(
  storage: StorageAdapter,
  expected: Map<string, string | null>,
  changes: StorageChange[],
) {
  const written: StorageChange[] = [];
  // localStorage has no native transaction: compare raw values before every write.
  function check() {
    for (const [key, before] of expected) {
      const own = written.find((change) => change.key === key);
      if (storage.getItem(key) !== (own ? own.after : before))
        throw new Error('concorrência ou falha de leitura');
    }
  }
  try {
    check();
  } catch {
    throw new Error('Operação abortada por concorrência ou falha de leitura.');
  }
  try {
    for (const change of changes) {
      check();
      written.push(change); // Handles adapters that mutate and then throw.
      storage.setItem(change.key, change.after);
    }
    check();
  } catch {
    let incomplete = false;
    for (const change of written.reverse()) {
      try {
        const raw = storage.getItem(change.key);
        if (raw === change.before) continue;
        if (raw !== change.after) {
          incomplete = true;
          continue;
        } // Preserve another writer.
        if (change.before === null) {
          if (!storage.removeItem) throw new Error('removeItem indisponível');
          storage.removeItem(change.key);
        } else storage.setItem(change.key, change.before);
        if (storage.getItem(change.key) !== change.before) incomplete = true;
      } catch {
        incomplete = true;
      }
    }
    throw new Error(
      incomplete
        ? 'Operação falhou e o rollback ficou incompleto. Confira o progresso local.'
        : 'Operação falhou. As chaves tocadas foram restauradas.',
    );
  }
}
