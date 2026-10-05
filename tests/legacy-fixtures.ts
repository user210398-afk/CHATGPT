import type { Attempt } from '../src/engine/exam-state';
import type { HistoryEntry } from '../src/engine/persistence';
// Test-only serialization of real frozen contracts. Do not put v3 fields in v1/v2 fixtures.
export function legacyAttempt({
  mode: _mode,
  confirmedQuestionIds: _confirmed,
  ...attempt
}: Attempt) {
  return attempt;
}
export function legacyHistory({ mode: _mode, ...entry }: HistoryEntry) {
  return entry;
}
export function storageFixtureJson(
  value: unknown,
  replacer?: null,
  space?: number | string,
): string {
  if (value && typeof value === 'object') {
    const envelope = value as {
      storageVersion?: number;
      current?: Attempt;
      history?: (Attempt | HistoryEntry)[];
    };
    if ((envelope.storageVersion === 1 || envelope.storageVersion === 2) && envelope.current) {
      value = {
        ...envelope,
        current: legacyAttempt(envelope.current),
        ...(Array.isArray(envelope.history)
          ? {
              history: envelope.history.map((item) =>
                'answers' in item ? legacyAttempt(item) : legacyHistory(item),
              ),
            }
          : {}),
      };
    } else if (envelope.storageVersion === 2 && Array.isArray(envelope.history)) {
      value = {
        ...envelope,
        history: envelope.history.map((item) => legacyHistory(item as HistoryEntry)),
      };
    }
  }
  return JSON.stringify(value, replacer, space);
}
