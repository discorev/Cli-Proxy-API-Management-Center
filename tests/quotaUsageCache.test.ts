import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { apiCallApi } from '../src/services/api/apiCall';
import { apiClient } from '../src/services/api/client';
import { CLAUDE_CONFIG, resetClaudeGrant } from '../src/features/quota/providers/claude/data';
import { CODEX_CONFIG } from '../src/features/quota/providers/codex/data';
import { REFRESH_CLOCK_SKEW_MS, loadUsageEntry } from '../src/features/quota/providers/usageCache';
import { QUOTA_ADAPTERS, selectQuotaLoader } from '../src/features/quota/providers';
import { AUTO_LOAD_QUOTA_TYPES } from '../src/features/quota/hooks/useQuotaAutoLoad';
import { describeUsageNotes, formatUsageNoteTime } from '../src/features/quota/usageNote';
import {
  describeCodexResetOutcome,
  resetOutcomeText,
  resetOutcomeType,
} from '../src/features/quota/resetOutcome';
import { captureResetSession, settleResetOutcome } from '../src/features/quota/resetSession';
import { toQuotaRowModel } from '../src/features/quota/rowModel';
import { useQuotaStore } from '../src/stores/useQuotaStore';
import type { QuotaUsageMeta } from '../src/types';
import cedarEmberUsage from './fixtures/claudeUsageCedarEmber.json';

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key) as TFunction;
const originalGet = apiClient.get.bind(apiClient);
const originalPost = apiClient.post.bind(apiClient);
const originalApiCall = apiCallApi.request;

const NOW = Date.parse('2026-10-02T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const claudeFile = { name: 'claude-max.json', type: 'claude', auth_index: 'claude:1' };
const codexFile = { name: 'codex.json', type: 'codex', auth_index: 'codex:1' };

/** Backend shape at 588519b2: unset timestamps are omitted, `resets` is always sent. */
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
});

