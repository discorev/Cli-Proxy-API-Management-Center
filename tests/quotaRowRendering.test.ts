/**
 * The row rendered end-to-end, mainly to pin redaction.
 *
 * The page passes an already-transformed display name, so the row's job is to
 * use that string everywhere an identity appears — including the `title`
 * tooltip, which is the one place a masked name can quietly leak the real one.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { QuotaRow } from '@/features/quota/components/QuotaRow';
import { redactIdentity } from '@/utils/quota/redact';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';

const FILE_NAME = 'claude-theo@lambda.dev.json';

const entry: QuotaFileEntry = {
  file: { name: FILE_NAME, provider: 'claude' } as AuthFileItem,
  type: 'claude',
};

const quota: ClaudeQuotaState = {
  status: 'success',
  planType: 'max',
  windows: [
    {
      id: 'seven_day',
      label: '7-day limit',
      usedPercent: 30,
      resetLabel: '09-08 21:59',
      resetAtMs: Date.now() + 86_400_000,
      periodHours: 168,
    },
  ],
};

const render = (props: Partial<Parameters<typeof QuotaRow>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(QuotaRow, {
      entry,
      quota,
      displayName: FILE_NAME,
      canRefresh: true,
      resetting: false,
      onRefresh: () => {},
      onReset: () => {},
      ...props,
    })
  );

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('QuotaRow', () => {
  test('renders the identity, the window label and remaining percent', () => {
    const markup = render();
    expect(markup).toContain(FILE_NAME);
    expect(markup).toContain('7-day limit');
    expect(markup).toContain('70%');
  });

  test('a redacted display name leaves no trace of the real one, tooltip included', () => {
    const markup = render({ displayName: redactIdentity(FILE_NAME) });
    expect(markup).toContain(redactIdentity(FILE_NAME));
    expect(markup).not.toContain(FILE_NAME);
    expect(markup).not.toContain('theo');
    expect(markup).not.toContain('lambda');
  });

  test('an unloaded row offers the refresh instead of inventing numbers', () => {
    const markup = render({ quota: undefined });
    expect(markup).toContain('Not loaded');
    expect(markup).not.toContain('%');
  });

  test('a failed row repeats the provider failure copy', () => {
    const markup = render({ quota: { status: 'error', error: 'upstream exploded' } });
    expect(markup).toContain('upstream exploded');
    expect(markup).toContain('role="alert"');
  });
});
