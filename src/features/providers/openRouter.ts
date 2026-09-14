import type { OpenAIProviderConfig } from '@/types';
import type { OpenAICompatibleProviderBrand, ProviderBrand } from './types';

export const OPENROUTER_PROVIDER_NAME = 'OpenRouter';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const isOpenAICompatibleProviderBrand = (
  brand: ProviderBrand
): brand is OpenAICompatibleProviderBrand =>
  brand === 'openrouter' || brand === 'openaiCompatibility';

export const isOpenRouterBaseUrl = (value: string | undefined | null): boolean => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return false;

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return (
      url.protocol === 'https:' &&
      url.hostname === 'openrouter.ai' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      pathname === '/api/v1'
    );
  } catch {
    return false;
  }
};

export const isOpenRouterProvider = (config: OpenAIProviderConfig | undefined | null): boolean =>
  Boolean(config && isOpenRouterBaseUrl(config.baseUrl));
