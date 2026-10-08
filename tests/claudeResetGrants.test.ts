import { describe, expect, test } from 'bun:test';
import {
  selectResetGrant,
  soonestGrantExpiryMs,
} from '../src/features/quota/providers/claude/selectResetGrant';
import {
  anthropicResetGrantBlocker,
  parseAnthropicResetGrantStatus,
} from '../src/services/api/claudeResetGrants';
import { CREDENTIAL_RESET_RESULTS } from '../src/services/api/credentialUsage';
import cedarEmberUsage from './fixtures/claudeUsageCedarEmber.json';

const grant = { id: 'test-grant', resets_total: 2, resets_left: 2, usable_now: true };
const block = { eligible: true, at_limit: true, grants: [grant] };
const status = () => parseAnthropicResetGrantStatus(block)!;

describe('Claude reset grant fail-closed parsing', () => {
  test('valid block and refusing defaults', () => {
    expect(status().grants[0].useRequiresLimit).toBe(true);
    expect(anthropicResetGrantBlocker(status(), grant.id)).toBeNull();
    expect(anthropicResetGrantBlocker({ ...status(), atLimit: false }, grant.id)).toBe(
      'not_limited'
    );
    expect(anthropicResetGrantBlocker({ ...status(), eligible: false }, grant.id)).toBe(
      'ineligible'
    );
    const missing = parseAnthropicResetGrantStatus({
      ...block,
      grants: [{ ...grant, usable_now: undefined }],
    })!;
    expect(anthropicResetGrantBlocker(missing, grant.id)).toBe('not_usable');
  });
  test('rejects malformed blocks and grants', () => {
    for (const value of [
      undefined,
      {},
      { ...block, eligible: 1 },
      { ...block, grants: {} },
      { ...block, grants: [grant, grant] },
      { ...block, cooldown_until: 'bad' },
    ]) {
      expect(parseAnthropicResetGrantStatus(value)).toBeNull();
    }
    for (const fields of [
      { id: '../bad' },
      { resets_left: -1 },
      { resets_left: 3 },
      { resets_total: 1.5 },
      { paused: 'false' },
      { starts_at: 'bad' },
      { clears: {} },
    ]) {
      expect(
        parseAnthropicResetGrantStatus({ ...block, grants: [{ ...grant, ...fields }] })
      ).toBeNull();
    }
  });
});

test('parses the backend inventory, which flattens the real cedar_ember block', () => {
  const parsed = parseAnthropicResetGrantStatus(cedarEmberUsage.cedar_ember);
  expect(parsed).not.toBeNull();
  expect(parsed!.eligible).toBeTrue();
  expect(parsed!.nextGrantId).toBe('opus55-launch-promax-20260921');
  expect(parsed!.grants[0]).toMatchObject({
    resetsLeft: 1,
    usableNow: true,
    useRequiresLimit: false,
    clears: ['five_hour', 'seven_day', 'seven_day_overage_included'],
  });
  const now = Date.parse('2026-10-02T12:00:00Z');
  expect(selectResetGrant(parsed!, now)?.id).toBe('opus55-launch-promax-20260921');
  expect(parseAnthropicResetGrantStatus(null)).toBeNull();
  expect(parseAnthropicResetGrantStatus('not an object')).toBeNull();
});

