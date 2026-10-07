import { describe, expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse as parseYaml } from 'yaml';
import { parseRoutingStrategy, useVisualConfig } from '../src/hooks/useVisualConfig';
import { DEFAULT_VISUAL_VALUES } from '../src/types/visualConfig';
import { isDefaultedRoutingStrategy } from '../src/utils/routingStrategy';
import { runVisualConfig } from './helpers/visualConfig';

describe('visual config weighted routing strategy', () => {
  test('recognizes the weighted-round-robin backend value', () => {
    expect(parseRoutingStrategy('weighted-round-robin')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('weightedroundrobin')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('wrr')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('fill-first')).toBe('fill-first');
    expect(parseRoutingStrategy('fillfirst')).toBe('fill-first');
    expect(parseRoutingStrategy('ff')).toBe('fill-first');
    expect(parseRoutingStrategy('intelligent-fill')).toBe('intelligent-fill');
    expect(parseRoutingStrategy(' Intelligent-Fill ')).toBe('intelligent-fill');
    expect(parseRoutingStrategy('intelligentfill')).toBe('intelligent-fill');
    expect(parseRoutingStrategy('if')).toBe('intelligent-fill');
    expect(parseRoutingStrategy(' IF ')).toBe('intelligent-fill');
    expect(parseRoutingStrategy(undefined)).toBe('intelligent-fill');
  });

  test('writes weighted-round-robin without coercing it to round-robin', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.setVisualValues({ routingStrategy: 'weighted-round-robin' });
        setPhase(1);
      } else {
        return createElement(
          'pre',
          null,
          visualConfig.applyVisualChangesToYaml('routing:\n  strategy: round-robin\n')
        );
      }

      return null;
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    const result = markup.slice('<pre>'.length, -'</pre>'.length);

    expect(parseYaml(result)).toEqual({ routing: { strategy: 'weighted-round-robin' } });
  });
});

describe('intelligent-fill and reset-credits auto-apply', () => {
  test('reads and writes intelligent-fill', () => {
    const yaml = 'config-version: 8\nrouting:\n  strategy: intelligent-fill\n';
    expect(runVisualConfig(yaml).visualValues.routingStrategy).toBe('intelligent-fill');
    const config = runVisualConfig('routing:\n  strategy: round-robin\n', [
      { routingStrategy: 'intelligent-fill' },
    ]);
    expect(
      parseYaml(config.applyVisualChangesToYaml('routing:\n  strategy: round-robin\n'))
    ).toEqual({
      routing: { strategy: 'intelligent-fill' },
    });
  });

  test('auto-apply defaults off and only true opts in', () => {
    for (const [yaml, expected] of [
      ['config-version: 8\n', false],
      ['reset-credits:\n  auto-apply: false\n', false],
      ['reset-credits:\n  auto-apply: "true"\n', false],
      ['reset-credits: null\n', false],
      ['reset-credits:\n  auto-apply: true\n', true],
    ] as const) {
      expect(runVisualConfig(yaml).visualValues.resetCreditsAutoApply).toBe(expected);
    }
  });

  test('writes reset-credits.auto-apply only when edited, including explicit false', () => {
    const base = 'config-version: 8\nrouting:\n  strategy: fill-first\n';
    expect(parseYaml(runVisualConfig(base).applyVisualChangesToYaml(base))).toEqual({
      'config-version': 8,
      routing: { strategy: 'fill-first' },
    });
    const on = runVisualConfig(base, [{ resetCreditsAutoApply: true }]);
    expect(parseYaml(on.applyVisualChangesToYaml(base))).toEqual({
      'config-version': 8,
      routing: { strategy: 'fill-first' },
      'reset-credits': { 'auto-apply': true },
    });
    const enabled = 'config-version: 8\nreset-credits:\n  auto-apply: true\n';
    const off = runVisualConfig(enabled, [{ resetCreditsAutoApply: false }]);
    expect(parseYaml(off.applyVisualChangesToYaml(enabled))).toEqual({
      'config-version': 8,
      'reset-credits': { 'auto-apply': false },
    });
    const nullSection = 'config-version: 8\nreset-credits: null\n';
    const fromNull = runVisualConfig(nullSection, [{ resetCreditsAutoApply: true }]);
    expect(parseYaml(fromNull.applyVisualChangesToYaml(nullSection))).toEqual({
      'config-version': 8,
      'reset-credits': { 'auto-apply': true },
    });
  });
});

// Backend contract: sdk/cliproxy/service_config.go normalizedRoutingRuntimeState defaults
// unset or unrecognized routing.strategy to intelligent-fill; round-robin must be explicit.
describe('intelligent-fill routing default', () => {
  test('unset and unknown strategies resolve to intelligent-fill', () => {
    expect(DEFAULT_VISUAL_VALUES.routingStrategy).toBe('intelligent-fill');
    for (const raw of [undefined, null, '', '  ', 'unknown', 42]) {
      expect(parseRoutingStrategy(raw)).toBe('intelligent-fill');
      expect(isDefaultedRoutingStrategy(raw)).toBe(true);
    }
    for (const raw of ['round-robin', 'roundrobin', 'rr', ' Round-Robin ', 'RR']) {
      expect(parseRoutingStrategy(raw)).toBe('round-robin');
      expect(isDefaultedRoutingStrategy(raw)).toBe(false);
    }
    for (const raw of ['intelligent-fill', 'fill-first', 'weighted-round-robin']) {
      expect(isDefaultedRoutingStrategy(raw)).toBe(false);
    }
  });

  test('reads intelligent-fill when routing.strategy is absent or null', () => {
    for (const yaml of [
      'config-version: 8\n',
      'config-version: 8\nrouting: null\n',
      'config-version: 8\nrouting:\n  session-affinity: true\n',
      'config-version: 8\nrouting:\n  strategy: bogus\n',
    ]) {
      expect(runVisualConfig(yaml).visualValues.routingStrategy).toBe('intelligent-fill');
    }
  });

  test('no-op saves do not inject a routing strategy', () => {
    for (const yaml of [
      'config-version: 8\n',
      'config-version: 8\nrouting:\n  session-affinity: true\n',
    ]) {
      expect(parseYaml(runVisualConfig(yaml).applyVisualChangesToYaml(yaml))).toEqual(
        parseYaml(yaml)
      );
      const unrelated = runVisualConfig(yaml, [{ port: '9000' }]);
      expect(parseYaml(unrelated.applyVisualChangesToYaml(yaml)).routing?.strategy).toBeUndefined();
    }
    // Selecting the default and switching back is not a change either.
    const yaml = 'config-version: 8\n';
    const roundTrip = runVisualConfig(yaml, [
      { routingStrategy: 'round-robin' },
      { routingStrategy: 'intelligent-fill' },
    ]);
    expect(parseYaml(roundTrip.applyVisualChangesToYaml(yaml))).toEqual({ 'config-version': 8 });
  });

  test('choosing round-robin on a config without a strategy writes it explicitly', () => {
    const yaml = 'config-version: 8\n';
    const config = runVisualConfig(yaml, [{ routingStrategy: 'round-robin' }]);
    const output = config.applyVisualChangesToYaml(yaml);
    expect(parseYaml(output)).toEqual({
      'config-version': 8,
      routing: { strategy: 'round-robin' },
    });
    expect(runVisualConfig(output).visualValues.routingStrategy).toBe('round-robin');
  });
});
