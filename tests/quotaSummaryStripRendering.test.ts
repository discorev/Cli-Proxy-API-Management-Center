/**
 * The provider strip rendered end-to-end.
 *
 * The headline number and the per-credential segments are the two things on
 * this page that are read from across the room, and the segment tooltips are
 * the second place (after the rows) where a redacted name could leak.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { QuotaSummaryStrip } from '@/features/quota/components/QuotaSummaryStrip';
import type { QuotaProviderSummary } from '@/features/quota/providerSummary';

const summary = (overrides: Partial<QuotaProviderSummary> = {}): QuotaProviderSummary => ({
  provider: 'claude',
  credentialCount: 2,
  denominator: 200,
  loadedCount: 2,
  headline: {
    label: '7-day limit',
    resetAtMs: Date.now() + 86_400_000,
    resetLabel: '09-08 21:59',
    totalRemaining: 138,
    segments: [
      { key: 'a', displayName: 'claude-t•••@l•••.dev.json', remainingPercent: 98 },
      { key: 'b', displayName: 'claude-p•••.json', remainingPercent: 40 },
    ],
  },
  extraHeadlines: [],
  resetAtMs: Date.now() + 86_400_000,
  resetLabel: '09-08 21:59',
  ...overrides,
});

const render = (summaries: QuotaProviderSummary[]) =>
  renderToStaticMarkup(
    createElement(QuotaSummaryStrip, { summaries, resolvedTheme: 'dark' as const })
  );

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('QuotaSummaryStrip', () => {
  test('leads with the summed remaining percent over the credential count', () => {
    const markup = render([summary()]);
    expect(markup).toContain('138%');
    expect(markup).toContain('of 200%');
    expect(markup).toContain('2 credentials');
    expect(markup).toContain('09-08 21:59');
  });

  test('segment tooltips carry only the name they were given', () => {
    const markup = render([summary()]);
    expect(markup).toContain('claude-t•••@l•••.dev.json · 98%');
    expect(markup).not.toContain('theo');
  });

  test('an unloaded provider shows placeholders instead of a zero', () => {
    const markup = render([
      summary({ loadedCount: 0, headline: null, resetAtMs: null, resetLabel: null }),
    ]);
    expect(markup).toContain('--');
    expect(markup).toContain('not loaded');
  });

  test('extra headlines stay collapsed behind the show control', () => {
    const markup = render([
      summary({
        extraHeadlines: [
          {
            label: '7-day Fable 5',
            totalRemaining: 95,
            segments: [{ key: 'a', displayName: 'a', remainingPercent: 95 }],
            resetAtMs: Date.now() + 2 * 86_400_000,
            resetLabel: '10/06, 21:59',
          },
        ],
      }),
    ]);
    expect(markup).toContain('7-day Fable 5');
    expect(markup).toContain('95%');
    expect(markup).toContain('>Show<');
    expect(markup).toContain('aria-expanded="false"');
    // Collapsed: the toggle line is there, the big figure and its footer are not.
    expect(markup).not.toContain('10/06, 21:59');
    expect(markup.match(/of 200%/g)).toHaveLength(1);
  });

  test('renders nothing at all when no provider has credentials', () => {
    expect(render([])).toBe('');
  });
});
