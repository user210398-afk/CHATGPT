import type { Catalog } from '../../schema/catalog';
import { attemptSchema } from './exam-state';
import { readStoredCurrent, reviewStorageKey } from './review-history';
import {
  currentEnvelopeSchema,
  historyStorageKey,
  storageKey,
  type StorageAdapter,
} from './persistence';
import { isCatalogResultConsistent, readExamProgress } from './catalog-progress';
import { reviewSessionStorageKey } from './review-session-storage';
import { writeTransaction, type StorageChange } from './storage-transaction';
export type ResetPlan = {
  expected: Map<string, string | null>;
  changes: StorageChange[];
  completed: number;
  sessions: number;
  preserved: number;
  affectedExams: number;
};
// Only known domain keys. Snapshot before confirmation; no writes or full Exam requests.
export function prepareHistoryReset(
  catalog: Catalog,
  storage: Pick<StorageAdapter, 'getItem'> = window.localStorage,
): ResetPlan {
  const plan: ResetPlan = {
    expected: new Map(),
    changes: [],
    completed: 0,
    sessions: 0,
    preserved: 0,
    affectedExams: 0,
  };
  for (const exam of catalog.exams) {
    const keys = [
      storageKey(exam),
      historyStorageKey(exam),
      reviewStorageKey(exam),
      reviewSessionStorageKey(exam),
    ];
    for (const key of keys) plan.expected.set(key, storage.getItem(key));
    const raw = plan.expected.get(storageKey(exam))!;
    let current: ReturnType<typeof readStoredCurrent> = null;
    try {
      current = readStoredCurrent(raw);
      if (
        current &&
        (!attemptSchema.safeParse(current).success ||
          current.examId !== exam.id ||
          current.examRevision !== exam.revision ||
          current.currentIndex >= exam.questionCount ||
          Object.keys(current.answers).length > exam.questionCount ||
          new Set(current.flagged).size !== current.flagged.length ||
          current.flagged.length > exam.questionCount ||
          Boolean(current.completedAt) !== Boolean(current.result) ||
          (current.mode === 'exam' && current.confirmedQuestionIds.length > 0) ||
          current.confirmedQuestionIds.some((id) => !current!.answers[id]?.trim()) ||
          (current.completedAt &&
            (Date.parse(current.completedAt) < Date.parse(current.startedAt) ||
              !isCatalogResultConsistent(exam, current.result!) ||
              (current.mode === 'study' &&
                Object.entries(current.answers).some(
                  ([id, answer]) => answer.trim() && !current!.confirmedQuestionIds.includes(id),
                )))))
      )
        throw new Error('incompatível');
    } catch {
      throw new Error(
        `Reset abortado: ${exam.title} possui uma tentativa atual incompatível ou corrompida. Possível progresso foi preservado; nenhuma chave foi alterada.`,
      );
    }
    plan.completed += readExamProgress(exam, () => ({
      getItem: (key) => plan.expected.get(key) ?? null,
    })).progress.attemptCount;
    if (plan.expected.get(reviewSessionStorageKey(exam)) !== null) plan.sessions++;
    for (const key of keys.slice(1)) {
      const before = plan.expected.get(key)!;
      if (before !== null) plan.changes.push({ key, before, after: null });
    }
    if (current) {
      if (current.completedAt)
        plan.changes.push({ key: storageKey(exam), before: raw, after: null });
      else {
        plan.preserved++;
        // v1 embeds old completed attempts; remove them only within this explicit reset.
        if (JSON.parse(raw!).storageVersion !== 3)
          plan.changes.push({
            key: storageKey(exam),
            before: raw,
            after: JSON.stringify(currentEnvelopeSchema.parse({ storageVersion: 3, current })),
          });
      }
    }
    if (keys.some((key) => plan.changes.some((change) => change.key === key))) plan.affectedExams++;
  }
  return plan;
}
export function confirmHistoryReset(
  plan: ResetPlan,
  confirmation: string,
  storage: StorageAdapter = window.localStorage,
) {
  if (confirmation !== 'ZERAR') throw new Error('Digite exatamente ZERAR para confirmar.');
  writeTransaction(storage, plan.expected, plan.changes);
  return { completed: plan.completed, sessions: plan.sessions, preserved: plan.preserved };
}
