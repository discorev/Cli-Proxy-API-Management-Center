/**
 * Meta (Muse) quota data layer: plan and usage windows parsed from the backend
 * usage cache. The backend owns the Muse key call and its DCA credential, so the
 * browser never handles the DCA token. React-free; consumed directly by tests.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, MetaQuotaData, MetaQuotaState, QuotaUsageMeta } from '@/types';
import { parseMetaQuotaPayload } from '@/services/api/metaQuota';
import { isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota';
import type { QuotaProviderData } from '../types';
import { loadUsageEntry, type UsageCacheResult, type UsageLoadMode } from '../usageCache';

export interface MetaQuotaResult {
  /** Absent until the backend has cached a parsable Muse key response. */
  data?: MetaQuotaData;
  usage: QuotaUsageMeta;
}

/** `raw.usage` is the backend's sanitized Muse key response, upstream field names kept. */
export const buildMetaQuotaResult = ({ entry, meta }: UsageCacheResult): MetaQuotaResult => {
  const data = entry.raw.usage === undefined ? null : parseMetaQuotaPayload(entry.raw.usage);
  return data ? { data, usage: meta } : { usage: meta };
};

const loadMetaQuota =
  (mode: UsageLoadMode) =>
  async (file: AuthFileItem, t: TFunction, previous?: MetaQuotaState): Promise<MetaQuotaResult> =>
    buildMetaQuotaResult(
      await loadUsageEntry(file, t, 'meta_quota', mode, {
        previousFetchedAtMs: previous?.usage?.fetchedAtMs,
      })
    );

export const META_CONFIG: QuotaProviderData<MetaQuotaState, MetaQuotaResult> = {
  type: 'meta',
  i18nPrefix: 'meta_quota',
  filterFn: (file) => resolveAuthProvider(file) === 'meta' && !isDisabledAuthFile(file),
  fetchQuota: loadMetaQuota('cached'),
  refreshQuota: loadMetaQuota('refresh'),
  storeSelector: (state) => state.metaQuota,
  storeSetter: 'setMetaQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: ({ data, usage }) => ({ status: 'success', data, usage }),
  buildErrorState: (error, errorStatus) => ({
    status: 'error',
    error,
    errorStatus,
  }),
};
