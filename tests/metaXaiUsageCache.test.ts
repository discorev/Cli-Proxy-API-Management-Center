/**
 * Meta and xAI (Grok subscription) quota read the backend usage cache, like
 * Claude and Codex: a cached GET on page load, a refresh POST on Refresh, and
 * never a direct upstream request from the browser.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { apiCallApi } from '@/services/api/apiCall';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import { META_CONFIG } from '@/features/quota/providers/meta/data';
import { XAI_CONFIG } from '@/features/quota/providers/xai/data';
import { selectAutoLoadTargets } from '@/features/quota/hooks/useQuotaAutoLoad';
import { toQuotaRowModel } from '@/features/quota/rowModel';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { MetaQuotaState, XaiQuotaState } from '@/types';
import { metaQuotaResponse } from './fixtures/metaQuota';

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key) as TFunction;
const originalGet = apiClient.get.bind(apiClient);
const originalPost = apiClient.post.bind(apiClient);
const originalApiCall = apiCallApi.request;
const originalDownload = authFilesApi.downloadText;

const NOW = Date.parse('2026-10-15T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const metaFile = { name: 'meta.json', type: 'meta', auth_index: 'meta:1' };
const xaiFile = { name: 'xai.json', type: 'xai', auth_index: 'xai:1' };

const entry = (authIndex: string, overrides: Record<string, unknown> = {}) => ({
  auth_index: authIndex,
  auth_id: `${authIndex}.json`,
  provider: authIndex.split(':')[0],
  raw: {},
  resets: null,
  windows: [],
  refreshing: false,
  last_error: '',
  ...overrides,
});

type Call = { method: 'GET' | 'POST'; url: string; body?: unknown; params?: unknown };

const stubBackend = (respond: (call: Call) => unknown) => {
  const calls: Call[] = [];
  apiCallApi.request = async () => {
    throw new Error('usage-cache providers must not use api-call');
  };
  authFilesApi.downloadText = async () => {
    throw new Error('usage-cache providers must not download auth files');
  };
  apiClient.get = (async (url: string, config?: { params?: unknown }) => {
    const call: Call = { method: 'GET', url, params: config?.params };
    calls.push(call);
    return respond(call);
  }) as typeof apiClient.get;
  apiClient.post = (async (url: string, body?: unknown) => {
    const call: Call = { method: 'POST', url, body };
    calls.push(call);
    return respond(call);
  }) as typeof apiClient.post;
  return calls;
};

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.post = originalPost;
  apiCallApi.request = originalApiCall;
  authFilesApi.downloadText = originalDownload;
});

/** The backend's sanitized subset of the Muse key response. */
const metaUsage = {
  subs_tier_name: metaQuotaResponse.subs_tier_name,
  subs_tier_id: metaQuotaResponse.subs_tier_id,
  is_subs_active: metaQuotaResponse.is_subs_active,
  subs_usage: metaQuotaResponse.subs_usage,
};

