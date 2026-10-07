import type { Catalog } from '../../schema/catalog';
import type { Attempt } from './exam-state';
import { normalizeLegacyAttempt } from './exam-state';
import {
  storageKey,
  historyStorageKey,
  previousEnvelopeSchema,
  readableCurrentEnvelopeSchema,
  readableHistoryEnvelopeSchema,
  type HistoryEntry,
} from './persistence';
import {
  completedReviewAttemptSchema,
  reviewEnvelopeSchema,
  reviewStorageKey,
} from './review-history';
import { isCatalogResultConsistent } from './catalog-progress';

// Deliberately exposes no mutation methods. Enumeration is optional for adapters;
// browsers provide it, allowing historical identities to be reported separately.
export type NotebookStorage = {
  getItem(key: string): string | null;
  readonly length?: number;
  key?(index: number): string | null;
};
export type NotebookIdentity = { id: string; revision: number };
export type NotebookWarning = NotebookIdentity & {
  kind: 'invalid-source' | 'conflict' | 'partial' | 'load';
  message: string;
};
export type NotebookSources = {
  identity: NotebookIdentity;
  detailed: Attempt[];
  summaries: HistoryEntry[];
  warnings: NotebookWarning[];
  hasHistory: boolean;
};
export const NOTEBOOK_MAX_RAW_LENGTH = 5 * 1024 * 1024;
export const NOTEBOOK_MAX_KEYS = 10_000;
const MAX_SNAPSHOT_LENGTH = 16 * 1024 * 1024;

export function parseNotebookKey(key: string): (NotebookIdentity & { source: string }) | null {
  const match =
    /^chatgpt-exams:v1:([a-z0-9]+(?:-[a-z0-9]+)*):r([1-9][0-9]*)(?::(history|review))?$/.exec(key);
  if (!match) return null;
  const revision = Number(match[2]);
  return Number.isSafeInteger(revision)
    ? { id: match[1]!, revision, source: match[3] ?? 'current' }
    : null;
}

export function captureNotebookRaws(
  catalog: Catalog,
  storage: NotebookStorage,
): Map<string, string | null> {
  const keys = new Set<string>();
  for (const exam of catalog.exams) {
    keys.add(storageKey(exam));
    keys.add(historyStorageKey(exam));
    keys.add(reviewStorageKey(exam));
  }
  if (storage.key && storage.length !== undefined) {
    const length = storage.length;
    if (length > NOTEBOOK_MAX_KEYS) throw new Error('Limite de leitura de chaves excedido.');
    for (let index = 0; index < length; index++) {
      const key = storage.key(index);
      if (key && parseNotebookKey(key)) keys.add(key);
    }
  }
  const raws = new Map<string, string | null>();
  let size = 0;
  for (const key of keys) {
    const raw = storage.getItem(key);
    size += raw?.length ?? 0;
    if (size > MAX_SNAPSHOT_LENGTH) throw new Error('Limite de leitura do histórico excedido.');
    raws.set(key, raw);
  }
  return raws;
}

export function sameNotebookRaws(
  a: ReadonlyMap<string, string | null>,
  b: ReadonlyMap<string, string | null>,
) {
  return a.size === b.size && [...a].every(([key, raw]) => b.has(key) && b.get(key) === raw);
}

export function readNotebookSources(
  inputIdentity: NotebookIdentity,
  raws: ReadonlyMap<string, string | null>,
  catalogExam?: Catalog['exams'][number],
): NotebookSources {
  const identity = { id: inputIdentity.id, revision: inputIdentity.revision };
  const result: NotebookSources = {
    identity,
    detailed: [],
    summaries: [],
    warnings: [],
    hasHistory: false,
  };
  const embedded: Attempt[] = [];
  const matches = (attempt: Attempt) =>
    attempt.examId === identity.id && attempt.examRevision === identity.revision;
  const parse = (raw: string) => {
    if (raw.length > NOTEBOOK_MAX_RAW_LENGTH) throw new Error('Fonte excede o limite de leitura.');
    return JSON.parse(raw) as unknown;
  };
  for (const source of ['current', 'review', 'history'] as const) {
    const key =
      source === 'current'
        ? storageKey(identity)
        : source === 'review'
          ? reviewStorageKey(identity)
          : historyStorageKey(identity);
    const raw = raws.get(key) ?? null;
    if (raw === null) continue;
    try {
      const value = parse(raw);
      let attempts: Attempt[] = [];
      let summaries: HistoryEntry[] = [];
      let completedCurrent = false;
      if (source === 'history') {
        summaries = readableHistoryEnvelopeSchema.parse(value).history;
        if (
          new Set(summaries.map((entry) => entry.id)).size !== summaries.length ||
          summaries.some((entry) => Date.parse(entry.completedAt) < Date.parse(entry.startedAt))
        )
          throw new Error('Resumo incompatível.');
        // A structurally valid summary is evidence, never grading data. Keep a
        // mismatching Result available for same-ID conflict checks: discarding it
        // here would silently choose the detailed copy over contradictory data.
        if (
          catalogExam &&
          summaries.some((entry) => !isCatalogResultConsistent(catalogExam, entry.result))
        )
          result.warnings.push({
            ...identity,
            kind: 'invalid-source',
            message:
              'Há resumos com resultados incompatíveis. Eles servem somente para detectar conflitos e cobertura parcial; não identificam erros por questão.',
          });
      } else if (source === 'review') {
        attempts = reviewEnvelopeSchema.parse(value).attempts;
      } else {
        const modern = readableCurrentEnvelopeSchema.safeParse(value);
        let current: Attempt;
        if (modern.success) current = modern.data.current;
        else {
          const legacy = previousEnvelopeSchema.parse(value);
          current = normalizeLegacyAttempt(legacy.current);
          attempts = legacy.history.map(normalizeLegacyAttempt);
          if (new Set(attempts.map((attempt) => attempt.id)).size !== attempts.length)
            throw new Error('IDs duplicados no histórico legado.');
          // Invalid embedded history excludes this envelope as a whole.
          attempts.forEach((attempt) => completedReviewAttemptSchema.parse(attempt));
        }
        if (!matches(current) || Boolean(current.completedAt) !== Boolean(current.result))
          throw new Error('Identidade da tentativa atual incompatível.');
        if (current.completedAt) {
          attempts.unshift(completedReviewAttemptSchema.parse(current));
          completedCurrent = true;
        }
      }
      if (attempts.some((attempt) => !matches(attempt)))
        throw new Error('Identidade da fonte incompatível.');
      if (source === 'current') {
        result.detailed.push(...attempts.slice(0, completedCurrent ? 1 : 0));
        embedded.push(...attempts.slice(completedCurrent ? 1 : 0));
      } else result.detailed.push(...attempts);
      result.summaries.push(...summaries);
      result.hasHistory ||= attempts.length > 0 || summaries.length > 0;
    } catch {
      result.hasHistory = true;
      result.warnings.push({
        ...identity,
        kind: 'invalid-source',
        message: `A fonte ${source === 'current' ? 'da tentativa atual' : source === 'review' ? 'de revisão detalhada' : 'de resumos'} está corrompida ou incompatível. O registro foi preservado; a cobertura pode ser parcial.`,
      });
    }
  }
  result.detailed.push(...embedded);
  return result;
}
