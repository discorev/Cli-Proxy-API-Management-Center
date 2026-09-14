import { describe, expect, test } from 'bun:test';
import { buildProviderGroups } from '../src/features/providers/useProviderWorkbench';
import type { Config } from '../src/types';

const retiredProviders = [
  ['APIKEY.FUN', 'apikeyFun', 'https://api.apikey.fan'],
  ['FennoAI', 'fennoAI', 'https://api.fenno.ai'],
  ['Qiniu Cloud', 'qiniuCloud', 'https://api.qnaigc.com'],
  ['Code0', 'code0', 'https://code0.ai'],
  ['LMU AI', 'lmuAI', 'https://api.lmuai.com'],
  ['Infistar', 'infistar', 'https://coneverse.com'],
  ['Infistar', 'infistar', 'https://infistar.ai'],
  ['Claude API', 'claudeApi', 'https://gw.apito.ai'],
  ['Claude API', 'claudeApi', 'https://gw.claudeapi.com'],
] as const;

const retiredBrandIds = [
  'apikeyFun',
  'fennoAI',
  'qiniuCloud',
  'code0',
  'lmuAI',
  'infistar',
  'claudeApi',
] as const;

describe('removed quick-access providers', () => {
  test('removes retired brand groups while retaining Kimi and adding OpenRouter', () => {
    const ids = buildProviderGroups({}).map((group) => group.id);
    for (const brand of retiredBrandIds) {
      expect(ids).not.toContain(brand);
    }
    expect(ids).toContain('kimi');
    expect(ids).toContain('openrouter');
  });

  for (const [label, name, baseUrl] of retiredProviders) {
    test(`keeps ${label} configs at ${baseUrl} editable in generic protocol groups`, () => {
      const key = {
        apiKey: 'test-retired-key',
        baseUrl,
        proxyUrl: 'http://127.0.0.1:7890',
        prefix: 'retired',
        priority: 7,
        weight: 3,
        headers: { 'X-Retired': 'kept' },
        models: [{ name: 'retired-model', alias: 'retired-alias' }],
        excludedModels: ['*', 'excluded-model'],
        disableCooling: true,
        fingerprintProfile: 'claude-code-cli',
      };
      const openai = {
        name,
        baseUrl: `${baseUrl}/v1`,
        prefix: 'retired-openai',
        priority: 9,
        headers: { 'X-OpenAI-Retired': 'kept' },
        models: [{ name: 'openai-model', alias: 'openai-alias', image: true }],
        testModel: 'openai-model',
        apiKeyEntries: [
          {
            apiKey: 'test-retired-openai-key',
            proxyUrl: 'http://127.0.0.1:7891',
            weight: 5,
          },
        ],
        sourceIndex: 7,
        disabled: true,
        disableCooling: true,
      };
      const config: Config = {
        geminiApiKeys: [key],
        codexApiKeys: [key],
        claudeApiKeys: [key],
        openaiCompatibility: [openai],
      };
      const groups = buildProviderGroups(config);

      for (const brand of ['gemini', 'codex', 'claude'] as const) {
        const resources = groups.find((group) => group.id === brand)!.resources;
        expect(resources).toHaveLength(1);
        const resource = resources[0];
        expect(resource.brand).toBe(brand);
        expect(resource.disabled).toBe(true);
        expect(resource.baseUrl).toBe(baseUrl);
        expect(resource.proxyUrl).toBe(key.proxyUrl);
        expect(resource.prefix).toBe(key.prefix);
        expect(resource.models).toEqual(['retired-model']);
        expect(resource.excludedModelCount).toBe(1);
        expect(resource.headerCount).toBe(1);
        expect(resource.priority).toBe(7);
        expect(resource.raw).toBe(key);
        expect(resource.selector).toEqual({
          brand,
          apiKey: key.apiKey,
          baseUrl,
          index: 0,
        });
        if (brand === 'claude') expect(resource.flags.claudeCodeCliProfile).toBe(true);
      }

      const openaiResources = groups.find((group) => group.id === 'openaiCompatibility')!.resources;
      expect(openaiResources).toHaveLength(1);
      expect(openaiResources[0]).toMatchObject({
        brand: 'openaiCompatibility',
        disabled: true,
        baseUrl: openai.baseUrl,
        prefix: openai.prefix,
        models: ['openai-model'],
        modelCount: 1,
        headerCount: 1,
        apiKeyEntryCount: 1,
        priority: 9,
        raw: openai,
        selector: { brand: 'openaiCompatibility', name, index: 7 },
      });
      expect(groups.flatMap((group) => group.resources)).toHaveLength(4);
    });
  }
});
