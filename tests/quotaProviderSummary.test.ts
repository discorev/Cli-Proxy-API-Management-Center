/**
 * The provider strip's arithmetic.
 *
 * The headline is a sum over loaded credentials against a denominator of every
 * credential — including the ones nobody has loaded yet. Getting that wrong in
 * either direction ("87% of 100%" for five credentials, or a denominator that
 * grows as data arrives) makes the number mean something else entirely.
 */

import { describe, expect, test } from 'bun:test';
import { buildProviderSummary, type QuotaSummaryInput } from '@/features/quota/providerSummary';
import type { ClaudeQuotaState } from '@/types';

const now = Date.now();
const DAY = 86_400_000;
const t = ((key: string) => key) as unknown as Parameters<typeof buildProviderSummary>[2];

const claude = (
  sevenDayUsed: number,
  resetAtMs: number | null,
  extraWindows: ClaudeQuotaState['windows'] = []
): ClaudeQuotaState => ({
  status: 'success',
  windows: [
    {
      id: 'seven_day',
      label: '7-day limit',
      usedPercent: sevenDayUsed,
      resetLabel: '09-08 21:59',
      resetAtMs,
      periodHours: 168,
    },
    {
      id: 'five_hour',
      label: '5-hour limit',
      usedPercent: 0,
      resetLabel: '09-07 10:00',
      // Sooner than the weekly reset, and deliberately not the card footer.
      resetAtMs: now + 60_000,
      periodHours: 5,
    },
    ...extraWindows,
  ],
});

const input = (key: string, quota: unknown): QuotaSummaryInput => ({
  key,
  displayName: key,
  quota,
});

describe('buildProviderSummary', () => {
  test('sums remaining over loaded credentials against every credential', () => {
    const summary = buildProviderSummary(
      'claude',
      [
        input('a.json', claude(2, now + DAY)),
        input('b.json', claude(60, now + 3 * DAY)),
        input('c.json', undefined),
      ],
      t
    );

    expect(summary.credentialCount).toBe(3);
    expect(summary.denominator).toBe(300);
    expect(summary.loadedCount).toBe(2);
    expect(summary.headline?.totalRemaining).toBe(98 + 40);
    expect(summary.headline?.label).toBe('7-day limit');
  });

  test('an unloaded credential still occupies a grey segment', () => {
    const summary = buildProviderSummary(
      'claude',
      [input('a.json', claude(2, now + DAY)), input('b.json', undefined)],
      t
    );

    expect(summary.headline?.segments.map((segment) => segment.remainingPercent)).toEqual([
      98,
      null,
    ]);
  });

  test('nothing loaded leaves the headline empty rather than reading zero', () => {
    const summary = buildProviderSummary('claude', [input('a.json', { status: 'idle' })], t);

    expect(summary.loadedCount).toBe(0);
    expect(summary.headline).toBeNull();
    expect(summary.denominator).toBe(100);
  });

  test('the footer follows the headline window, not the soonest window overall', () => {
    const summary = buildProviderSummary(
      'claude',
      [input('a.json', claude(2, now + 3 * DAY)), input('b.json', claude(60, now + DAY))],
      t,
      now
    );

    // The 5-hour window resets in a minute; the card is about the week.
    expect(summary.resetAtMs).toBe(now + DAY);
  });

  test('skips a headline reset that has already turned over', () => {
    const summary = buildProviderSummary(
      'claude',
      [input('a.json', claude(2, now - DAY)), input('b.json', claude(60, now + DAY))],
      t,
      now
    );

    expect(summary.resetAtMs).toBe(now + DAY);
  });

  test('same-length windows that did not lead become extra headlines', () => {
    const withModelWindow = claude(2, now + DAY, [
      {
        id: 'seven_day_opus',
        label: '7-day Fable 5',
        usedPercent: 5,
        resetLabel: '09-08 21:59',
        resetAtMs: now + DAY,
        periodHours: 168,
      },
    ]);

    const summary = buildProviderSummary(
      'claude',
      [input('a.json', withModelWindow), input('b.json', claude(60, now + DAY))],
      t
    );

    // Present on both credentials, so the generic weekly limit leads.
    expect(summary.headline?.label).toBe('7-day limit');
    expect(summary.extraHeadlines.map((extra) => extra.label)).toEqual(['7-day Fable 5']);
    expect(summary.extraHeadlines[0].totalRemaining).toBe(95);
  });

  test('each headline carries its own soonest upcoming reset', () => {
    const fable = (resetAtMs: number): ClaudeQuotaState['windows'] => [
      {
        id: 'seven_day_opus',
        label: '7-day Fable 5',
        usedPercent: 5,
        resetLabel: '10-06 21:59',
        resetAtMs,
        periodHours: 168,
      },
    ];

    const summary = buildProviderSummary(
      'claude',
      [
        input('a.json', claude(2, now + 3 * DAY, fable(now - DAY))),
        input('b.json', claude(60, now + DAY, fable(now + 2 * DAY))),
      ],
      t,
      now
    );

    expect(summary.headline?.resetAtMs).toBe(now + DAY);
    expect(summary.extraHeadlines[0].resetAtMs).toBe(now + 2 * DAY);
    expect(summary.extraHeadlines[0].resetLabel).toBe('10-06 21:59');
    expect(summary.resetAtMs).toBe(summary.headline?.resetAtMs ?? null);
  });

  test('a provider with no credentials reports a zero denominator', () => {
    const summary = buildProviderSummary('kimi', [], t);
    expect(summary.denominator).toBe(0);
    expect(summary.headline).toBeNull();
  });
});