describe('usage-cache loader transport', () => {
  test('page load reads the cache; Refresh posts to the refresh route', async () => {
    const calls = stubBackend(() => [
      entry('claude:1', {
        raw: { usage: cedarEmberUsage, profile: { account: { has_claude_max: true } } },
        resets: cedarEmberUsage.cedar_ember,
        fetched_at: iso(NOW - 60_000),
        next_fetch_at: iso(NOW + 120_000),
      }),
    ]);

    const cached = await CLAUDE_CONFIG.fetchQuota(claudeFile, t);
    const refreshed = await CLAUDE_CONFIG.refreshQuota!(claudeFile, t);

    expect(calls).toEqual([
      { method: 'GET', url: '/credentials/usage', params: { auth_index: 'claude:1' } },
      { method: 'POST', url: '/credentials/usage/refresh', body: { auth_index: 'claude:1' } },
    ]);
    for (const data of [cached, refreshed]) {
      expect(data.windows.map((window) => window.id)).toEqual([
        'five-hour',
        'seven-day',
        'seven-day-fable',
      ]);
      expect(data.planType).toBe('plan_max');
      expect(data.resetGrants?.grants[0].id).toBe('opus55-launch-promax-20260921');
    }
  });

  test('Codex reads usage, subscription and reset credits from one cached entry', async () => {
    const calls = stubBackend(() => [
      entry('codex:1', {
        raw: {
          usage: {
            plan_type: 'pro',
            rate_limit: {
              primary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: 1 },
            },
          },
          subscription: { active_until: '2026-11-01T00:00:00Z' },
          reset_credits: {
            available_count: 1,
            credits: [
              {
                id: 'credit-1',
                reset_type: 'codex_rate_limits',
                status: 'available',
                expires_at: '2026-10-03T12:00:00Z',
              },
            ],
          },
        },
        resets: { credits: [{ id: 'credit-1', expires_at: '2026-10-03T12:00:00Z' }] },
        fetched_at: iso(NOW),
      }),
    ]);
    const data = await CODEX_CONFIG.fetchQuota(codexFile, t);
    expect(calls).toHaveLength(1);
    expect(data.planType).toBe('pro');
    expect(data.subscriptionActiveUntil).toBe('2026-11-01T00:00:00Z');
    expect(data.rateLimitResetCreditsAvailableCount).toBe(1);
    expect(data.rateLimitResetCredits.map((credit) => credit.id)).toEqual(['credit-1']);
    expect(CODEX_CONFIG.canResetQuota?.(CODEX_CONFIG.buildSuccessState(data))).toBeTrue();
  });

  test('a never-fetched credential is a neutral success, not an error', async () => {
    stubBackend(() => [entry('codex:2')]);
    const data = await CODEX_CONFIG.fetchQuota({ ...codexFile, auth_index: 'codex:2' }, t);
    expect(data.windows).toEqual([]);
    expect(data.usage.notFetched).toBeTrue();
    const model = toQuotaRowModel('codex', CODEX_CONFIG.buildSuccessState(data), t);
    expect(model?.message).toBe('credential_usage.not_fetched');
  });

  test('without prior state, a refresh falls back to the clock to spot a cache hit', async () => {
    const options = { now: () => NOW };
    stubBackend(() => [
      entry('codex:1', { fetched_at: iso(NOW - 120_000), next_fetch_at: iso(NOW + 60_000) }),
    ]);
    const deferred = await loadUsageEntry(codexFile, t, 'codex_quota', 'refresh', options);
    expect(deferred.meta.deferredUntilMs).toBe(NOW + 60_000);
    expect(deferred.meta.fetchAdvanced).toBeFalse();

    stubBackend(() => [
      entry('codex:1', {
        fetched_at: iso(NOW + 1_000 - REFRESH_CLOCK_SKEW_MS),
        next_fetch_at: iso(NOW + 180_000),
      }),
    ]);
    const fresh = await loadUsageEntry(codexFile, t, 'codex_quota', 'refresh', options);
    expect(fresh.meta.deferredUntilMs).toBeNull();
    expect(fresh.meta.fetchAdvanced).toBeTrue();

    // A plain page-load read never claims a deferred refresh.
    stubBackend(() => [
      entry('codex:1', { fetched_at: iso(NOW - 120_000), next_fetch_at: iso(NOW + 60_000) }),
    ]);
    const cached = await loadUsageEntry(codexFile, t, 'codex_quota', 'cached', options);
    expect(cached.meta.deferredUntilMs).toBeNull();
  });

  test('a refresh compares fetched_at with the card it replaces', async () => {
    // Fetched seconds ago (inside the clock window) but unchanged: served from cache.
    // The adapter path uses the real clock, so these instants are relative to it.
    const realNow = Date.now();
    const fetchedAt = realNow - 5_000;
    stubBackend(() => [
      entry('codex:1', { fetched_at: iso(fetchedAt), next_fetch_at: iso(realNow + 60_000) }),
    ]);
    const previous = CODEX_CONFIG.buildSuccessState(await CODEX_CONFIG.fetchQuota(codexFile, t));
    const same = await CODEX_CONFIG.refreshQuota!(codexFile, t, previous);
    expect(same.usage.deferredUntilMs).toBe(realNow + 60_000);
    expect(same.usage.fetchAdvanced).toBeFalse();

    // Advanced, even if the browser clock is far ahead of the backend's.
    stubBackend(() => [
      entry('codex:1', { fetched_at: iso(fetchedAt + 1), next_fetch_at: iso(realNow + 60_000) }),
    ]);
    const advanced = await loadUsageEntry(codexFile, t, 'codex_quota', 'refresh', {
      previousFetchedAtMs: fetchedAt,
      now: () => realNow + 3_600_000,
    });
    expect(advanced.meta.deferredUntilMs).toBeNull();
    expect(advanced.meta.fetchAdvanced).toBeTrue();

    // A never-fetched card that now has data advanced.
    const first = await loadUsageEntry(codexFile, t, 'codex_quota', 'refresh', {
      previousFetchedAtMs: null,
    });
    expect(first.meta.fetchAdvanced).toBeTrue();
  });

  test('stale raw Claude cedar_ember with resets: null offers no claim', async () => {
    stubBackend(() => [
      entry('claude:1', { raw: { usage: cedarEmberUsage }, resets: null, fetched_at: iso(NOW) }),
    ]);
    const data = await CLAUDE_CONFIG.fetchQuota(claudeFile, t);
    expect(data.windows.length).toBeGreaterThan(0);
    expect(data.resetGrants).toBeNull();
  });

  test('missing auth index fails before any request', async () => {
    const calls = stubBackend(() => []);
    await expect(CLAUDE_CONFIG.fetchQuota({ name: 'x.json', type: 'claude' }, t)).rejects.toThrow(
      'claude_quota.missing_auth_index'
    );
    expect(calls).toHaveLength(0);
  });
});

