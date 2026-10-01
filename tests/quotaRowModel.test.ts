/**
 * One fixture per provider through the shared row model.
 *
 * The rows and the summary strip both read this shape, so a provider that
 * normalizes wrong is wrong twice on screen. Percentages are asserted as
 * *remaining* capacity — several providers report used instead.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import { toQuotaRowModel } from '@/features/quota/rowModel';
import { XAI_WEEKLY_ROW_ID } from '@/features/quota/resetSchedule';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';

const now = Date.now();
const t = ((key: string) => key) as unknown as Parameters<typeof toQuotaRowModel>[2];

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('toQuotaRowModel', () => {
  test('returns null for anything that is not a loaded success', () => {
    expect(toQuotaRowModel('claude', undefined, t)).toBeNull();
    expect(toQuotaRowModel('claude', { status: 'idle' }, t)).toBeNull();
    expect(toQuotaRowModel('claude', { status: 'loading' }, t)).toBeNull();
    expect(toQuotaRowModel('claude', { status: 'error', error: 'nope' }, t)).toBeNull();
  });

  test('Claude windows become remaining percent with their reset instant', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      planType: 'max',
      windows: [
        {
          id: 'seven_day',
          label: '7-day limit',
          usedPercent: 30,
          resetLabel: '09-08 21:59',
          resetAtMs: now + 86_400_000,
          periodHours: 168,
        },
      ],
    };
    const model = toQuotaRowModel('claude', quota, t);
    expect(model?.windows).toEqual([
      {
        id: 'seven_day',
        label: '7-day limit',
        remainingPercent: 70,
        resetLabel: '09-08 21:59',
        resetAtMs: now + 86_400_000,
        periodHours: 168,
      },
    ]);
  });

  test('Codex exposes available manual resets alongside its windows', () => {
    const expiresAt = new Date(now + 12 * 86_400_000).toISOString();
    const quota: CodexQuotaState = {
      status: 'success',
      planType: 'pro',
      windows: [
        {
          id: 'five-hour',
          label: '5-hour limit',
          usedPercent: 50,
          resetLabel: '',
          resetAtMs: now + 3_600_000,
          periodHours: 5,
        },
        {
          id: 'weekly',
          label: 'Weekly limit',
          usedPercent: 12,
          resetLabel: '09-14 18:24',
          resetAtMs: now + 6 * 86_400_000,
          periodHours: 168,
        },
      ],
      rateLimitResetCreditsAvailableCount: 3,
      rateLimitResetCredits: [
        { id: 'c1', status: 'available', grantedAt: '', expiresAt },
        { id: 'c2', status: 'used', grantedAt: '', expiresAt },
      ],
    };
    const model = toQuotaRowModel('codex', quota, t);
    // The row shows only the weekly window; the 5-hour limit is dropped.
    expect(model?.windows.map((window) => window.id)).toEqual(['weekly']);
    expect(model?.windows[0].remainingPercent).toBe(88);
    expect(model?.resetCredits?.available).toBe(3);
    // Spent credits are not upcoming capacity and must not be listed.
    expect(model?.resetCredits?.credits.map((credit) => credit.id)).toEqual(['c1']);
  });

  test('Devin windows are already remaining percent and keep their period', () => {
    const quota: DevinQuotaState = {
      status: 'success',
      plan: 'Team',
      planStartMs: null,
      planEndMs: null,
      observedAtMs: now,
      windows: [
        { id: 'weekly', remainingPercent: 40, resetAtMs: now + 3_600_000, periodHours: 168 },
      ],
    };
    const model = toQuotaRowModel('devin', quota, t);
    expect(model?.plan).toBe('Team');
    expect(model?.windows[0]).toMatchObject({ remainingPercent: 40, periodHours: 168 });
  });

  test('Kimi rows become remaining percent from used over limit', () => {
    const quota: KimiQuotaState = {
      status: 'success',
      rows: [
        { id: 'weekly', label: 'Weekly', used: 25, limit: 100, resetAtMs: now, periodHours: 168 },
      ],
    };
    expect(toQuotaRowModel('kimi', quota, t)?.windows[0].remainingPercent).toBe(75);
  });

  test('xAI weekly leads and the monthly billing cycle carries no period', () => {
    const quota: XaiQuotaState = {
      status: 'success',
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: 10,
        usedPercent: 40,
        productUsage: [],
        monthlyLimitCents: 15_000,
        usedCents: 6_000,
        includedUsedCents: 6_000,
        onDemandCapCents: null,
        onDemandUsedCents: null,
        onDemandUsedPercent: null,
        resetAtMs: now + 2 * 86_400_000,
        periodHours: 168,
        billingPeriodEnd: new Date(now + 20 * 86_400_000).toISOString(),
      },
    };
    const model = toQuotaRowModel('xai', quota, t);
    expect(model?.windows[0]).toMatchObject({
      id: XAI_WEEKLY_ROW_ID,
      remainingPercent: 90,
      periodHours: 168,
    });
    const monthly = model?.windows.find((window) => window.id === 'xai:monthly');
    expect(monthly?.periodHours).toBeNull();
  });

  test('Antigravity buckets carry their group so repeated limit names stay distinct', () => {
    const quota: AntigravityQuotaState = {
      status: 'success',
      groups: [
        {
          id: 'gemini',
          label: 'Gemini models',
          buckets: [
            {
              id: 'gemini-weekly',
              label: 'Weekly limit',
              remainingFraction: 0.25,
              resetAtMs: now + 86_400_000,
              periodHours: 168,
            },
          ],
        },
      ],
    };
    const model = toQuotaRowModel('antigravity', quota, t);
    expect(model?.windows[0].remainingPercent).toBe(25);
    expect(model?.windows[0].label).toContain('·');
  });

  test('Codex shows Business Premium and the credit balance beside the renewal date', () => {
    const quota = {
      status: 'success',
      planType: 'self_serve_business_prolite',
      creditsUnlimited: true,
      windows: [],
    } as unknown as CodexQuotaState;
    const model = toQuotaRowModel('codex', quota, t);
    expect(model?.plan).toBe('codex_quota.plan_business_premium');
    expect(model?.planNote).toBe('codex_quota.credit_balance_label codex_quota.credit_unlimited');
  });

  test('xAI prefers the subscription label and hides an empty monthly cycle on weekly plans', () => {
    const quota: XaiQuotaState = {
      status: 'success',
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: 10,
        usedPercent: 0,
        productUsage: [],
        monthlyLimitCents: 0,
        usedCents: 0,
        includedUsedCents: 0,
        onDemandCapCents: null,
        onDemandUsedCents: null,
        onDemandUsedPercent: null,
        resetAtMs: now + 86_400_000,
        periodHours: 168,
        billingPeriodEnd: new Date(now + 20 * 86_400_000).toISOString(),
        planLabel: 'SuperGrok Heavy',
        planTier: 'elite',
      },
    };
    const model = toQuotaRowModel('xai', quota, t);
    expect(model?.plan).toBe('SuperGrok Heavy');
    expect(model?.windows.map((window) => window.id)).toEqual([XAI_WEEKLY_ROW_ID]);
  });

  test('Meta windows become remaining percent with second-based reset instants', () => {
    const quota: MetaQuotaState = {
      status: 'success',
      data: {
        planName: 'Muse Plus',
        isSubscriptionActive: true,
        windows: [
          { id: 'window', usedPercent: 25, resetAt: 1_800_000_000, durationMinutes: 300 },
          { id: 'weekly', usedPercent: null },
        ],
      },
    };
    const model = toQuotaRowModel('meta', quota, t);
    expect(model?.plan).toBe('Muse Plus');
    expect(model?.planNote).toBe('meta_quota.active');
    expect(model?.windows).toEqual([
      {
        id: 'window',
        label: 'meta_quota.window_duration',
        remainingPercent: 75,
        resetLabel: null,
        resetAtMs: 1_800_000_000_000,
        periodHours: 5,
      },
      {
        id: 'weekly',
        label: 'meta_quota.weekly',
        remainingPercent: null,
        resetLabel: null,
        resetAtMs: null,
        periodHours: 168,
      },
    ]);
    expect(model?.message).toBeNull();
  });
});
