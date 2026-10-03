import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { apiClient } from '../src/services/api/client';
import { normalizeCredentialUsageEntry } from '../src/services/api/credentialUsage';
import { buildClaudeQuotaData } from '../src/features/quota/providers/claude/data';
import { buildCodexQuotaData } from '../src/features/quota/providers/codex/data';
import { QUOTA_ADAPTERS } from '../src/features/quota/providers';
import { buildUsageMeta } from '../src/features/quota/providers/usageCache';
import { selectAutoLoadTargets } from '../src/features/quota/hooks/useQuotaAutoLoad';
import {
  readQuotaCacheIntoStore,
  shouldReadQuotaCacheOnMount,
} from '../src/features/authFiles/quotaCacheRead';
import type { QuotaFileEntry } from '../src/features/quota/logic';
import { useQuotaStore } from '../src/stores/useQuotaStore';
import type { AuthFileItem } from '../src/types';
import { formatInstantShort } from '../src/utils/quota';

const t = ((key: string) => key) as TFunction;
const NOW = Date.parse('2026-10-02T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3_600_000;

const claudeUsage = {
  five_hour: { utilization: 10, resets_at: iso(NOW + HOUR) },
  seven_day: { utilization: 20, resets_at: iso(NOW + 48 * HOUR) },
  limits: [
    {
      kind: 'weekly_scoped',
      percent: 30,
      resets_at: iso(NOW + 48 * HOUR),
      is_active: true,
      scope: { model: { display_name: 'Fable' } },
    },
  ],
};

const codexUsage = {
  plan_type: 'pro',
  rate_limit: {
    primary_window: {
      used_percent: 10,
      limit_window_seconds: 18000,
      reset_at: Math.floor((NOW + HOUR) / 1000),
    },
    secondary_window: {
      used_percent: 20,
      limit_window_seconds: 604800,
      reset_at: Math.floor((NOW + 48 * HOUR) / 1000),
    },
  },
  code_review_rate_limit: {
    primary_window: {
      used_percent: 5,
      limit_window_seconds: 18000,
      reset_at: Math.floor((NOW + HOUR) / 1000),
    },
  },
};

type WireWindow = {
  kind: string;
  scope?: string;
  used_percent: number;
  resets_at?: string;
  length: number;
};

const cachedEntry = (
  provider: string,
  usage: unknown,
  observedAtMs: number,
  windows: WireWindow[]
) => {
  const entry = normalizeCredentialUsageEntry({
    auth_index: `${provider}:1`,
    provider,
    raw: { usage },
    resets: null,
    fetched_at: iso(NOW),
    observed_at: iso(observedAtMs),
    windows: windows.map((window) => ({ scope: '', ...window })),
  });
  if (!entry) throw new Error('entry did not normalize');
  return { entry, meta: buildUsageMeta(entry) };
};

const rows = (windows: { id: string; usedPercent: number | null; resetAtMs?: number | null }[]) =>
  Object.fromEntries(
    windows.map(({ id, usedPercent, resetAtMs }) => [id, [usedPercent, resetAtMs]])
  );

describe('live window overlay', () => {
  test('Claude 5h, 7d and Fable windows replace their rows when observed after the fetch', () => {
    const reset = NOW + 47 * HOUR;
    const data = buildClaudeQuotaData(
      cachedEntry('claude', claudeUsage, NOW + 60_000, [
        { kind: '5h', used_percent: 55, resets_at: iso(NOW + 2 * HOUR), length: 18000 },
        { kind: '7d', used_percent: 66, resets_at: iso(reset), length: 604800 },
        { kind: '7d', scope: 'fable', used_percent: 77, resets_at: iso(reset), length: 604800 },
      ]),
      t
    );
    expect(rows(data.windows)).toEqual({
      'five-hour': [55, NOW + 2 * HOUR],
      'seven-day': [66, reset],
      'seven-day-fable': [77, reset],
    });
    const fable = data.windows.find((window) => window.id === 'seven-day-fable');
    expect(fable?.resetLabel).toBe(formatInstantShort(reset));
    expect(fable?.label).toBe('claude_quota.seven_day_fable');
  });

  test('a Fable window absent from windows keeps the fetched Fable row', () => {
    // Non-Fable traffic omits 7d_oi, so only the account-wide windows are live.
    const data = buildClaudeQuotaData(
      cachedEntry('claude', claudeUsage, NOW + 60_000, [
        { kind: '7d', used_percent: 66, resets_at: iso(NOW + 48 * HOUR), length: 604800 },
      ]),
      t
    );
    expect(rows(data.windows)).toEqual({
      'five-hour': [10, NOW + HOUR],
      'seven-day': [66, NOW + 48 * HOUR],
      'seven-day-fable': [30, NOW + 48 * HOUR],
    });
  });

  test('windows observed at or before the fetch are ignored', () => {
    for (const observedAtMs of [NOW, NOW - 60_000]) {
      const data = buildClaudeQuotaData(
        cachedEntry('claude', claudeUsage, observedAtMs, [
          { kind: '5h', used_percent: 99, resets_at: iso(NOW + 2 * HOUR), length: 18000 },
        ]),
        t
      );
      expect(data.windows.find((window) => window.id === 'five-hour')?.usedPercent).toBe(10);
    }
  });

  test('no observation, or a window without a reset, keeps the fetched reset', () => {
    const entry = normalizeCredentialUsageEntry({
      auth_index: 'claude:1',
      provider: 'claude',
      raw: { usage: claudeUsage },
      fetched_at: iso(NOW),
      windows: [{ kind: '5h', scope: '', used_percent: 99, length: 18000 }],
    });
    if (!entry) throw new Error('entry did not normalize');
    expect(
      buildClaudeQuotaData({ entry, meta: buildUsageMeta(entry) }, t).windows[0].usedPercent
    ).toBe(10);

    const data = buildClaudeQuotaData(
      cachedEntry('claude', claudeUsage, NOW + 60_000, [
        { kind: '5h', used_percent: 40, length: 18000 },
      ]),
      t
    );
    expect(rows(data.windows)['five-hour']).toEqual([40, NOW + HOUR]);
  });

  test('Codex windows map by length onto the primary rows only', () => {
    const data = buildCodexQuotaData(
      { name: 'codex.json', type: 'codex' } as AuthFileItem,
      cachedEntry('codex', codexUsage, NOW + 60_000, [
        { kind: '5h', used_percent: 45, resets_at: iso(NOW + 3 * HOUR), length: 18000 },
        { kind: '7d', used_percent: 65, resets_at: iso(NOW + 50 * HOUR), length: 604800 },
        { kind: 'long', used_percent: 90, resets_at: iso(NOW + 500 * HOUR), length: 2592000 },
      ]),
      t
    );
    expect(rows(data.windows)).toEqual({
      'five-hour': [45, NOW + 3 * HOUR],
      weekly: [65, NOW + 50 * HOUR],
      'code-review-five-hour': [5, NOW + HOUR],
    });
    expect(data.planType).toBe('pro');
  });

  test('a missing Codex window leaves its row as fetched', () => {
    const data = buildCodexQuotaData(
      { name: 'codex.json', type: 'codex' } as AuthFileItem,
      cachedEntry('codex', codexUsage, NOW + 60_000, [
        { kind: '5h', used_percent: 45, resets_at: iso(NOW + 3 * HOUR), length: 18000 },
      ]),
      t
    );
    expect(rows(data.windows).weekly).toEqual([20, NOW + 48 * HOUR]);
  });
});

describe('Quota page re-reads the cache on every visit', () => {
  const entries: QuotaFileEntry[] = [
    { type: 'claude', file: { name: 'claude.json', type: 'claude', authIndex: 'claude:1' } },
    { type: 'codex', file: { name: 'codex.json', type: 'codex', authIndex: 'codex:1' } },
    { type: 'kimi', file: { name: 'kimi.json', type: 'kimi' } },
  ];
  const context = { session: 0, fileGenerations: {}, statusOf: () => 'success' };
  const names = (targets: QuotaFileEntry[]) => targets.map(({ file }) => file.name);

  test('each visit reads again; within a visit each credential is read once', () => {
    const firstVisit = new Set<string>();
    expect(names(selectAutoLoadTargets(entries, firstVisit, context))).toEqual([
      'claude.json',
      'codex.json',
    ]);
    // The file list reloading during the same visit does not read again.
    expect(selectAutoLoadTargets(entries, firstVisit, context)).toEqual([]);
    // Navigating back mounts the page with a fresh visit, even with cached success states.
    expect(names(selectAutoLoadTargets(entries, new Set(), context))).toEqual([
      'claude.json',
      'codex.json',
    ]);
  });

  test('a credential already loading is not read twice', () => {
    const targets = selectAutoLoadTargets(entries, new Set(), {
      ...context,
      statusOf: ({ file }) => (file.name === 'claude.json' ? 'loading' : 'success'),
    });
    expect(names(targets)).toEqual(['codex.json']);
  });
});

describe('Auth Files quota card reads the cache on mount', () => {
  const originalGet = apiClient.get.bind(apiClient);
  const originalPost = apiClient.post.bind(apiClient);
  const claudeFile = { name: 'claude.json', type: 'claude', auth_index: 'claude:1' };
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    useQuotaStore.getState().clearQuotaCache();
    apiClient.post = (async (url: string) => {
      calls.push(`POST ${url}`);
      return [];
    }) as typeof apiClient.post;
  });
  afterEach(() => {
    apiClient.get = originalGet;
    apiClient.post = originalPost;
  });

  const stubGet = (onRead?: () => void) => {
    apiClient.get = (async (url: string) => {
      calls.push(`GET ${url}`);
      onRead?.();
      return [
        {
          auth_index: 'claude:1',
          provider: 'claude',
          raw: { usage: claudeUsage },
          fetched_at: iso(NOW),
          windows: [],
        },
      ];
    }) as typeof apiClient.get;
  };

  test('only usable Claude and Codex cards read on mount', () => {
    const file = claudeFile as AuthFileItem;
    expect(shouldReadQuotaCacheOnMount('claude', file, false)).toBe(true);
    expect(shouldReadQuotaCacheOnMount('codex', file, false)).toBe(true);
    expect(shouldReadQuotaCacheOnMount('devin', file, false)).toBe(false);
    expect(shouldReadQuotaCacheOnMount('claude', file, true)).toBe(false);
    expect(shouldReadQuotaCacheOnMount('claude', { ...file, disabled: true }, false)).toBe(false);
  });

  test('a mount reads the cache with GET, replacing a previous card state', async () => {
    stubGet();
    useQuotaStore.getState().setClaudeQuota({
      'claude.json': { status: 'success', windows: [] },
    });
    await readQuotaCacheIntoStore(QUOTA_ADAPTERS.claude, claudeFile as AuthFileItem, t);
    expect(calls).toEqual(['GET /credentials/usage']);
    const state = useQuotaStore.getState().claudeQuota['claude.json'];
    expect(state.status).toBe('success');
    expect(state.windows.map((window) => window.id)).toContain('five-hour');
  });

  test('a read already in flight is not repeated', async () => {
    stubGet();
    useQuotaStore.getState().setClaudeQuota({ 'claude.json': { status: 'loading', windows: [] } });
    await readQuotaCacheIntoStore(QUOTA_ADAPTERS.claude, claudeFile as AuthFileItem, t);
    expect(calls).toEqual([]);
  });

  test('a result for an invalidated file is dropped', async () => {
    stubGet(() => useQuotaStore.getState().clearQuotaCache(['claude.json']));
    await readQuotaCacheIntoStore(QUOTA_ADAPTERS.claude, claudeFile as AuthFileItem, t);
    expect(useQuotaStore.getState().claudeQuota['claude.json']).toBeUndefined();
  });

  test('the card wires the read into a mount effect', async () => {
    const source = await Bun.file(
      'src/features/authFiles/components/AuthFileQuotaSection.tsx'
    ).text();
    expect(source).toContain('shouldReadQuotaCacheOnMount(quotaType, file, disableControls)');
    expect(source).toContain('void readQuotaCacheIntoStore(adapter, file, t)');
  });
});