describe('usage notes', () => {
  const meta = (overrides: Partial<QuotaUsageMeta>): QuotaUsageMeta => ({
    fetchedAtMs: NOW - 60_000,
    nextFetchAtMs: null,
    cooldownUntilMs: null,
    lastError: '',
    fetchAdvanced: false,
    notFetched: false,
    deferredUntilMs: null,
    ...overrides,
  });

  test('cooldown stands alone; error and deferred refresh can combine', () => {
    expect(describeUsageNotes(undefined, NOW)).toEqual([]);
    expect(
      describeUsageNotes(
        meta({
          cooldownUntilMs: NOW + 1,
          lastError: 'upstream status 429',
          deferredUntilMs: NOW + 1,
        }),
        NOW
      )
    ).toEqual([{ kind: 'cooldown', atMs: NOW + 1 }]);
    expect(
      describeUsageNotes(
        meta({ cooldownUntilMs: NOW - 1, lastError: 'boom', deferredUntilMs: NOW + 5 }),
        NOW
      )
    ).toEqual([
      { kind: 'error', message: 'boom' },
      { kind: 'deferred', atMs: NOW + 5 },
    ]);
    expect(describeUsageNotes(meta({ deferredUntilMs: NOW - 5 }), NOW)).toEqual([]);
  });

  test('an error from a refresh that still fetched is a warning', () => {
    expect(
      describeUsageNotes(meta({ lastError: 'profile 503', fetchAdvanced: true }), NOW)
    ).toEqual([{ kind: 'warning', message: 'profile 503' }]);
  });
});

describe('backend resets', () => {
  test('Codex reset sends no grant and updates the card from the returned entry', async () => {
    const calls = stubBackend(() => ({
      result: 'reset',
      entry: entry('codex:1', {
        raw: { usage: { plan_type: 'plus' } },
        fetched_at: iso(NOW),
        next_fetch_at: iso(NOW + 180_000),
      }),
      refresh_pending: true,
      next_fetch_at: iso(NOW + 180_000),
    }));
    const outcome = await CODEX_CONFIG.resetQuota!(codexFile, t);
    expect(calls).toEqual([
      { method: 'POST', url: '/credentials/usage/reset', body: { auth_index: 'codex:1' } },
    ]);
    expect(outcome.code).toBe('reset');
    expect(outcome.data?.planType).toBe('plus');
    expect(outcome.data?.usage.deferredUntilMs).toBe(NOW + 180_000);
  });

  test('Claude claim passes the grant id; a 409 pending refresh keeps next_fetch_at', async () => {
    const calls = stubBackend(() => {
      throw Object.assign(new Error('reset pending refresh'), {
        status: 409,
        data: {
          error: 'reset pending refresh',
          refresh_pending: true,
          next_fetch_at: iso(NOW + 90_000),
        },
      });
    });
    const outcome = await resetClaudeGrant(claudeFile, 'grant-a', t);
    expect(calls[0].body).toEqual({ auth_index: 'claude:1', grant_id: 'grant-a' });
    expect(outcome).toEqual({ code: 'refresh_pending', data: null, nextFetchAtMs: NOW + 90_000 });
  });

  test('a 502 from the reset route is unknown, not failed', async () => {
    stubBackend(() => {
      throw Object.assign(new Error('bad gateway'), { status: 502, data: {} });
    });
    const outcome = await CODEX_CONFIG.resetQuota!(codexFile, t);
    expect(outcome.code).toBe('unknown');
    expect(resetOutcomeType(outcome.code)).toBe('error');
  });

  test('outcome copy and tone', () => {
    expect(resetOutcomeType('reset')).toBe('success');
    expect(resetOutcomeType('already_used')).toBe('success');
    expect(resetOutcomeType('refresh_pending')).toBe('info');
    expect(resetOutcomeType('in_flight')).toBe('info');
    for (const code of ['not_limited', 'cooldown', 'refused', 'unknown', 'auth_error'] as const) {
      expect(resetOutcomeType(code)).toBe('error');
    }
    expect(describeCodexResetOutcome(t, 'reset', 'a.json')).toEqual({
      message: 'codex_quota.reset_success {"name":"a.json"}',
      type: 'success',
    });
    expect(describeCodexResetOutcome(t, 'refresh_pending', 'a.json', NOW, 'en')).toEqual({
      message: `credential_usage.reset_outcome.refresh_pending {"time":"${formatUsageNoteTime(NOW, 'en')}"}`,
      type: 'info',
    });
    expect(resetOutcomeText(t, 'refresh_pending')).toBe(
      'credential_usage.reset_outcome.refresh_pending_later'
    );
    expect(describeCodexResetOutcome(t, 'rate_limited', 'a.json')).toEqual({
      message:
        'codex_quota.reset_failed {"name":"a.json","message":"credential_usage.reset_outcome.rate_limited"}',
      type: 'error',
    });
  });
});

