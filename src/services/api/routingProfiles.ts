import { apiClient } from './client';
import { getConfigValue } from './configValue';

export interface RoutingAuthOverride {
  priority?: number;
  disabled?: boolean;
  excludedModels?: string[];
}
export interface RoutingProfile {
  allowedAuths?: string[];
  excludedModels?: string[];
  auths?: Record<string, RoutingAuthOverride>;
}
export type RoutingProfiles = Record<string, RoutingProfile>;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;

export function normalizeRoutingProfiles(value: unknown): RoutingProfiles {
  return Object.fromEntries(
    Object.entries(record(value)).map(([name, raw]) => {
      const profile = record(raw);
      const auths = Object.fromEntries(
        Object.entries(record(profile.auths)).map(([id, rawRule]) => {
          const rule = record(rawRule);
          return [
            id,
            {
              priority: typeof rule.priority === 'number' ? rule.priority : undefined,
              disabled: typeof rule.disabled === 'boolean' ? rule.disabled : undefined,
              excludedModels: strings(rule['excluded-models']),
            },
          ];
        })
      );
      return [
        name,
        {
          allowedAuths: strings(profile['allowed-auths']),
          excludedModels: strings(profile['excluded-models']),
          auths,
        },
      ];
    })
  );
}

export function serializeRoutingProfiles(profiles: RoutingProfiles) {
  const clean = (items?: string[]) =>
    items === undefined
      ? undefined
      : [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  return Object.fromEntries(
    Object.entries(profiles).map(([name, profile]) => [
      name,
      {
        'allowed-auths': profile.allowedAuths,
        'excluded-models': clean(profile.excludedModels),
        auths: Object.fromEntries(
          Object.entries(profile.auths ?? {}).map(([id, rule]) => [
            id,
            {
              priority: rule.priority,
              disabled: rule.disabled,
              'excluded-models': clean(rule.excludedModels),
            },
          ])
        ),
      },
    ])
  );
}

export const routingProfilesApi = {
  async list(): Promise<RoutingProfiles> {
    return normalizeRoutingProfiles(await getConfigValue('/config/routing/profiles', {}));
  },
  replace: (profiles: RoutingProfiles) =>
    apiClient.put('/config/routing/profiles', serializeRoutingProfiles(profiles)),
};
