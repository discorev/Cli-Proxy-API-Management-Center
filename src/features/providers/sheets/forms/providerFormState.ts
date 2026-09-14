import { hasDisableAllModelsRule } from '@/components/providers/utils';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import {
  isOpenAICompatibleProviderBrand,
  OPENROUTER_BASE_URL,
  OPENROUTER_PROVIDER_NAME,
} from '../../openRouter';
import { readThinkingLevels } from '../../thinkingLevels';
import type {
  ApiKeyEntryInput,
  ModelEntryInput,
  ProviderBrand,
  ProviderEntryFormInput,
  ProviderResource,
} from '../../types';

export const emptyHeader = () => ({ key: '', value: '' });
export const emptyModel = (): ModelEntryInput => ({ name: '', alias: '' });
export const emptyApiKeyEntry = (): ApiKeyEntryInput => ({
  apiKey: '',
  proxyUrl: '',
  weight: undefined,
});

const XAI_API_BASE_URL = 'https://api.x.ai/v1';

const stripDisableAllRule = (list?: string[]): string[] =>
  (list ?? []).filter((item) => item.trim() !== '*');

const formatJsonObject = (value?: Record<string, unknown>): string => {
  if (!value || Object.keys(value).length === 0) return '';
  return JSON.stringify(value, null, 2);
};

const isClaudeLikeBrand = (brand: ProviderBrand): boolean => brand === 'claude';

export function buildInitialProviderForm(
  brand: ProviderBrand,
  resource: ProviderResource | null,
  mode: 'create' | 'edit'
): ProviderEntryFormInput {
  if (mode === 'create' || !resource) {
    return {
      apiKey: '',
      name: brand === 'openrouter' ? OPENROUTER_PROVIDER_NAME : '',
      baseUrl:
        brand === 'xai' ? XAI_API_BASE_URL : brand === 'openrouter' ? OPENROUTER_BASE_URL : '',
      proxyUrl: '',
      prefix: '',
      disabled: false,
      disableCooling: false,
      priority: undefined,
      weight: undefined,
      models: [emptyModel()],
      headers: [emptyHeader()],
      excludedModelsText: '',
      websockets: brand === 'codex' || brand === 'xai' ? false : undefined,
      cloak: isClaudeLikeBrand(brand)
        ? { mode: '', strictMode: false, sensitiveWordsText: '', cacheUserId: false }
        : undefined,
      fingerprintProfile: isClaudeLikeBrand(brand) ? '' : undefined,
      testModel:
        isOpenAICompatibleProviderBrand(brand) ||
        brand === 'codex' ||
        brand === 'xai' ||
        isClaudeLikeBrand(brand) ||
        brand === 'gemini' ||
        brand === 'interactions'
          ? ''
          : undefined,
      apiKeyEntries: isOpenAICompatibleProviderBrand(brand) ? [emptyApiKeyEntry()] : undefined,
    };
  }

  const raw = resource.raw;
  if (isOpenAICompatibleProviderBrand(brand)) {
    const config = raw as OpenAIProviderConfig;
    return {
      apiKey: '',
      name: config.name ?? '',
      baseUrl: config.baseUrl ?? '',
      proxyUrl: '',
      prefix: config.prefix ?? '',
      disabled: config.disabled === true,
      disableCooling: config.disableCooling === true,
      priority: config.priority,
      models: config.models?.length
        ? config.models.map((model) => ({
            name: model.name,
            alias: model.alias ?? '',
            priority: model.priority,
            testModel: model.testModel,
            image: model.image === true,
            thinkingJson: formatJsonObject(model.thinking),
            thinkingLevels: readThinkingLevels(model.thinking),
          }))
        : [emptyModel()],
      headers: config.headers
        ? Object.entries(config.headers).map(([key, value]) => ({ key, value: String(value) }))
        : [emptyHeader()],
      excludedModelsText: '',
      testModel: config.testModel ?? '',
      apiKeyEntries: config.apiKeyEntries?.length
        ? config.apiKeyEntries.map((entry) => ({
            apiKey: '',
            existingApiKey: entry.apiKey,
            proxyUrl: entry.proxyUrl ?? '',
            weight: entry.weight,
            authIndex: entry.authIndex,
          }))
        : [emptyApiKeyEntry()],
    };
  }

  const config = raw as GeminiKeyConfig & ProviderKeyConfig;
  const disabled = hasDisableAllModelsRule(config.excludedModels);
  const excludedList = stripDisableAllRule(config.excludedModels);
  return {
    // Keep the API key blank in edit mode. Pre-filling the real key makes this
    // password field a browser-autofill target (the saved management key can
    // overwrite it) and defeats the "leave empty = keep unchanged" contract.
    apiKey: '',
    name: '',
    baseUrl: config.baseUrl ?? '',
    proxyUrl: config.proxyUrl ?? '',
    prefix: config.prefix ?? '',
    disabled,
    disableCooling: config.disableCooling === true,
    priority: config.priority,
    weight: config.weight,
    models: config.models?.length
      ? config.models.map((model) => ({
          name: model.name,
          alias: model.alias ?? '',
          priority: model.priority,
          testModel: model.testModel,
          thinkingJson: formatJsonObject(model.thinking),
          thinkingLevels: readThinkingLevels(model.thinking),
        }))
      : [emptyModel()],
    headers: config.headers
      ? Object.entries(config.headers).map(([key, value]) => ({ key, value: String(value) }))
      : [emptyHeader()],
    excludedModelsText: excludedList.join('\n'),
    websockets:
      brand === 'codex' || brand === 'xai'
        ? (config as ProviderKeyConfig).websockets === true
        : undefined,
    cloak: isClaudeLikeBrand(brand)
      ? {
          mode: (config as ProviderKeyConfig).cloak?.mode ?? '',
          strictMode: (config as ProviderKeyConfig).cloak?.strictMode === true,
          sensitiveWordsText: (config as ProviderKeyConfig).cloak?.sensitiveWords?.join('\n') ?? '',
          cacheUserId: (config as ProviderKeyConfig).cloak?.cacheUserId === true,
        }
      : undefined,
    fingerprintProfile: isClaudeLikeBrand(brand)
      ? ((config as ProviderKeyConfig).fingerprintProfile ?? '')
      : undefined,
    testModel:
      brand === 'codex' ||
      brand === 'xai' ||
      isClaudeLikeBrand(brand) ||
      brand === 'gemini' ||
      brand === 'interactions'
        ? ''
        : undefined,
  };
}
