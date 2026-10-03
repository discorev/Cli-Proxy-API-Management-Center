/**
 * Shared transport for the backend usage cache (Claude and Codex).
 * React-free: the provider data modules turn the cached raw bodies into state.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, QuotaUsageMeta } from '@/types';
import {
  credentialUsageApi,
  type CredentialResetCode,
  type CredentialUsageEntry,
} from '@/services/api/credentialUsage';
import { normalizeAuthIndex } from '@/utils/authIndex';

/**
 * Without a previous card state, a refresh served from cache is detected by
 * comparing the backend's fetch time with the browser's clock, so allow for
 * modest skew between the two.
 */
export const REFRESH_CLOCK_SKEW_MS = 30_000;

export type UsageLoadMode = 'cached' | 'refresh';

export interface UsageCacheResult {
  entry: CredentialUsageEntry;
  meta: QuotaUsageMeta;
}

export interface UsageResetResult {
  code: CredentialResetCode;
  /** Null when the backend refused before returning an entry (409/400). */
  result: UsageCacheResult | null;
  /** When a refused (409 refresh_pending) reset can be tried again. */
  nextFetchAtMs: number | null;
}

/** Card state an explicit refresh compares against; absent when the card has none. */
export interface UsageLoadOptions {
  /** The card's previous `fetchedAtMs`; `undefined` when there is no prior state. */
  previousFetchedAtMs?: number | null;
  now?: () => number;
}

/** The note-relevant cache state; the rest comes from the caller's context. */
export const buildUsageMeta = (
  entry: CredentialUsageEntry,
  context: { deferredUntilMs?: number | null; fetchAdvanced?: boolean } = {}
): QuotaUsageMeta => ({
  fetchedAtMs: entry.fetchedAtMs,
  nextFetchAtMs: entry.nextFetchAtMs,
  cooldownUntilMs: entry.cooldownUntilMs,
  lastError: entry.lastError,
  fetchAdvanced: context.fetchAdvanced ?? false,
  notFetched:
    entry.fetchedAtMs === null &&
    entry.raw.usage === undefined &&
    !entry.lastError &&
    entry.cooldownUntilMs === null,
  deferredUntilMs: context.deferredUntilMs ?? null,
});

/**
 * Whether an explicit refresh actually fetched. With a previous card state the
 * backend's `fetched_at` must have moved past it (an unchanged value was served
 * from cache); without one, fall back to the browser's clock.
 */
export const refreshFetched = (
  entry: CredentialUsageEntry,
  startedAtMs: number,
  previousFetchedAtMs?: number | null
): boolean => {
  if (entry.fetchedAtMs === null) return false;
  if (previousFetchedAtMs !== undefined) {
    return previousFetchedAtMs === null || entry.fetchedAtMs > previousFetchedAtMs;
  }
  return entry.fetchedAtMs >= startedAtMs - REFRESH_CLOCK_SKEW_MS;
};

/** When an explicit refresh got cached data back, the instant fresh data can be fetched. */
export const refreshDeferredUntil = (
  entry: CredentialUsageEntry,
  startedAtMs: number,
  fetched: boolean
): number | null =>
  !fetched && entry.nextFetchAtMs !== null && entry.nextFetchAtMs > startedAtMs
    ? entry.nextFetchAtMs
    : null;

const requireAuthIndex = (file: AuthFileItem, t: TFunction, i18nPrefix: string): string => {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) throw new Error(t(`${i18nPrefix}.missing_auth_index`));
  return authIndex;
};

/** Reads (`cached`) or refreshes (`refresh`) one credential's usage cache entry. */
export async function loadUsageEntry(
  file: AuthFileItem,
  t: TFunction,
  i18nPrefix: string,
  mode: UsageLoadMode,
  { previousFetchedAtMs, now = Date.now }: UsageLoadOptions = {}
): Promise<UsageCacheResult> {
  const authIndex = requireAuthIndex(file, t, i18nPrefix);
  const startedAtMs = now();
  const entries =
    mode === 'refresh'
      ? await credentialUsageApi.refresh(authIndex)
      : await credentialUsageApi.list(authIndex);
  const entry = entries.find((candidate) => candidate.authIndex === authIndex);
  if (!entry) throw new Error(t(`${i18nPrefix}.empty_windows`));
  if (mode !== 'refresh') return { entry, meta: buildUsageMeta(entry) };
  const fetched = refreshFetched(entry, startedAtMs, previousFetchedAtMs);
  return {
    entry,
    meta: buildUsageMeta(entry, {
      deferredUntilMs: refreshDeferredUntil(entry, startedAtMs, fetched),
      fetchAdvanced: fetched,
    }),
  };
}

/** Asks the backend to spend one reset; it refreshes usage before and after spending. */
export async function resetUsageEntry(
  file: AuthFileItem,
  t: TFunction,
  i18nPrefix: string,
  { grantId, previousFetchedAtMs, now = Date.now }: UsageLoadOptions & { grantId?: string } = {}
): Promise<UsageResetResult> {
  const authIndex = requireAuthIndex(file, t, i18nPrefix);
  const startedAtMs = now();
  const outcome = await credentialUsageApi.reset(authIndex, grantId);
  if (!outcome.entry) {
    return { code: outcome.code, result: null, nextFetchAtMs: outcome.nextFetchAtMs };
  }
  const nextFetchAtMs = outcome.nextFetchAtMs ?? outcome.entry.nextFetchAtMs;
  return {
    code: outcome.code,
    nextFetchAtMs,
    result: {
      entry: outcome.entry,
      meta: buildUsageMeta(outcome.entry, {
        deferredUntilMs: outcome.refreshPending ? nextFetchAtMs : null,
        fetchAdvanced: refreshFetched(outcome.entry, startedAtMs, previousFetchedAtMs),
      }),
    },
  };
}
