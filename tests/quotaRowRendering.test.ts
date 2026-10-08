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
import type { AuthFileItem, ClaudeQuotaState, CodexQuotaState } from '@/types';

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

  // Class names are not resolvable under bun:test (the scss import is a string), so the
  // row's parts are addressed by position: identity | body (windows..., reset cell) | actions.
  describe('reset cell', () => {
    const topLevelChildren = (markup: string): string[] => {
      const children: string[] = [];
      const tag = /<(\/?)div\b[^>]*>/g;
      let depth = 0;
      let start = 0;
      for (let match = tag.exec(markup); match; match = tag.exec(markup)) {
        if (match[1] === '/') {
          depth -= 1;
          if (depth === 1) children.push(markup.slice(start, tag.lastIndex));
        } else {
          depth += 1;
          if (depth === 2) start = match.index;
        }
      }
      return children;
    };

    /** The windows grid: first child of the body column. */
    const windowCells = (markup: string): string[] => {
      const windows = topLevelChildren(topLevelChildren(markup)[1])[0];
      return windows ? topLevelChildren(windows) : [];
    };

    const codexQuota: CodexQuotaState = {
      status: 'success',
      planType: 'plus',
      windows: [
        {
          id: 'weekly',
          label: 'Weekly limit',
          usedPercent: 12,
          resetLabel: '',
          resetAtMs: Date.now() + 86_400_000,
          periodHours: 168,
        },
      ],
    };
    const codexEntry: QuotaFileEntry = {
      file: { name: 'codex-a.json', provider: 'codex' } as AuthFileItem,
      type: 'codex',
    };

    test('the row is identity | body | actions, with no separate reset column', () => {
      const [identity, body, actions] = topLevelChildren(render());
      expect(topLevelChildren(render())).toHaveLength(3);
      expect(identity).toContain(FILE_NAME);
      expect(body).toContain('7-day limit');
      expect(body).toContain('Resets remaining');
      expect(actions).toContain('Refresh quota');
      expect(actions).not.toContain('Resets remaining');
    });

    test('the Claude reset cell is the last child of the windows grid', () => {
      const cells = windowCells(render());
      expect(cells).toHaveLength(2);
      expect(cells[0]).toContain('7-day limit');
      expect(cells[0]).not.toContain('Resets remaining');
      expect(cells[1]).toContain('Resets remaining');
    });

    test('Claude shows 0, not a dash, when the proxy sent no reset inventory', () => {
      const markup = render({ quota: { ...quota, resetGrants: null } });
      const resetCell = windowCells(markup).at(-1) ?? '';
      expect(resetCell).toContain('Resets remaining');
      expect(resetCell).toContain('<span>0</span>');
      expect(resetCell).not.toContain('--');
    });

    test('reset counts share one inline label: count shape for Claude and Codex', () => {
      const claudeCell = windowCells(render()).at(-1) ?? '';
      expect(claudeCell).toMatch(/Resets remaining:<span>\d+<\/span><\/span><\/div>/);

      const codexCell =
        windowCells(
          render({
            entry: codexEntry,
            quota: { ...codexQuota, rateLimitResetCreditsAvailableCount: 3 },
          })
        ).at(-1) ?? '';
      expect(codexCell).toContain('Manual resets:<span>3</span></span></div>');
      expect(codexCell).not.toContain('available');
    });

    test('a provider without resets renders no reset cell and no placeholder', () => {
      const markup = render({ entry: codexEntry, quota: codexQuota });
      const children = topLevelChildren(markup);
      expect(children).toHaveLength(3);
      const cells = windowCells(markup);
      expect(cells).toHaveLength(1);
      expect(cells[0]).toContain('Weekly limit');
      expect(markup).not.toContain('Manual resets');
    });

    test('idle, loading and error rows render no reset cell', () => {
      for (const state of [undefined, { status: 'loading' }, { status: 'error', error: 'boom' }]) {
        const markup = render({ quota: state as never });
        expect(topLevelChildren(markup)).toHaveLength(3);
        expect(markup).not.toContain('Resets remaining');
      }
    });
  });
});
