import { describe, expect, test } from 'bun:test';
import { openaiToResource } from '../src/features/providers/adapters';
import {
  buildKimiRaw,
  KIMI_OPENAI_BASE_URL,
  KIMI_PROVIDER_NAME,
} from '../src/features/providers/kimi';
import { normalizeConfigResponse } from '../src/services/api/transformers';

const customOpenAIConfig = () => ({
  openaiCompatibility: [
    {
      name: KIMI_PROVIDER_NAME,
      baseUrl: 'https://gateway.example.com/v1',
      apiKeyEntries: [{ apiKey: 'test-key' }],
    },
  ],
});

describe('multi-protocol preset custom endpoint isolation', () => {
  test('keeps same-name custom endpoints in the generic OpenAI group', () => {
    expect(buildKimiRaw(customOpenAIConfig()).openai).toEqual([]);
  });

  test('keeps same-name custom entries outside grouped edit and delete targets', () => {
    const raw = buildKimiRaw({
      openaiCompatibility: [
        {
          name: KIMI_PROVIDER_NAME,
          baseUrl: KIMI_OPENAI_BASE_URL,
          apiKeyEntries: [{ apiKey: 'official-key' }],
        },
        {
          name: KIMI_PROVIDER_NAME,
          baseUrl: 'https://gateway.example.com/v1',
          apiKeyEntries: [{ apiKey: 'custom-key' }],
        },
      ],
    });

    expect(raw.openai.map((item) => item.index)).toEqual([0]);
  });

  test('keeps backend indexes when normalization filters an unnamed item', () => {
    const config = normalizeConfigResponse({
      'api-keys': {
        'openai-compatibility': [
          { 'base-url': 'https://invalid.example.com/v1', keys: [] },
          {
            name: KIMI_PROVIDER_NAME,
            'base-url': KIMI_OPENAI_BASE_URL,
            keys: [{ 'api-key': 'official-a' }],
          },
          {
            name: KIMI_PROVIDER_NAME,
            'base-url': 'https://gateway.example.com/v1',
            keys: [{ 'api-key': 'custom-key' }],
          },
          {
            name: KIMI_PROVIDER_NAME,
            'base-url': KIMI_OPENAI_BASE_URL,
            keys: [{ 'api-key': 'official-b' }],
          },
        ],
      },
    });

    expect(config.openaiCompatibility?.map((item) => item.sourceIndex)).toEqual([1, 2, 3]);
    expect(buildKimiRaw(config).openai.map((item) => item.index)).toEqual([1, 3]);
    expect(openaiToResource(config.openaiCompatibility![1], 1).originalIndex).toBe(2);
  });

  test('recognizes the official endpoint regardless of provider name', () => {
    expect(
      buildKimiRaw({
        openaiCompatibility: [
          {
            name: 'custom-name',
            baseUrl: KIMI_OPENAI_BASE_URL,
            apiKeyEntries: [{ apiKey: 'official-key' }],
          },
        ],
      }).openai
    ).toHaveLength(1);
  });
});
