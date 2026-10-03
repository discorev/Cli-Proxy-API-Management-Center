import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  CODEX_CONFIG,
  buildCodexQuotaWindows,
  normalizeCodexAccountCredits,
} from '@/features/quota/providers/codex/data';
import type { CodexQuotaState, CodexUsagePayload } from '@/types';
import { apiCallApi, apiClient } from '@/services/api';
import { normalizeCodexResetCreditsPayload, parseCodexUsagePayload } from '@/utils/quota';

const t = ((key: string) => key) as TFunction;
const originalApiCallRequest = apiCallApi.request;
const originalGet = apiClient.get.bind(apiClient);

/** Serves one cached usage entry; any direct upstream call fails the test. */
const serveUsage = (raw: Record<string, unknown>, resets: unknown = null) => {
  const requests: { url: string; params?: unknown }[] = [];
  apiCallApi.request = async () => {
    throw new Error('Codex quota must not call upstream through api-call');
  };
  apiClient.get = (async (url: string, config?: { params?: unknown }) => {
    requests.push({ url, params: config?.params });
    return [
      {
        auth_index: 'codex:1',
        auth_id: 'codex.json',
        provider: 'codex',
        raw,
        resets,
        fetched_at: '2026-10-02T10:00:00Z',
        next_fetch_at: '2026-10-02T10:03:00Z',
        last_error: '',
      },
    ];
  }) as typeof apiClient.get;
  return requests;
};

const CURRENT_CODEX_USAGE_PAYLOAD: CodexUsagePayload = {
  plan_type: 'pro',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 1,
      limit_window_seconds: 604800,
      reset_after_seconds: 601888,
      reset_at: 1785902974,
    },
    secondary_window: null,
  },
  code_review_rate_limit: null,
  additional_rate_limits: [
    {
      limit_name: 'GPT-5.3-Codex-Spark',
      metered_feature: 'codex_bengalfox',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 0,
          limit_window_seconds: 604800,
          reset_after_seconds: 602111,
          reset_at: 1785903197,
        },
        secondary_window: null,
      },
    },
  ],
  rate_limit_reset_credits: {
    available_count: 1,
    applicable_available_count: 0,
  },
};

afterEach(() => {
  apiCallApi.request = originalApiCallRequest;
  apiClient.get = originalGet;
});

describe('Codex current usage payload', () => {
  test('parses the proxied JSON body and classifies both primary weekly windows', () => {
    const payload = parseCodexUsagePayload(JSON.stringify(CURRENT_CODEX_USAGE_PAYLOAD));
    expect(payload).not.toBeNull();

    const windows = buildCodexQuotaWindows(payload!, t);

    expect(windows.map(({ id }) => id)).toEqual(['weekly', 'gpt-5-3-codex-spark-weekly-0']);
    expect(windows.map(({ labelKey }) => labelKey)).toEqual([
      'codex_quota.secondary_window',
      'codex_quota.additional_secondary_window',
    ]);
    expect(windows.map(({ usedPercent }) => usedPercent)).toEqual([1, 0]);
    expect(windows[1]?.labelParams).toEqual({ name: 'GPT-5.3-Codex-Spark' });
  });

  test('shows reset support when total credits remain but none currently apply', () => {
    const summary = normalizeCodexResetCreditsPayload(
      CURRENT_CODEX_USAGE_PAYLOAD.rate_limit_reset_credits
    );

    expect(summary.invalidPayload).toBeFalse();
    expect(summary.availableCount).toBe(1);
    expect(summary.applicableAvailableCount).toBe(0);

    const quota: CodexQuotaState = {
      status: 'success',
      windows: [],
      rateLimitResetCreditsAvailableCount: summary.availableCount,
      rateLimitResetCreditsApplicableAvailableCount: summary.applicableAvailableCount,
    };
    expect(CODEX_CONFIG.canResetQuota?.(quota)).toBeTrue();
  });

  test('keeps reset support for legacy payloads without applicable count', () => {
    const quota: CodexQuotaState = {
      status: 'success',
      windows: [],
      rateLimitResetCreditsAvailableCount: 1,
    };

    expect(CODEX_CONFIG.canResetQuota?.(quota)).toBeTrue();
  });
});

