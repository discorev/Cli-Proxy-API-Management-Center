import { describe, expect, test } from 'bun:test';
import { PROVIDER_LOGOS } from '../src/features/providers/brandLogos';
import { PROVIDER_DESCRIPTORS } from '../src/features/providers/descriptors';
import {
  isOpenAICompatibleProviderBrand,
  isOpenRouterBaseUrl,
  isOpenRouterProvider,
  OPENROUTER_BASE_URL,
  OPENROUTER_PROVIDER_NAME,
} from '../src/features/providers/openRouter';
import { buildInitialProviderForm } from '../src/features/providers/sheets/forms/providerFormState';
import {
  MODEL_DISCOVERY_BRANDS,
  isModelDiscoveryBrand,
} from '../src/features/providers/sheets/forms/useModelDiscovery';
import {
  buildOpenAIConfig,
  buildProviderGroups,
} from '../src/features/providers/useProviderWorkbench';
import type { ProviderEntryFormInput } from '../src/features/providers/types';
import type { OpenAIProviderConfig } from '../src/types';

describe('OpenRouter provider preset', () => {
  test('prefills the existing OpenAI-compatible form workflow', () => {
    const form = buildInitialProviderForm('openrouter', null, 'create');

    expect(form.name).toBe(OPENROUTER_PROVIDER_NAME);
    expect(form.baseUrl).toBe(OPENROUTER_BASE_URL);
    expect(form.apiKeyEntries).toEqual([{ apiKey: '', proxyUrl: '', weight: undefined }]);
    expect(form.models).toEqual([{ name: '', alias: '' }]);
    expect(PROVIDER_DESCRIPTORS.openrouter).toMatchObject({
      supportsName: true,
      supportsBaseUrl: true,
      supportsModels: true,
      supportsTestModel: true,
      supportsApiKeyEntries: true,
    });
    expect(PROVIDER_LOGOS.openrouter.src).toContain('openrouter.png');
    expect(PROVIDER_LOGOS.openrouter.icon).toBeUndefined();
    expect(isOpenAICompatibleProviderBrand('openrouter')).toBeTrue();
    expect(isModelDiscoveryBrand('openrouter')).toBeTrue();
    expect(MODEL_DISCOVERY_BRANDS).toContain('openrouter');
  });

  test('recognizes only the native HTTPS endpoint, independent of provider name', () => {
    for (const endpoint of [
      OPENROUTER_BASE_URL,
      `${OPENROUTER_BASE_URL}/`,
      `  https://OPENROUTER.AI/api/v1/  `,
    ]) {
      expect(isOpenRouterBaseUrl(endpoint)).toBeTrue();
      expect(isOpenRouterProvider({ name: 'Any readable name', baseUrl: endpoint })).toBeTrue();
    }

    for (const endpoint of [
      'http://openrouter.ai/api/v1',
      'https://api.openrouter.ai/api/v1',
      'https://openrouter.ai:444/api/v1',
      'https://openrouter.ai.evil.test/api/v1',
      'https://gateway.example.com/openrouter.ai/api/v1',
      'https://openrouter.ai/api/v10',
      'https://openrouter.ai/api/v1/chat/completions',
      'https://openrouter.ai/prefix/api/v1',
      'https://openrouter.ai/api/v1?mode=test',
      'https://openrouter.ai/api/v1#models',
    ]) {
      expect(isOpenRouterBaseUrl(endpoint)).toBeFalse();
    }

    expect(
      isOpenRouterProvider({ name: OPENROUTER_PROVIDER_NAME, baseUrl: 'https://example.com/v1' })
    ).toBeFalse();
  });

  test('surfaces native configs without changing data and keeps custom names/endpoints generic', () => {
    const native: OpenAIProviderConfig = {
      name: 'Existing Router',
      baseUrl: `${OPENROUTER_BASE_URL}/`,
      prefix: 'router',
      priority: 4,
      disabled: true,
      headers: { 'HTTP-Referer': 'https://example.com' },
      models: [{ name: 'openai/gpt-4.1', alias: 'gpt-4.1' }],
      apiKeyEntries: [{ apiKey: 'native-key', proxyUrl: 'http://127.0.0.1:7890', weight: 2 }],
      sourceIndex: 5,
    };
    const sameNameCustom: OpenAIProviderConfig = {
      name: OPENROUTER_PROVIDER_NAME,
      baseUrl: 'https://gateway.example.com/v1',
      apiKeyEntries: [{ apiKey: 'custom-key' }],
      sourceIndex: 7,
    };
    const lookalike: OpenAIProviderConfig = {
      name: 'Lookalike',
      baseUrl: 'https://openrouter.ai.evil.test/api/v1',
      apiKeyEntries: [{ apiKey: 'lookalike-key' }],
      sourceIndex: 9,
    };

    const groups = buildProviderGroups({
      openaiCompatibility: [native, sameNameCustom, lookalike],
    });
    const openrouter = groups.find((group) => group.id === 'openrouter')!.resources;
    const generic = groups.find((group) => group.id === 'openaiCompatibility')!.resources;

    expect(openrouter).toHaveLength(1);
    expect(openrouter[0]).toMatchObject({
      brand: 'openrouter',
      originalIndex: 5,
      name: native.name,
      baseUrl: native.baseUrl,
      prefix: native.prefix,
      priority: 4,
      disabled: true,
      models: ['openai/gpt-4.1'],
      apiKeyEntryCount: 1,
      raw: native,
      selector: {
        brand: 'openaiCompatibility',
        name: native.name,
        index: 5,
      },
    });
    expect(generic.map((resource) => resource.raw)).toEqual([sameNameCustom, lookalike]);
    expect(generic.map((resource) => resource.originalIndex)).toEqual([7, 9]);
  });

  test('uses OpenAI-compatible update data while preserving keys and model settings', () => {
    const existing: OpenAIProviderConfig = {
      name: 'Existing Router',
      baseUrl: OPENROUTER_BASE_URL,
      disabled: false,
      apiKeyEntries: [
        {
          apiKey: 'persisted-key',
          proxyUrl: 'http://old-proxy.example',
          weight: 1,
          authIndex: 'persisted-auth-index',
        },
      ],
      models: [{ name: 'old-model', alias: 'old-alias' }],
      sourceIndex: 12,
    };
    const input: ProviderEntryFormInput = {
      ...buildInitialProviderForm('openrouter', null, 'create'),
      name: 'Edited Router',
      baseUrl: 'https://gateway.example.com/v1',
      disabled: true,
      prefix: 'edited',
      priority: 8,
      testModel: 'openai/gpt-4.1',
      headers: [{ key: 'HTTP-Referer', value: 'https://example.com' }],
      models: [
        {
          name: 'openai/gpt-4.1',
          alias: 'gpt-4.1',
          priority: 3,
          testModel: 'openai/gpt-4.1',
          image: true,
        },
      ],
      apiKeyEntries: [
        {
          apiKey: '',
          existingApiKey: 'persisted-key',
          proxyUrl: 'http://new-proxy.example',
          weight: 6,
          authIndex: 'persisted-auth-index',
        },
      ],
    };

    const updated = buildOpenAIConfig(input, existing);

    expect(updated).toMatchObject({
      name: 'Edited Router',
      baseUrl: 'https://gateway.example.com/v1',
      disabled: true,
      prefix: 'edited',
      priority: 8,
      testModel: 'openai/gpt-4.1',
      headers: { 'HTTP-Referer': 'https://example.com' },
      apiKeyEntries: [
        {
          apiKey: 'persisted-key',
          proxyUrl: 'http://new-proxy.example',
          weight: 6,
          authIndex: 'persisted-auth-index',
        },
      ],
      models: [
        {
          name: 'openai/gpt-4.1',
          alias: 'gpt-4.1',
          priority: 3,
          testModel: 'openai/gpt-4.1',
          image: true,
        },
      ],
      sourceIndex: 12,
    });
    expect(isOpenRouterProvider(updated)).toBeFalse();

    const regrouped = buildProviderGroups({ openaiCompatibility: [updated] });
    expect(regrouped.find((group) => group.id === 'openrouter')!.resources).toHaveLength(0);
    expect(regrouped.find((group) => group.id === 'openaiCompatibility')!.resources[0].raw).toBe(
      updated
    );
  });
});
