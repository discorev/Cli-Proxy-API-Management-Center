/**
 * Claude quota data layer: usage windows, plan, extra usage and reset grants,
 * parsed from the backend usage cache (never fetched from upstream here).
 * React-free / SCSS-free; consumed directly by tests.
 */

import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  ClaudeExtraUsage,
  ClaudeProfileResponse,
  ClaudeQuotaState,
  ClaudeQuotaWindow,
  ClaudeUsagePayload,
  QuotaUsageMeta,
} from '@/types';
import {
  parseAnthropicResetGrantStatus,
  type AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import {
  CLAUDE_USAGE_WINDOW_KEYS,
  claudePeriodHours,
  normalizeNumberValue,
  normalizeStringValue,
  parseClaudeUsagePayload,
  formatQuotaResetTime,
  resolveResetMs,
  isClaudeFile,
  isDisabledAuthFile,
} from '@/utils/quota';
import type { QuotaProviderData, QuotaResetOutcome } from '../types';
import {
  loadUsageEntry,
  resetUsageEntry,
  type UsageCacheResult,
  type UsageLoadMode,
} from '../usageCache';
import { claudeLiveRowId, overlayLiveWindows } from '../liveWindows';

export type ClaudeQuotaData = {
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
  resetGrants: AnthropicResetGrantStatus | null;
  usage: QuotaUsageMeta;
};

const findFableUsageLimit = (payload: ClaudeUsagePayload) => {
  if (!Array.isArray(payload.limits)) return null;

  const candidates = payload.limits.filter((limit) => {
    const kind = (normalizeStringValue(limit?.kind) ?? '').trim().toLowerCase();
    const modelName = (normalizeStringValue(limit?.scope?.model?.display_name) ?? '')
      .trim()
      .toLowerCase();
    const isFable = modelName === 'fable' || modelName === 'fable 5';
    return kind === 'weekly_scoped' && isFable && normalizeNumberValue(limit?.percent) !== null;
  });

  return candidates.find((limit) => limit.is_active === true) ?? candidates[0] ?? null;
};

export const buildClaudeQuotaWindows = (
  payload: ClaudeUsagePayload,
  t: TFunction
): ClaudeQuotaWindow[] => {
  const windows: ClaudeQuotaWindow[] = [];
  const fableLimit = findFableUsageLimit(payload);

  for (const { key, id, labelKey } of CLAUDE_USAGE_WINDOW_KEYS) {
    if (key === 'iguana_necktie' && fableLimit) continue;
    const window = payload[key as keyof ClaudeUsagePayload];
    if (!window || typeof window !== 'object' || !('utilization' in window)) continue;
    const typedWindow = window as { utilization: number; resets_at: string | null };
    const usedPercent = normalizeNumberValue(typedWindow.utilization);
    const resetLabel = formatQuotaResetTime(typedWindow.resets_at ?? undefined);
    windows.push({
      id,
      label: t(labelKey),
      labelKey,
      usedPercent,
      resetLabel,
      // Claude states the period nowhere in the payload, so it comes from the
      // key: `five_hour` is the rolling window, everything else is weekly.
      resetAtMs: resolveResetMs([typedWindow.resets_at]),
      periodHours: claudePeriodHours(key),
    });
  }

  if (fableLimit) {
    const usedPercent = normalizeNumberValue(fableLimit.percent);
    if (usedPercent !== null) {
      windows.push({
        id: 'seven-day-fable',
        label: t('claude_quota.seven_day_fable'),
        labelKey: 'claude_quota.seven_day_fable',
        usedPercent,
        resetLabel: formatQuotaResetTime(fableLimit.resets_at ?? undefined),
        // `weekly_scoped` is a 7-day window by definition, so the timeline can
        // place this row alongside the ones derived from the named keys.
        resetAtMs: resolveResetMs([fableLimit.resets_at]),
        periodHours: claudePeriodHours('seven_day'),
      });
    }
  }

  return windows;
};

const normalizeFlagValue = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return undefined;
};

const parseClaudeProfilePayload = (payload: unknown): ClaudeProfileResponse | null => {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as ClaudeProfileResponse;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as ClaudeProfileResponse;
  }
  return null;
};

export const resolveClaudePlanType = (profile: ClaudeProfileResponse | null): string | null => {
  if (!profile) return null;

  const organizationType = normalizeStringValue(
    profile.organization?.organization_type
  )?.toLowerCase();
  const subscriptionStatus = normalizeStringValue(
    profile.organization?.subscription_status
  )?.toLowerCase();

  if (organizationType === 'claude_team' && subscriptionStatus === 'active') {
    return 'plan_team';
  }

  // Account flags include personal subscriptions even for a Team-scoped token.
  const hasClaudeMax = normalizeFlagValue(profile.account?.has_claude_max);
  if (hasClaudeMax) return 'plan_max';

  const hasClaudePro = normalizeFlagValue(profile.account?.has_claude_pro);
  if (hasClaudePro) return 'plan_pro';

  if (hasClaudeMax === false && hasClaudePro === false) return 'plan_free';

  return null;
};

/**
 * Builds quota data from one cached entry. A missing usage body yields no windows;
 * header-observed windows newer than the body update its usage rows.
 * Grant status comes from the backend's parsed inventory (entry.resets), never the
 * raw usage body, so a stale body cannot offer a claim.
 */
export const buildClaudeQuotaData = (
  { entry, meta }: UsageCacheResult,
  t: TFunction
): ClaudeQuotaData => {
  const payload = entry.raw.usage === undefined ? null : parseClaudeUsagePayload(entry.raw.usage);
  return {
    windows: payload
      ? overlayLiveWindows(buildClaudeQuotaWindows(payload, t), entry, claudeLiveRowId)
      : [],
    extraUsage: payload?.extra_usage,
    planType: resolveClaudePlanType(parseClaudeProfilePayload(entry.raw.profile)),
    resetGrants: parseAnthropicResetGrantStatus(entry.resets?.body ?? null),
    usage: meta,
  };
};

const loadClaudeQuota =
  (mode: UsageLoadMode) =>
  async (file: AuthFileItem, t: TFunction, previous?: ClaudeQuotaState): Promise<ClaudeQuotaData> =>
    buildClaudeQuotaData(
      await loadUsageEntry(file, t, 'claude_quota', mode, {
        previousFetchedAtMs: previous?.usage?.fetchedAtMs,
      }),
      t
    );

/** Spends the chosen reset grant through the backend and returns the refreshed card data. */
export const resetClaudeGrant = async (
  file: AuthFileItem,
  grantId: string,
  t: TFunction,
  previous?: ClaudeQuotaState
): Promise<QuotaResetOutcome<ClaudeQuotaData>> => {
  const { code, result, nextFetchAtMs } = await resetUsageEntry(file, t, 'claude_quota', {
    grantId,
    previousFetchedAtMs: previous?.usage?.fetchedAtMs,
  });
  return { code, nextFetchAtMs, data: result ? buildClaudeQuotaData(result, t) : null };
};

export const CLAUDE_CONFIG: QuotaProviderData<ClaudeQuotaState, ClaudeQuotaData> = {
  type: 'claude',
  i18nPrefix: 'claude_quota',
  filterFn: (file) => isClaudeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: loadClaudeQuota('cached'),
  refreshQuota: loadClaudeQuota('refresh'),
  storeSelector: (state) => state.claudeQuota,
  storeSetter: 'setClaudeQuota',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    extraUsage: data.extraUsage,
    planType: data.planType,
    resetGrants: data.resetGrants,
    usage: data.usage,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status,
  }),
};
