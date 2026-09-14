import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readPersistedRedactNames, writePersistedRedactNames } from '@/utils/redactNamesPreference';

const KEY = 'ui.redactNames';
const originalWindow = (globalThis as { window?: unknown }).window;

function installLocalStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
  return storage;
}

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
  storage = installLocalStorage();
});

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe('shared name redaction preference', () => {
  test("is absent until it is chosen, so the default stays the caller's to pick", () => {
    expect(readPersistedRedactNames()).toBeNull();
  });

  test('round-trips through the shared localStorage key', () => {
    writePersistedRedactNames(true);
    expect(readPersistedRedactNames()).toBe(true);
    expect(storage.getItem(KEY)).toBe('true');

    writePersistedRedactNames(false);
    expect(readPersistedRedactNames()).toBe(false);
    expect(storage.getItem(KEY)).toBe('false');
  });

  test('treats a malformed payload as unset instead of as redacted', () => {
    storage.setItem(KEY, '{not json');
    expect(readPersistedRedactNames()).toBeNull();
  });
});
