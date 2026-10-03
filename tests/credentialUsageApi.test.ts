import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import {
  credentialUsageApi,
  mapCredentialResetError,
  normalizeCredentialResetResponse,
  normalizeCredentialUsageList,
  parseUsageTimestamp,
} from '../src/services/api/credentialUsage';

const originalGet = apiClient.get.bind(apiClient);
const originalPost = apiClient.post.bind(apiClient);
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.post = originalPost;
});

const GO_ZERO_TIME = '0001-01-01T00:00:00Z';

// Current backend shape: unset timestamps (observed_at, cooldown_until) are omitted.
const wireEntry = {
  auth_index: ' claude:1 ',
  auth_id: 'claude-max.json',
  provider: 'Claude',
  raw: {
    usage: { five_hour: { utilization: 6 } },
    profile: { organization: { organization_type: 'claude_max' } },
    reset_credits: { available_count: 1 },
  },
  resets: null,
  fetched_at: '2026-10-02T10:00:00Z',
  windows: [],
  refreshing: false,
  last_error: ' claude profile: upstream status 503 ',
  next_fetch_at: '2026-10-02T10:03:00Z',
};

const apiError = (status: number | undefined, data: unknown) =>
  Object.assign(new Error('request failed'), { status, data });

describe('credential usage normalization', () => {
  test('maps wire fields, raw body keys, and absent or Go zero times', () => {
    const [entry] = normalizeCredentialUsageList([wireEntry]);
    const [legacy] = normalizeCredentialUsageList([
      { ...wireEntry, observed_at: GO_ZERO_TIME, cooldown_until: GO_ZERO_TIME },
    ]);
    expect(legacy).toEqual(entry);
    expect(entry).toEqual({
      authIndex: 'claude:1',
      authId: 'claude-max.json',
      provider: 'claude',
      raw: {
        usage: { five_hour: { utilization: 6 } },
        profile: { organization: { organization_type: 'claude_max' } },
        resetCredits: { available_count: 1 },
      },
      resets: null,
      windows: [],
      fetchedAtMs: Date.parse('2026-10-02T10:00:00Z'),
      observedAtMs: null,
      nextFetchAtMs: Date.parse('2026-10-02T10:03:00Z'),
      cooldownUntilMs: null,
      refreshing: false,
      lastError: 'claude profile: upstream status 503',
    });
  });

  test('maps routing windows; reset times are omitted when unset', () => {
    const [entry] = normalizeCredentialUsageList([
      {
        ...wireEntry,
        observed_at: '2026-10-02T10:05:00Z',
        windows: [
          {
            kind: '7d',
            scope: 'fable',
            used_percent: 41.5,
            resets_at: '2026-10-05T10:00:00Z',
            length: 604800,
          },
          { kind: '5h', scope: '', used_percent: 12, length: 18000 },
          { kind: '7d', scope: '', used_percent: 'x', length: 604800 },
          null,
        ],
      },
    ]);
    expect(entry.observedAtMs).toBe(Date.parse('2026-10-02T10:05:00Z'));
    expect(entry.windows).toEqual([
      {
        kind: '7d',
        scope: 'fable',
        usedPercent: 41.5,
        resetsAtMs: Date.parse('2026-10-05T10:00:00Z'),
        lengthSeconds: 604800,
      },
      { kind: '5h', scope: '', usedPercent: 12, resetsAtMs: null, lengthSeconds: 18000 },
    ]);
    expect(normalizeCredentialUsageList([{ auth_index: 'x' }])[0].windows).toEqual([]);
  });

  test('drops malformed entries and non-array bodies', () => {
    expect(normalizeCredentialUsageList([null, {}, { auth_index: '' }, wireEntry])).toHaveLength(1);
    expect(normalizeCredentialUsageList({ entries: [wireEntry] })).toEqual([]);
    expect(parseUsageTimestamp('not a date')).toBeNull();
    expect(parseUsageTimestamp(GO_ZERO_TIME)).toBeNull();
    expect(parseUsageTimestamp(undefined)).toBeNull();
    expect(normalizeCredentialUsageList([{ auth_index: 'x', raw: null }])[0].raw).toEqual({});
  });
});

describe('reset inventory (sdk/cliproxy/auth/reset_types.go)', () => {
  const resetsOf = (resets: unknown) =>
    normalizeCredentialUsageList([{ ...wireEntry, resets }])[0].resets;

  test('null or non-object means availability is unknown', () => {
    for (const value of [null, undefined, 'x', 3, []]) expect(resetsOf(value)).toBeNull();
  });

  test('Codex credits; an empty inventory omits credits but is still known', () => {
    expect(
      resetsOf({ credits: [{ id: ' c1 ', expires_at: '2026-10-03T12:00:00Z' }, 'bad'] })
    ).toEqual({
      credits: [{ id: 'c1', expiresAt: '2026-10-03T12:00:00Z' }],
      body: { credits: [{ id: ' c1 ', expires_at: '2026-10-03T12:00:00Z' }, 'bad'] },
    });
    expect(resetsOf({})).toEqual({ credits: [], body: {} });
  });

  test('Claude keeps the flattened cedar_ember status as the body', () => {
    const status = { eligible: true, at_limit: false, grants: [], next_grant_id: null };
    expect(resetsOf(status)).toEqual({ credits: [], body: status });
  });
});