describe('Meta usage cache', () => {
  test('page load reads the cache; Refresh posts to the refresh route', async () => {
    const calls = stubBackend(() => [
      entry('meta:1', {
        raw: { usage: metaUsage },
        fetched_at: iso(NOW - 60_000),
        next_fetch_at: iso(NOW + 120_000),
      }),
    ]);

    const cached = await META_CONFIG.fetchQuota(metaFile, t);
    const refreshed = await META_CONFIG.refreshQuota!(metaFile, t);

    expect(calls).toEqual([
      { method: 'GET', url: '/credentials/usage', params: { auth_index: 'meta:1' } },
      { method: 'POST', url: '/credentials/usage/refresh', body: { auth_index: 'meta:1' } },
    ]);
    for (const result of [cached, refreshed]) {
      expect(result.data).toEqual({
        planName: 'Muse Code Everyday Usage',
        isSubscriptionActive: true,
        windows: [
          { id: 'window', usedPercent: 2, resetAt: 1789678120, durationMinutes: 300 },
          { id: 'weekly', usedPercent: 0, resetAt: 1789948800 },
        ],
      });
      expect(result.usage.fetchedAtMs).toBe(NOW - 60_000);
    }
  });

  test('a refresh answered from cache is deferred and keeps its error note', async () => {
    stubBackend(() => [
      entry('meta:1', {
        raw: { usage: metaUsage },
        fetched_at: iso(NOW - 60_000),
        next_fetch_at: iso(NOW + 120_000),
        last_error: 'meta usage: upstream 503',
      }),
    ]);
    const previous = META_CONFIG.buildSuccessState(await META_CONFIG.fetchQuota(metaFile, t));

    const state = META_CONFIG.buildSuccessState(
      await META_CONFIG.refreshQuota!(metaFile, t, previous)
    );

    expect(state.usage).toMatchObject({
      fetchAdvanced: false,
      lastError: 'meta usage: upstream 503',
      notFetched: false,
    });
    expect(state.usage?.deferredUntilMs).toBe(NOW + 120_000);
  });

  test('null subs_usage keeps the plan and leaves both windows unknown', async () => {
    stubBackend(() => [
      entry('meta:1', {
        raw: { usage: { subs_tier_name: 'Muse Code Power Usage', subs_usage: null } },
        fetched_at: iso(NOW),
      }),
    ]);

    const state = META_CONFIG.buildSuccessState(await META_CONFIG.fetchQuota(metaFile, t));
    const model = toQuotaRowModel('meta', state, t);

    expect(model?.plan).toBe('Muse Code Power Usage');
    expect(model?.windows.map((window) => window.remainingPercent)).toEqual([null, null]);
    expect(model?.message).toBe('meta_quota.empty_data');
  });

  test('a never-fetched credential says so instead of showing unknown quota', async () => {
    stubBackend(() => [entry('meta:1')]);

    const state: MetaQuotaState = META_CONFIG.buildSuccessState(
      await META_CONFIG.fetchQuota(metaFile, t)
    );

    expect(state.data).toBeUndefined();
    expect(state.usage?.notFetched).toBe(true);
    expect(toQuotaRowModel('meta', state, t)?.message).toBe('credential_usage.not_fetched');
  });

  test('a cooldown with no cached body is an error note, not never-fetched', async () => {
    stubBackend(() => [
      entry('meta:1', { cooldown_until: iso(NOW + 600_000), last_error: 'rate limited' }),
    ]);

    const state = META_CONFIG.buildSuccessState(await META_CONFIG.fetchQuota(metaFile, t));

    expect(state.usage).toMatchObject({ notFetched: false, cooldownUntilMs: NOW + 600_000 });
    expect(toQuotaRowModel('meta', state, t)?.message).toBe('meta_quota.empty_data');
  });
});

/** Live weekly shape: protobuf JSON omits the zero creditUsagePercent. */
const weeklyBody = (extra: Record<string, unknown> = {}) => ({
  config: {
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-10-12T00:00:00Z',
      end: '2026-10-19T00:00:00Z',
    },
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
    billingPeriodStart: '2026-10-12T00:00:00Z',
    billingPeriodEnd: '2026-10-19T00:00:00Z',
    ...extra,
  },
});

const monthlyBody = {
  config: {
    monthlyLimit: { val: 15000 },
    used: { val: 3000 },
    onDemandCap: { val: 0 },
    billingPeriodStart: '2026-10-01T00:00:00Z',
    billingPeriodEnd: '2026-11-01T00:00:00Z',
    history: [],
  },
};

