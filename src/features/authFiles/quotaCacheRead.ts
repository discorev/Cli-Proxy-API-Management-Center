/**
 * Auth Files quota cards re-read the backend usage cache when they mount. This
 * is the cached read (GET, never upstream); the card's Refresh keeps POSTing a
 * refresh. React-free so the read and its guards can be tested directly.
 */

import type { TFunction } from 'i18next';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import {
  getQuotaMap,
  getQuotaSetter,
  type QuotaAdapter,
  type QuotaCardState,
} from '@/features/quota/providers';
import { isRuntimeOnlyAuthFile, type QuotaProviderType } from './constants';

/** Providers whose page-load read is the backend usage cache. */
export const CACHE_READ_ON_MOUNT_TYPES: ReadonlySet<QuotaProviderType> = new Set([
  'claude',
  'codex',
]);

export const shouldReadQuotaCacheOnMount = (
  quotaType: QuotaProviderType,
  file: AuthFileItem,
  disableControls: boolean
): boolean =>
  CACHE_READ_ON_MOUNT_TYPES.has(quotaType) &&
  !disableControls &&
  !file.disabled &&
  !isRuntimeOnlyAuthFile(file);

/**
 * Reads one card's cached usage into the quota store. Skips when a load is
 * already in flight (which also keeps Refresh and Reset disabled meanwhile);
 * drops the result if the session or this file changed since the read began.
 */
export async function readQuotaCacheIntoStore(
  adapter: QuotaAdapter,
  file: AuthFileItem,
  t: TFunction
): Promise<void> {
  const cacheKey = getQuotaCacheKey(file);
  if (getQuotaMap(adapter)[cacheKey]?.status === 'loading') return;
  const setQuota = getQuotaSetter(adapter);
  const generation = captureQuotaCacheGeneration(file.name);
  setQuota((prev) => ({ ...prev, [cacheKey]: adapter.buildLoadingState() }));
  let next: QuotaCardState;
  try {
    next = adapter.buildSuccessState(await adapter.fetchQuota(file, t));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : t('common.unknown_error');
    next = adapter.buildErrorState(message, getStatusFromError(err));
  }
  commitIfQuotaCacheCurrent(generation, () => {
    setQuota((prev) => ({ ...prev, [cacheKey]: next }));
  });
}
