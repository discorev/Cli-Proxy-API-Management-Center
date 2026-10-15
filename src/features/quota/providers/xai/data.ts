/**
 * xAI quota data layer. Grok subscription credentials read the backend usage
 * cache (weekly credits, monthly billing and plan); recognized paid API
 * credentials keep the direct health probe, which reports no quota numbers.
 * React-free / SCSS-free; consumed directly by tests.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, QuotaUsageMeta, XaiBillingSummary, XaiQuotaState } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  XAI_API_CHAT_URL,
  XAI_API_ME_URL,
  XAI_API_REQUEST_HEADERS,
  XAI_PAID_HEALTH_MODEL,
  normalizeStringValue,
  parseXaiBillingPayload,
  buildXaiBillingSummary,
  buildXaiPaidHealthSummary,
  mergeXaiBillingSummaries,
  resolveXaiSubscriptionPlan,
  createStatusError,
  isDisabledAuthFile,
  isPaidXaiAuthFile,
  isXaiFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isRecord } from '@/utils/helpers';
import type { QuotaProviderData } from '../types';
import { loadUsageEntry, type UsageCacheResult, type UsageLoadMode } from '../usageCache';

const XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS = 15000;

export interface XaiQuotaResult {
  billing: XaiBillingSummary | null;
  /** Absent for paid API credentials, which do not use the usage cache. */
  usage?: QuotaUsageMeta;
}

const requestXaiPaidHealth = async (authIndex: string): Promise<XaiBillingSummary> => {
  const [profileRequest, chatRequest] = await Promise.allSettled([
    apiCallApi.request(
      {
        authIndex,
        method: 'GET',
        url: XAI_API_ME_URL,
        header: XAI_API_REQUEST_HEADERS,
      },
      { timeout: XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS }
    ),
    apiCallApi.request(
      {
        authIndex,
        method: 'POST',
        url: XAI_API_CHAT_URL,
        header: {
          ...XAI_API_REQUEST_HEADERS,
          'Content-Type': 'application/json',
        },
        data: JSON.stringify({
          model: XAI_PAID_HEALTH_MODEL,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      },
      { timeout: XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS }
    ),
  ]);

  if (chatRequest.status === 'rejected') throw chatRequest.reason;
  if (chatRequest.value.statusCode < 200 || chatRequest.value.statusCode >= 300) {
    throw createStatusError(
      getApiCallErrorMessage(chatRequest.value),
      chatRequest.value.statusCode
    );
  }

  const profile =
    profileRequest.status === 'fulfilled' &&
    profileRequest.value.statusCode >= 200 &&
    profileRequest.value.statusCode < 300
      ? profileRequest.value.body
      : null;
  return buildXaiPaidHealthSummary(profile);
};

/** Paid API credentials are probed directly; the probe sends a 1-token chat request. */
const fetchXaiPaidHealth = async (file: AuthFileItem, t: TFunction): Promise<XaiQuotaResult> => {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) throw new Error(t('xai_quota.missing_auth_index'));
  return { billing: await requestXaiPaidHealth(authIndex) };
};

const summarizeBillingBody = (body: unknown): XaiBillingSummary | null =>
  body === undefined ? null : buildXaiBillingSummary(parseXaiBillingPayload(body)?.config);

const readPlanField = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = normalizeStringValue(record[key]);
    if (value) return value;
  }
  return null;
};

/** `raw.subscription` is the backend's sanitized tier/display pair. */
const parseXaiSubscriptionPlan = (subscription: unknown) => {
  if (!isRecord(subscription)) return null;
  return resolveXaiSubscriptionPlan(
    readPlanField(subscription, ['subscriptionTier', 'subscription_tier']),
    readPlanField(subscription, ['subscriptionTierDisplay', 'subscription_tier_display'])
  );
};

/**
 * Builds the card from one cached entry: `raw.usage` is the weekly credits body,
 * `raw.billing` the monthly one. Their periods stay separate (see
 * mergeXaiBillingSummaries); a missing body yields no billing.
 */
export const buildXaiQuotaResult = ({ entry, meta }: UsageCacheResult): XaiQuotaResult => {
  const summary = mergeXaiBillingSummaries(
    summarizeBillingBody(entry.raw.usage),
    summarizeBillingBody(entry.raw.billing)
  );
  const plan = parseXaiSubscriptionPlan(entry.raw.subscription);
  return {
    billing: summary && plan ? { ...summary, planLabel: plan.label, planTier: plan.tier } : summary,
    usage: meta,
  };
};

const loadXaiQuota =
  (mode: UsageLoadMode) =>
  async (file: AuthFileItem, t: TFunction, previous?: XaiQuotaState): Promise<XaiQuotaResult> => {
    if (isPaidXaiAuthFile(file)) return fetchXaiPaidHealth(file, t);
    return buildXaiQuotaResult(
      await loadUsageEntry(file, t, 'xai_quota', mode, {
        previousFetchedAtMs: previous?.usage?.fetchedAtMs,
      })
    );
  };

export const XAI_CONFIG: QuotaProviderData<XaiQuotaState, XaiQuotaResult> = {
  type: 'xai',
  i18nPrefix: 'xai_quota',
  filterFn: (file) => isXaiFile(file) && !isDisabledAuthFile(file),
  fetchQuota: loadXaiQuota('cached'),
  refreshQuota: loadXaiQuota('refresh'),
  // The paid probe sends a chat completion, so it only runs on an explicit click.
  skipAutoLoad: isPaidXaiAuthFile,
  storeSelector: (state) => state.xaiQuota,
  storeSetter: 'setXaiQuota',
  buildLoadingState: () => ({ status: 'loading', billing: null }),
  buildSuccessState: ({ billing, usage }) => ({ status: 'success', billing, usage }),
  buildErrorState: (message, status) => ({
    status: 'error',
    billing: null,
    error: message,
    errorStatus: status,
  }),
};
