const REDACT_NAMES_KEY = 'ui.redactNames';

export const readPersistedRedactNames = (): boolean | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(REDACT_NAMES_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) === true;
  } catch {
    return null;
  }
};

export const writePersistedRedactNames = (value: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REDACT_NAMES_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
};
