import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { XAI_CONFIG } from '@/features/quota/providers/xai/data';
import { apiCallApi, apiClient, type ApiCallRequest, type ApiCallResult } from '@/services/api';
import { XAI_API_CHAT_URL, XAI_API_ME_URL, isPaidXaiAuthFile } from '@/utils/quota';

const t = ((key: string) => key) as unknown as TFunction;
const originalApiCallRequest = apiCallApi.request;
const originalGet = apiClient.get.bind(apiClient);
const originalPost = apiClient.post.bind(apiClient);

const result = (statusCode: number, body: unknown = null): ApiCallResult => ({
  statusCode,
  header: {},
  bodyText: body === null ? '' : JSON.stringify(body),
  body,
});

const encodeJwt = (payload: Record<string, unknown>): string => {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${encoded}.signature`;
};

const paidFile = {
  name: 'paid.json',
  type: 'xai',
  auth_index: 'xai:1',
  using_api: true,
  prefix: 'paid',
};

describe('xAI paid API health probe', () => {
  let requests: ApiCallRequest[];
  let cacheCalls: string[];

  beforeEach(() => {
    requests = [];
    cacheCalls = [];
    apiClient.get = (async (url: string) => {
      cacheCalls.push(`GET ${url}`);
      return [];
    }) as typeof apiClient.get;
    apiClient.post = (async (url: string) => {
      cacheCalls.push(`POST ${url}`);
      return [];
    }) as typeof apiClient.post;
  });

  afterEach(() => {
    apiCallApi.request = originalApiCallRequest;
    apiClient.get = originalGet;
    apiClient.post = originalPost;
  });

  test('recognizes paid credentials without trusting individual route hints', () => {
    expect(isPaidXaiAuthFile({ name: 'paid-route.json', using_api: true, prefix: 'PAID' })).toBe(
      true
    );
    expect(
      isPaidXaiAuthFile({
        name: 'tier.json',
        metadata: { access_token: encodeJwt({ tier: 1 }) },
      })
    ).toBe(true);
    expect(isPaidXaiAuthFile({ name: 'using-api-only.json', using_api: true })).toBe(false);
    expect(isPaidXaiAuthFile({ name: 'prefix-only.json', prefix: 'paid' })).toBe(false);
    expect(isPaidXaiAuthFile({ name: 'free.json', using_api: false })).toBe(false);
    expect(isPaidXaiAuthFile({ name: 'free-default.json', base_url: 'https://api.x.ai/v1' })).toBe(
      false
    );
  });

  test('paid credentials skip auto-load', () => {
    expect(XAI_CONFIG.skipAutoLoad?.(paidFile)).toBe(true);
    expect(XAI_CONFIG.skipAutoLoad?.({ ...paidFile, prefix: undefined })).toBe(false);
  });

  for (const mode of ['fetchQuota', 'refreshQuota'] as const) {
    test(`${mode} probes /v1/me and a 1-token chat without the usage cache`, async () => {
      apiCallApi.request = async (payload) => {
        requests.push(payload);
        if (payload.url === XAI_API_ME_URL) {
          return result(200, { user_id: 'user-1', team_id: 'team-1' });
        }
        return result(200, { choices: [] });
      };

      const data = await XAI_CONFIG[mode]!(paidFile, t);

      expect(cacheCalls).toEqual([]);
      expect(requests.map((request) => request.url)).toEqual([XAI_API_ME_URL, XAI_API_CHAT_URL]);
      const chatRequest = requests.find((request) => request.url === XAI_API_CHAT_URL);
      expect(JSON.parse(chatRequest?.data ?? '{}')).toMatchObject({
        model: 'grok-4.5',
        max_tokens: 1,
        stream: false,
      });
      expect(data.usage).toBeUndefined();
      expect(data.billing).toMatchObject({
        mode: 'paid-health',
        source: 'api.x.ai-fallback',
        planType: 'paid',
        healthStatus: 'chat-ok',
        userId: 'user-1',
        teamId: 'team-1',
      });
    });
  }

  test('a failed chat probe rejects with its status', async () => {
    apiCallApi.request = async (payload) =>
      payload.url === XAI_API_CHAT_URL ? result(401, { error: 'Invalid token' }) : result(200, {});

    await expect(XAI_CONFIG.fetchQuota(paidFile, t)).rejects.toMatchObject({ status: 401 });
  });

  test('a using_api credential without the paid prefix reads the usage cache', async () => {
    apiCallApi.request = async (payload) => {
      requests.push(payload);
      return result(200, {});
    };
    apiClient.get = (async (url: string) => {
      cacheCalls.push(`GET ${url}`);
      return [{ auth_index: 'xai:3', raw: {} }];
    }) as typeof apiClient.get;

    await XAI_CONFIG.fetchQuota(
      { name: 'free.json', type: 'xai', auth_index: 'xai:3', using_api: true },
      t
    );

    expect(requests).toEqual([]);
    expect(cacheCalls).toEqual(['GET /credentials/usage']);
  });
});