describe('xAI usage cache', () => {
  test('reads weekly, monthly and plan from one entry; Refresh posts', async () => {
    const calls = stubBackend(() => [
      entry('xai:1', {
        raw: {
          usage: weeklyBody({
            creditUsagePercent: 42,
            productUsage: [{ product: 'GrokBuild', usagePercent: 40 }],
          }),
          billing: monthlyBody,
          subscription: {
            subscriptionTier: 'SuperGrokPro',
            subscriptionTierDisplay: 'SuperGrok Heavy',
          },
        },
        fetched_at: iso(NOW),
      }),
    ]);

    const cached = await XAI_CONFIG.fetchQuota(xaiFile, t);
    const refreshed = await XAI_CONFIG.refreshQuota!(xaiFile, t);

    expect(calls).toEqual([
      { method: 'GET', url: '/credentials/usage', params: { auth_index: 'xai:1' } },
      { method: 'POST', url: '/credentials/usage/refresh', body: { auth_index: 'xai:1' } },
    ]);
    for (const result of [cached, refreshed]) {
      expect(result.billing).toMatchObject({
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: 42,
        // The weekly window keeps its own dates and reset.
        periodStart: '2026-10-12T00:00:00Z',
        periodEnd: '2026-10-19T00:00:00Z',
        resetAtMs: Date.parse('2026-10-19T00:00:00Z'),
        periodHours: 168,
        productUsage: [{ product: 'GrokBuild', usagePercent: 40 }],
        // Monthly spending and its billing cycle come from raw.billing.
        monthlyLimitCents: 15000,
        usedCents: 3000,
        usedPercent: 20,
        planLabel: 'SuperGrok Heavy',
        planTier: 'elite',
      });
      expect(result.usage?.fetchedAtMs).toBe(NOW);
    }

    const model = toQuotaRowModel('xai', XAI_CONFIG.buildSuccessState(cached), t);
    expect(model?.plan).toBe('SuperGrok Heavy');
    const weekly = model?.windows.find((window) => window.id === 'xai:weekly');
    expect(weekly?.remainingPercent).toBe(58);
    expect(weekly?.resetAtMs).toBe(Date.parse('2026-10-19T00:00:00Z'));
    const monthly = model?.windows.find((window) => window.id === 'xai:monthly');
    expect(monthly?.remainingPercent).toBe(80);
    expect(monthly?.resetAtMs).toBe(Date.parse('2026-11-01T00:00:00Z'));
    expect(monthly?.periodHours).toBeNull();
  });

  test('an omitted weekly percentage is 0% used, not unknown', async () => {
    stubBackend(() => [entry('xai:1', { raw: { usage: weeklyBody() }, fetched_at: iso(NOW) })]);

    const result = await XAI_CONFIG.fetchQuota(xaiFile, t);

    expect(result.billing?.usagePercent).toBe(0);
    const model = toQuotaRowModel('xai', XAI_CONFIG.buildSuccessState(result), t);
    expect(model?.windows.find((window) => window.id === 'xai:weekly')?.remainingPercent).toBe(100);
  });

  test('the plan accepts snake_case keys and is absent without a subscription', async () => {
    stubBackend(() => [
      entry('xai:1', {
        raw: { usage: weeklyBody(), subscription: { subscription_tier: 'SuperGrok' } },
        fetched_at: iso(NOW),
      }),
    ]);
    const withPlan = await XAI_CONFIG.fetchQuota(xaiFile, t);
    expect(withPlan.billing).toMatchObject({ planLabel: 'SuperGrok', planTier: 'premium' });

    stubBackend(() => [entry('xai:1', { raw: { usage: weeklyBody() }, fetched_at: iso(NOW) })]);
    const withoutPlan = await XAI_CONFIG.fetchQuota(xaiFile, t);
    expect(withoutPlan.billing?.planLabel).toBeUndefined();
  });

  test('a never-fetched credential says so and does not probe upstream', async () => {
    stubBackend(() => [entry('xai:1')]);

    const state: XaiQuotaState = XAI_CONFIG.buildSuccessState(
      await XAI_CONFIG.fetchQuota(xaiFile, t)
    );

    expect(state.billing).toBeNull();
    expect(state.usage?.notFetched).toBe(true);
    expect(toQuotaRowModel('xai', state, t)?.message).toBe('credential_usage.not_fetched');
  });

  test('a missing cache entry is an error', async () => {
    stubBackend(() => []);
    await expect(XAI_CONFIG.fetchQuota(xaiFile, t)).rejects.toThrow('xai_quota.empty_windows');
  });
});

describe('auto-load', () => {
  test('auto-loads Meta and xAI but not paid xAI credentials', () => {
    const entries: QuotaFileEntry[] = [
      { type: 'meta', file: metaFile },
      { type: 'xai', file: xaiFile },
      {
        type: 'xai',
        file: {
          name: 'paid.json',
          type: 'xai',
          auth_index: 'xai:2',
          using_api: true,
          prefix: 'paid',
        },
      },
    ];
    const targets = selectAutoLoadTargets(entries, new Set(), {
      session: 0,
      fileGenerations: {},
      statusOf: () => undefined,
    });
    expect(targets.map(({ file }) => file.name)).toEqual(['meta.json', 'xai.json']);
  });
});