test('reset outcomes, notes and confirmation are translated in four locales', async () => {
  const locales = await Promise.all(
    ['en', 'zh-CN', 'zh-TW', 'ru'].map(
      async (locale) =>
        (await Bun.file(`src/i18n/locales/${locale}.json`).json()) as {
          claude_reset: Record<string, string>;
          credential_usage: Record<string, string> & { reset_outcome: Record<string, string> };
        }
    )
  );
  for (const locale of locales) {
    expect(Object.keys(locale.claude_reset).sort()).toEqual(
      Object.keys(locales[0].claude_reset).sort()
    );
    expect(locale.claude_reset.confirm_text).toContain('{{name}}');
    expect(typeof locale.claude_reset.remaining).toBe('string');
    expect(typeof locale.claude_reset.use).toBe('string');
    for (const key of [
      ...CREDENTIAL_RESET_RESULTS,
      'refresh_pending',
      'refresh_pending_later',
      'in_flight',
      'refused',
    ]) {
      expect(typeof locale.credential_usage.reset_outcome[key]).toBe('string');
    }
    expect(locale.credential_usage.reset_outcome.refresh_pending).toContain('{{time}}');
    expect(locale.credential_usage.last_warning).toContain('{{message}}');
    expect(locale.credential_usage.cooldown_note).toContain('{{time}}');
    expect(locale.credential_usage.deferred_note).toContain('{{time}}');
    expect(locale.credential_usage.last_error).toContain('{{message}}');
    expect(typeof locale.credential_usage.not_fetched).toBe('string');
  }
});

test('card selection prefers usable recommendation and has deterministic fallback', () => {
  const base = status();
  const a = { ...base.grants[0], id: 'a' };
  const b = { ...a, id: 'b' };
  const multiple = { ...base, grants: [b, a], nextGrantId: 'b' };
  expect(selectResetGrant(multiple, 0)?.id).toBe('b');
  expect(selectResetGrant({ ...multiple, nextGrantId: null }, 0)?.id).toBe('a');
  expect(selectResetGrant({ ...multiple, grants: [a, { ...b, paused: true }] }, 0)?.id).toBe('a');
  expect(selectResetGrant({ ...multiple, eligible: false }, 0)).toBeUndefined();
  expect(selectResetGrant({ ...multiple, atLimit: false }, 0)).toBeUndefined();
  expect(
    selectResetGrant({ ...multiple, cooldownUntil: new Date(1000).toISOString() }, 0)
  ).toBeUndefined();
  for (const changed of [
    { resetsLeft: 0 },
    { usableNow: false },
    { paused: true },
    { startsAt: new Date(1000).toISOString() },
    { endsAt: new Date(0).toISOString() },
  ]) {
    expect(selectResetGrant({ ...base, grants: [{ ...a, ...changed }] }, 0)).toBeUndefined();
  }
});

test('Claude row claims through the backend reset route with a shared confirmation', async () => {
  const card = await Bun.file('src/features/quota/components/QuotaRow.tsx').text();
  const hook = await Bun.file('src/features/quota/providers/claude/ClaudeResetGrants.tsx').text();
  expect(card).toContain("styles.creditsCount}>{claudeReset.count ?? '--'}");
  expect(card).toContain('disabled={claudeReset.blocked}');
  expect(card).toContain('onClick={claudeReset.confirm}');
  expect(hook).toContain('showConfirmation({');
  expect(hook).toContain('resetClaudeGrant(file, selected, t, quota)');
  expect(hook).not.toContain('apiCall');
  expect(hook).not.toContain('<Modal');
  expect(hook).not.toContain('status.grants.map');
});

test('soonest grant expiry ignores past, exhausted and open-ended grants', () => {
  const base = status();
  const now = Date.parse('2026-10-02T12:00:00Z');
  const at = (days: number) => new Date(now + days * 86_400_000).toISOString();
  const grantAt = (id: string, endsAt: string | null, resetsLeft = 1) => ({
    ...base.grants[0],
    id,
    endsAt,
    resetsLeft,
  });

  const grants = [
    grantAt('late', at(20)),
    grantAt('soon', at(3)),
    grantAt('past', at(-1)),
    grantAt('spent', at(1), 0),
    grantAt('open', null),
  ];
  expect(soonestGrantExpiryMs({ ...base, grants }, now)).toBe(now + 3 * 86_400_000);
  expect(soonestGrantExpiryMs({ ...base, grants: grants.slice(2) }, now)).toBeNull();
  expect(soonestGrantExpiryMs({ ...base, grants: [] }, now)).toBeNull();
});
