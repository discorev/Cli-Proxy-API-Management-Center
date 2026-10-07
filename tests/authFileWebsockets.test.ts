import { describe, expect, test } from 'bun:test';
import {
  buildAuthFileFieldsPatch,
  type PrefixProxyEditorState,
} from '../src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import {
  authFileWebsocketsDefault,
  readAuthFileWebsockets,
} from '../src/features/authFiles/constants';

// Backend contract: sdk/cliproxy/auth/websockets.go. A missing websockets key means on for
// Codex OAuth/file credentials; explicit values always win; API-key Codex credentials and
// other providers (xAI) stay opt-in.
const makeEditor = (
  providerKey: string,
  json: Record<string, unknown>,
  websockets: boolean,
  websocketsTouched: boolean
): PrefixProxyEditorState => ({
  fileName: 'credential.json',
  fileInfoText: '',
  loading: false,
  saving: false,
  error: null,
  originalText: JSON.stringify(json),
  rawText: JSON.stringify(json),
  invalidContentPreview: '',
  json,
  providerKey,
  prefix: '',
  proxyUrl: '',
  priority: '',
  weight: '',
  weightError: null,
  disableCooling: false,
  disableCoolingTouched: false,
  websockets,
  websocketsTouched,
  usingApi: false,
  usingApiTouched: false,
  note: '',
  noteTouched: false,
  excludedModelsText: '',
  excludedModelsTouched: false,
  headersText: '',
  headersTouched: false,
  headersError: null,
});

const resolveError = (key: string) => key;

describe('auth-file websockets default', () => {
  test('a missing key reads as on for Codex OAuth files only', () => {
    expect(readAuthFileWebsockets({ type: 'codex' }, 'codex')).toBe(true);
    expect(readAuthFileWebsockets({ type: 'codex', auth_kind: 'oauth' }, 'codex')).toBe(true);
    expect(readAuthFileWebsockets({ type: 'xai' }, 'xai')).toBe(false);
    for (const authKind of ['apikey', 'api_key', 'API-Key']) {
      expect(readAuthFileWebsockets({ auth_kind: authKind }, 'codex')).toBe(false);
      expect(authFileWebsocketsDefault('codex', { auth_kind: authKind })).toBe(false);
    }
    expect(authFileWebsocketsDefault('codex', {})).toBe(true);
    expect(authFileWebsocketsDefault('xai', {})).toBe(false);
  });

  test('explicit values win over the default', () => {
    expect(readAuthFileWebsockets({ websockets: false }, 'codex')).toBe(false);
    expect(readAuthFileWebsockets({ websockets: 'false' }, 'codex')).toBe(false);
    expect(readAuthFileWebsockets({ websocket: false }, 'codex')).toBe(false);
    expect(readAuthFileWebsockets({ websockets: true }, 'xai')).toBe(true);
    // Unparseable values fall back to the default, as the backend does.
    expect(readAuthFileWebsockets({ websockets: 'maybe' }, 'codex')).toBe(true);
  });

  test('never writes the key unless the user changes the effective value', () => {
    const codex = { type: 'codex' };
    expect(buildAuthFileFieldsPatch(makeEditor('codex', codex, true, false), resolveError)).toEqual(
      {}
    );
    // Touched but still on (the default): nothing to write.
    expect(buildAuthFileFieldsPatch(makeEditor('codex', codex, true, true), resolveError)).toEqual(
      {}
    );
    expect(buildAuthFileFieldsPatch(makeEditor('codex', codex, false, true), resolveError)).toEqual(
      { websockets: false }
    );
    const optedOut = { type: 'codex', websockets: false };
    expect(
      buildAuthFileFieldsPatch(makeEditor('codex', optedOut, true, true), resolveError)
    ).toEqual({ websockets: true });
    const xai = { type: 'xai' };
    expect(buildAuthFileFieldsPatch(makeEditor('xai', xai, false, true), resolveError)).toEqual({});
    expect(buildAuthFileFieldsPatch(makeEditor('xai', xai, true, true), resolveError)).toEqual({
      websockets: true,
    });
  });
});