describe('credential usage requests', () => {
  test('GET reads the cache, optionally scoped to one credential', async () => {
    const calls: unknown[][] = [];
    apiClient.get = (async (...args: unknown[]) => {
      calls.push(args);
      return [wireEntry];
    }) as typeof apiClient.get;
    expect(await credentialUsageApi.list('claude:1')).toHaveLength(1);
    await credentialUsageApi.list();
    expect(calls).toEqual([
      ['/credentials/usage', { params: { auth_index: 'claude:1' } }],
      ['/credentials/usage', undefined],
    ]);
  });

  test('refresh and reset POST the documented bodies', async () => {
    const calls: unknown[][] = [];
    apiClient.post = (async (...args: unknown[]) => {
      calls.push(args);
      return args[0] === '/credentials/usage/refresh' ? [wireEntry] : { result: 'reset' };
    }) as typeof apiClient.post;
    await credentialUsageApi.refresh('codex:2');
    await credentialUsageApi.refresh();
    await credentialUsageApi.reset('codex:2');
    await credentialUsageApi.reset('claude:1', 'grant-a');
    expect(calls.map((call) => call.slice(0, 2))).toEqual([
      ['/credentials/usage/refresh', { auth_index: 'codex:2' }],
      ['/credentials/usage/refresh', {}],
      ['/credentials/usage/reset', { auth_index: 'codex:2' }],
      ['/credentials/usage/reset', { auth_index: 'claude:1', grant_id: 'grant-a' }],
    ]);
  });
});

describe('credential reset outcomes', () => {
  test('200 results keep known codes and the refreshed entry', () => {
    for (const result of [
      'reset',
      'already_used',
      'not_limited',
      'cooldown',
      'ineligible',
      'unavailable',
      'rate_limited',
      'auth_error',
    ]) {
      expect(normalizeCredentialResetResponse({ result, entry: wireEntry }).code).toBe(result);
    }
    const pending = normalizeCredentialResetResponse({
      result: 'reset',
      entry: wireEntry,
      refresh_pending: true,
      next_fetch_at: '2026-10-02T10:05:00Z',
    });
    expect(pending.entry?.authIndex).toBe('claude:1');
    expect(pending.refreshPending).toBeTrue();
    expect(pending.nextFetchAtMs).toBe(Date.parse('2026-10-02T10:05:00Z'));
    expect(normalizeCredentialResetResponse({ result: 'surprise' }).code).toBe('unknown');
  });

  test('409, 400 and lost responses map to refusals; other errors are rethrown', () => {
    expect(
      mapCredentialResetError(
        apiError(409, {
          error: 'reset pending refresh',
          refresh_pending: true,
          next_fetch_at: '2026-10-02T10:05:00Z',
        })
      )
    ).toEqual({
      code: 'refresh_pending',
      entry: null,
      refreshPending: true,
      nextFetchAtMs: Date.parse('2026-10-02T10:05:00Z'),
    });
    expect(
      mapCredentialResetError(apiError(409, { error: 'credential reset already in flight' })).code
    ).toBe('in_flight');
    expect(
      mapCredentialResetError(apiError(400, { error: 'no usable reset available' })).code
    ).toBe('refused');
    expect(mapCredentialResetError(apiError(undefined, undefined)).code).toBe('unknown');
    const notFound = apiError(404, { error: 'credential not found' });
    expect(() => mapCredentialResetError(notFound)).toThrow(notFound);
    const unsupported = apiError(400, {
      error: 'credential does not support subscription usage',
    });
    expect(() => mapCredentialResetError(unsupported)).toThrow(unsupported);
  });

  test('gateway 5xx may have spent the reset; 503 and auth errors are rethrown', () => {
    for (const status of [500, 502, 504]) {
      expect(mapCredentialResetError(apiError(status, { error: 'bad gateway' })).code).toBe(
        'unknown'
      );
    }
    for (const status of [401, 403, 404, 422, 503]) {
      const error = apiError(status, { error: 'nope' });
      expect(() => mapCredentialResetError(error)).toThrow(error);
    }
  });

  test('reset() resolves a 409 instead of throwing', async () => {
    apiClient.post = (async () => {
      throw apiError(409, { error: 'reset pending refresh', refresh_pending: true });
    }) as typeof apiClient.post;
    expect((await credentialUsageApi.reset('codex:1')).code).toBe('refresh_pending');
  });
});
