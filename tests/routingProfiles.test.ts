import { describe, expect, test } from 'bun:test';
import { parse } from 'yaml';
import {
  normalizeRoutingProfiles,
  serializeRoutingProfiles,
} from '../src/services/api/routingProfiles';
import { runVisualConfig } from './helpers/visualConfig';
import { buildConfigPatch } from '../src/services/api/configPatch';
import { resolveDirtyTabs } from '../src/features/config/uiState';

describe('routing profiles', () => {
  test('retains explicit empty overrides, zero priority and false disabled', () => {
    const raw = {
      default: {
        'excluded-models': ['blocked-*'],
        auths: { one: { priority: 10, disabled: true } },
      },
      secondary: {
        'allowed-auths': ['one', 'four'],
        'excluded-models': [],
        auths: {
          one: { priority: 0, disabled: false, 'excluded-models': [] },
          four: { priority: 20 },
        },
      },
    };
    expect(
      JSON.parse(JSON.stringify(serializeRoutingProfiles(normalizeRoutingProfiles(raw))))
    ).toEqual(raw);
  });
  test('normalizes textarea lines on save while preserving an explicit cleared list', () => {
    const raw = serializeRoutingProfiles({
      secondary: {
        excludedModels: [' blocked-* ', '', 'blocked-*'],
        auths: { one: { excludedModels: [''] } },
      },
    });
    expect(raw.secondary['excluded-models']).toEqual(['blocked-*']);
    expect(raw.secondary.auths.one['excluded-models']).toEqual([]);
  });
  test('assignments survive unrelated visual edits', () => {
    const before =
      'access: {api-keys: [fixture-key], api-key-profiles: {fixture-key: secondary}}\nrouting: {profiles: {secondary: {allowed-auths: [one, four]}}}\nserver: {port: 8317}\n';
    const visual = runVisualConfig(before, [{ port: '9000' }]);
    const next = visual.applyVisualChangesToYaml(before);
    expect(parse(next).access['api-key-profiles']).toEqual({ 'fixture-key': 'secondary' });
    expect(buildConfigPatch(before, next)).toEqual({
      patch: { server: { port: 9000 } },
      deletions: [],
    });
  });
  test('profile changes stay in the client access subtree', () => {
    const before = 'access: {api-keys: [fixture-key]}\nrouting: {profiles: {secondary: {}}}\n';
    const visual = runVisualConfig(before, [{ apiKeyProfiles: { 'fixture-key': 'secondary' } }]);
    expect(buildConfigPatch(before, visual.applyVisualChangesToYaml(before))).toEqual({
      patch: { access: { 'api-key-profiles': { 'fixture-key': 'secondary' } } },
      deletions: [],
    });
    expect(resolveDirtyTabs(new Set(['apiKeyProfiles']))).toContain('common');
  });
  test('clearing assignments deletes the mapping without deleting keys or profiles', () => {
    const before =
      'access: {api-keys: [fixture-key], api-key-profiles: {fixture-key: secondary}}\nrouting: {profiles: {secondary: {}}}\n';
    const visual = runVisualConfig(before, [{ apiKeyProfiles: {} }]);
    const result = parse(visual.applyVisualChangesToYaml(before));
    expect(result.access['api-key-profiles']).toEqual({});
    expect(result.access['api-keys']).toEqual(['fixture-key']);
    expect(result.routing.profiles).toEqual({ secondary: {} });
  });
});
