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
// every Codex auth file (the file synthesizer classifies all auth files as OAuth, whatever
// their auth_kind field says); explicit values always win; other providers (xAI) stay opt-in.
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
  test('a missing key reads as on for every Codex auth file', () => {
    expect(readAuthFileWebsockets({ type: 'codex' }, 'codex')).toBe(true);
    expect(readAuthFileWebsockets({ type: 'codex', auth_kind: 'oauth' }, 'codex')).toBe(true);
    // The proxy overrides a file's auth_kind with oauth, so this still defaults on.
    expect(readAuthFileWebsockets({ type: 'codex', auth_kind: 'apikey' }, 'codex')).toBe(true);
    expect(readAuthFileWebsockets({ type: 'xai' }, 'xai')).toBe(false);
    expect(authFileWebsocketsDefault('codex')).toBe(true);
    expect(authFileWebsocketsDefault('xai')).toBe(false);
  });

  test('explicit values win over the default', () => {
    expect(readAuthFileWebsockets({ websockets: false }, 'codex')).toBe(false);
    expect(readAuthFileWebsockets({ websockets: true }, 'xai')).toBe(true);
    // Every spelling Go's strconv.ParseBool accepts, after trimming.
    for (const value of ['0', 'f', 'F', 'FALSE', 'false', 'False', ' false ']) {
      expect(readAuthFileWebsockets({ websockets: value }, 'codex')).toBe(false);
    }
    for (const value of ['1', 't', 'T', 'TRUE', 'true', 'True']) {
      expect(readAuthFileWebsockets({ websockets: value }, 'xai')).toBe(true);
    }
    // Anything else is not explicit and falls back to the default, as the backend does.
    for (const value of ['maybe', 'no', 'off', 'fAlse', 0, 1]) {
      expect(readAuthFileWebsockets({ websockets: value }, 'codex')).toBe(true);
    }
    // The proxy ignores the legacy singular key.
    expect(readAuthFileWebsockets({ websocket: false }, 'codex')).toBe(true);
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