describe('reset outcome delivery', () => {
  beforeEach(() => useQuotaStore.getState().clearQuotaCache());

  const settle = (session: ReturnType<typeof captureResetSession>) => {
    const done: string[] = [];
    settleResetOutcome(
      session,
      () => done.push('card'),
      () => done.push('toast')
    );
    return done;
  };

  test('a file cache bump skips the card update but still shows the toast', () => {
    const session = captureResetSession('codex.json');
    useQuotaStore.getState().clearQuotaCache(['codex.json']);
    expect(settle(session)).toEqual(['toast']);
  });

  test('a new session drops both', () => {
    const session = captureResetSession('codex.json');
    useQuotaStore.getState().clearQuotaCache();
    expect(settle(session)).toEqual([]);
  });

  test('an unchanged session applies both', () => {
    expect(settle(captureResetSession('codex.json'))).toEqual(['card', 'toast']);
  });
});

describe('page load versus Refresh all', () => {
  test('only Devin, Claude and Codex auto-load', () => {
    expect([...AUTO_LOAD_QUOTA_TYPES].sort()).toEqual(['claude', 'codex', 'devin']);
  });

  test('the batch loader reads the cache by default and refreshes on request', async () => {
    for (const type of ['claude', 'codex'] as const) {
      const adapter = QUOTA_ADAPTERS[type];
      expect(selectQuotaLoader(adapter)).toBe(adapter.fetchQuota);
      expect(selectQuotaLoader(adapter, true)).toBe(adapter.refreshQuota!);
    }
    // Providers without a refresh path refresh through their read.
    expect(selectQuotaLoader(QUOTA_ADAPTERS.kimi, true)).toBe(QUOTA_ADAPTERS.kimi.fetchQuota);

    const calls = stubBackend(() => [entry('codex:1', { fetched_at: iso(NOW) })]);
    await selectQuotaLoader(QUOTA_ADAPTERS.codex)(codexFile, t);
    await selectQuotaLoader(QUOTA_ADAPTERS.codex, true)(codexFile, t);
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /credentials/usage',
      'POST /credentials/usage/refresh',
    ]);
  });

  test('the batch loader hook routes through selectQuotaLoader with prior state', async () => {
    const source = await Bun.file('src/features/quota/hooks/useQuotaBatchLoader.ts').text();
    expect(source).toContain('selectQuotaLoader(adapter, options.refresh)');
    expect(source).toContain('load(file, t, previousStates[cacheKey])');
  });
});

test('Claude and Codex data modules no longer reach upstream directly', async () => {
  for (const path of [
    'src/features/quota/providers/claude/data.ts',
    'src/features/quota/providers/codex/data.ts',
    'src/features/quota/providers/claude/ClaudeResetGrants.tsx',
    'src/services/api/claudeResetGrants.ts',
  ]) {
    const source = await Bun.file(path).text();
    expect(source).not.toContain('apiCall');
    expect(source).not.toMatch(/https:\/\/(api\.anthropic|chatgpt)\.com/);
  }
});
