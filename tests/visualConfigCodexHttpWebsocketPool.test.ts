import { describe, expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import { getVisualConfigValidationErrors } from '../src/hooks/useVisualConfig';
import { DEFAULT_VISUAL_VALUES, type VisualConfigValues } from '../src/types/visualConfig';
import { runVisualConfig } from './helpers/visualConfig';

// Backend contract: internal/config/config_types.go CodexHTTPWebsocketPoolConfig. The pool is
// enabled unless upstream.codex.http-websocket-pool.enabled is false; zero/empty values select
// the built-in defaults (10m idle, 512 sockets, 64 per credential). config_v8.go has no
// oauth.providers.codex alias for it, so only the canonical upstream path is read and written.
const base = 'config-version: 8\n';
const configured = `config-version: 8
upstream:
  codex:
    http-websocket-pool:
      enabled: false
      idle-timeout: 4m
      max-sockets: 9
      max-sockets-per-auth: 3
`;

const errors = (patch: Partial<VisualConfigValues>) =>
  getVisualConfigValidationErrors({ ...DEFAULT_VISUAL_VALUES, ...patch });

describe('Codex HTTP websocket pool settings', () => {
  test('reflects the backend defaults when the section is absent', () => {
    for (const yaml of [base, 'config-version: 8\nupstream: {codex: {}}\n']) {
      const { visualValues } = runVisualConfig(yaml);
      expect(visualValues.codexHttpWebsocketPoolEnabled).toBe(true);
      expect(visualValues.codexHttpWebsocketPoolIdleTimeout).toBe('');
      expect(visualValues.codexHttpWebsocketPoolMaxSockets).toBe('');
      expect(visualValues.codexHttpWebsocketPoolMaxSocketsPerAuth).toBe('');
    }
  });

  test('reads the canonical upstream path', () => {
    const { visualValues } = runVisualConfig(configured);
    expect(visualValues.codexHttpWebsocketPoolEnabled).toBe(false);
    expect(visualValues.codexHttpWebsocketPoolIdleTimeout).toBe('4m');
    expect(visualValues.codexHttpWebsocketPoolMaxSockets).toBe('9');
    expect(visualValues.codexHttpWebsocketPoolMaxSocketsPerAuth).toBe('3');
  });

  test('no-op and unrelated saves never write the pool section', () => {
    expect(parseYaml(runVisualConfig(base).applyVisualChangesToYaml(base))).toEqual({
      'config-version': 8,
    });
    const unrelated = runVisualConfig(base, [{ codexResponseSteering: true }]);
    const output = parseYaml(unrelated.applyVisualChangesToYaml(base));
    expect(output.upstream).toBeUndefined();
    // Toggling off and back on returns to the baseline, so nothing is written.
    const roundTrip = runVisualConfig(base, [
      { codexHttpWebsocketPoolEnabled: false },
      { codexHttpWebsocketPoolEnabled: true },
    ]);
    expect(parseYaml(roundTrip.applyVisualChangesToYaml(base))).toEqual({ 'config-version': 8 });
  });

  test('disabling writes an explicit false under upstream.codex only', () => {
    const config = runVisualConfig(base, [{ codexHttpWebsocketPoolEnabled: false }]);
    const output = config.applyVisualChangesToYaml(base);
    expect(parseYaml(output)).toEqual({
      'config-version': 8,
      upstream: { codex: { 'http-websocket-pool': { enabled: false } } },
    });
    expect(runVisualConfig(output).visualValues.codexHttpWebsocketPoolEnabled).toBe(false);
  });

  test('writes and clears the tuning values', () => {
    const config = runVisualConfig(base, [
      {
        codexHttpWebsocketPoolIdleTimeout: '15m',
        codexHttpWebsocketPoolMaxSockets: '256',
        codexHttpWebsocketPoolMaxSocketsPerAuth: '32',
      },
    ]);
    expect(parseYaml(config.applyVisualChangesToYaml(base))).toEqual({
      'config-version': 8,
      upstream: {
        codex: {
          'http-websocket-pool': {
            'idle-timeout': '15m',
            'max-sockets': 256,
            'max-sockets-per-auth': 32,
          },
        },
      },
    });

    const reenabled = runVisualConfig(configured, [
      { codexHttpWebsocketPoolEnabled: true, codexHttpWebsocketPoolIdleTimeout: '' },
    ]);
    expect(
      parseYaml(reenabled.applyVisualChangesToYaml(configured)).upstream.codex[
        'http-websocket-pool'
      ]
    ).toEqual({ enabled: true, 'max-sockets': 9, 'max-sockets-per-auth': 3 });
  });

  test('validates the idle timeout and socket caps like nearby Codex fields', () => {
    for (const value of ['', '10m', '90s', '1h30m', '600', '+600', '0', '0s']) {
      expect(
        errors({ codexHttpWebsocketPoolIdleTimeout: value }).codexHttpWebsocketPoolIdleTimeout
      ).toBeUndefined();
    }
    for (const value of ['-1m', '-5', '1d', 'soon', '9223372037']) {
      expect(
        errors({ codexHttpWebsocketPoolIdleTimeout: value }).codexHttpWebsocketPoolIdleTimeout
      ).toBe('invalid_duration');
    }
    for (const key of [
      'codexHttpWebsocketPoolMaxSockets',
      'codexHttpWebsocketPoolMaxSocketsPerAuth',
    ] as const) {
      // The backend uses its default for any cap <= 0, so negative values are accepted
      // rather than blocking unrelated saves.
      for (const value of ['', '0', '64', '-1']) {
        expect(errors({ [key]: value })[key]).toBeUndefined();
      }
      for (const value of ['1.5', 'many']) {
        expect(errors({ [key]: value })[key]).toBe('integer');
      }
    }
  });
});