describe('Codex account credits', () => {
  test('normalizes remaining balance without confusing it with manual resets', () => {
    expect(
      normalizeCodexAccountCredits({ has_credits: false, unlimited: false, balance: '0' })
    ).toEqual({ balance: '0', unlimited: false });
    expect(
      normalizeCodexAccountCredits({ has_credits: true, unlimited: false, balance: ' 12.50 ' })
    ).toEqual({ balance: '12.50', unlimited: false });
    expect(normalizeCodexAccountCredits({ unlimited: true, balance: null })).toEqual({
      balance: null,
      unlimited: true,
    });
    expect(normalizeCodexAccountCredits(null)).toEqual({ balance: null, unlimited: false });
    expect(normalizeCodexAccountCredits({ balance: 'not available' })).toEqual({
      balance: null,
      unlimited: false,
    });
    expect(normalizeCodexAccountCredits({ balance: -1 })).toEqual({
      balance: null,
      unlimited: false,
    });
  });

  test('reads credits from the cached usage body and forwards them into quota state', async () => {
    const requests = serveUsage(
      {
        usage: {
          ...CURRENT_CODEX_USAGE_PAYLOAD,
          credits: { has_credits: true, unlimited: false, balance: '8.75' },
        },
        reset_credits: { available_count: 1, credits: [] },
      },
      { credits: [{ id: 'c1', expires_at: '2026-10-03T12:00:00Z' }] }
    );

    const data = await CODEX_CONFIG.fetchQuota(
      { name: 'codex.json', type: 'codex', auth_index: 'codex:1' },
      t
    );
    const state = CODEX_CONFIG.buildSuccessState(data);
    expect(state.creditBalance).toBe('8.75');
    expect(state.creditsUnlimited).toBeFalse();
    expect(state.rateLimitResetCreditsAvailableCount).toBe(1);
    expect(requests).toEqual([{ url: '/credentials/usage', params: { auth_index: 'codex:1' } }]);
  });
});

describe('Codex reset availability comes from the backend inventory', () => {
  const staleRaw = {
    usage: CURRENT_CODEX_USAGE_PAYLOAD,
    reset_credits: {
      available_count: 2,
      credits: [
        {
          id: 'stale',
          reset_type: 'codex_rate_limits',
          status: 'available',
          granted_at: '2026-10-01T12:00:00Z',
          expires_at: '2026-10-03T12:00:00Z',
        },
      ],
    },
  };
  const file = { name: 'codex.json', type: 'codex', auth_index: 'codex:1' };

  test('stale raw reset credits with resets: null are unknown and not spendable', async () => {
    serveUsage(staleRaw, null);
    const state = CODEX_CONFIG.buildSuccessState(await CODEX_CONFIG.fetchQuota(file, t));
    expect(state.resetInventoryKnown).toBeFalse();
    expect(state.rateLimitResetCreditsAvailableCount).toBeNull();
    expect(state.rateLimitResetCreditsApplicableAvailableCount).toBeNull();
    expect(state.rateLimitResetCredits).toEqual([]);
    expect(CODEX_CONFIG.canResetQuota?.(state)).toBeFalse();
  });

  test('the inventory decides; the raw body only adds granted-at', async () => {
    serveUsage(staleRaw, {
      credits: [{ id: 'stale', expires_at: '2026-10-03T12:00:00Z' }],
    });
    const state = CODEX_CONFIG.buildSuccessState(await CODEX_CONFIG.fetchQuota(file, t));
    expect(state.rateLimitResetCreditsAvailableCount).toBe(1);
    expect(state.rateLimitResetCredits).toEqual([
      {
        id: 'stale',
        status: 'available',
        grantedAt: '2026-10-01T12:00:00Z',
        expiresAt: '2026-10-03T12:00:00Z',
      },
    ]);
    expect(CODEX_CONFIG.canResetQuota?.(state)).toBeTrue();

    // An empty inventory (credits omitted) is known: zero, not unknown.
    serveUsage(staleRaw, {});
    const empty = CODEX_CONFIG.buildSuccessState(await CODEX_CONFIG.fetchQuota(file, t));
    expect(empty.resetInventoryKnown).toBeTrue();
    expect(empty.rateLimitResetCreditsAvailableCount).toBe(0);
    expect(CODEX_CONFIG.canResetQuota?.(empty)).toBeFalse();
  });
});

describe('Codex subscription renewal from the usage cache', () => {
  test('prefers the cached subscription active_until', async () => {
    serveUsage({
      usage: CURRENT_CODEX_USAGE_PAYLOAD,
      subscription: { active_until: '2026-10-03T13:27:01Z' },
      reset_credits: { available_count: 0, credits: [] },
    });

    const quota = await CODEX_CONFIG.fetchQuota(
      {
        name: 'codex.json',
        type: 'codex',
        auth_index: 'codex:1',
        chatgpt_subscription_active_until: '2026-09-03T13:27:01Z',
      },
      t
    );

    expect(quota.subscriptionActiveUntil).toBe('2026-10-03T13:27:01Z');
  });

  test('falls back to the credential date when no subscription body is cached', async () => {
    serveUsage({ usage: CURRENT_CODEX_USAGE_PAYLOAD });

    const quota = await CODEX_CONFIG.fetchQuota(
      {
        name: 'codex.json',
        type: 'codex',
        auth_index: 'codex:1',
        chatgpt_subscription_active_until: '2026-09-03T13:27:01Z',
      },
      t
    );

    expect(quota.subscriptionActiveUntil).toBe('2026-09-03T13:27:01Z');
    expect(quota.rateLimitResetCreditsError).toBe('');
  });
});
