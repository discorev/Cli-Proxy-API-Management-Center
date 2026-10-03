/**
 * Short card notes for the backend usage cache. Pure and React-free.
 *
 * A provider 429 cooldown explains everything else on the card, so it stands
 * alone. Otherwise the last refresh error and a deferred refresh are both shown.
 * When the refresh behind the card still fetched usage, the error came from an
 * ancillary call and is a warning, not a failed refresh.
 */

import type { QuotaUsageMeta } from '@/types';

export type UsageNote =
  | { kind: 'cooldown'; atMs: number }
  | { kind: 'deferred'; atMs: number }
  | { kind: 'error'; message: string }
  | { kind: 'warning'; message: string };

export function describeUsageNotes(meta: QuotaUsageMeta | undefined, now: number): UsageNote[] {
  if (!meta) return [];
  if (meta.cooldownUntilMs !== null && meta.cooldownUntilMs > now) {
    return [{ kind: 'cooldown', atMs: meta.cooldownUntilMs }];
  }
  const notes: UsageNote[] = [];
  if (meta.lastError) {
    notes.push({ kind: meta.fetchAdvanced ? 'warning' : 'error', message: meta.lastError });
  }
  if (meta.deferredUntilMs !== null && meta.deferredUntilMs > now) {
    notes.push({ kind: 'deferred', atMs: meta.deferredUntilMs });
  }
  return notes;
}

/** Wall-clock time for a note, e.g. 14:05. */
export const formatUsageNoteTime = (ms: number, locale?: string): string =>
  new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
