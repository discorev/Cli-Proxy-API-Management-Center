/**
 * Cached subscription usage for OAuth credentials (Claude, Codex).
 *
 * The backend owns every upstream usage, profile, subscription and reset call,
 * including the per-credential fetch floor and 429 cooldowns. The dashboard only
 * reads the cache, asks for a refresh, or asks the backend to spend a reset.
 */

import { apiClient } from './client';

/** The backend may take several upstream round trips before it answers a reset. */
const RESET_REQUEST_TIMEOUT_MS = 60_000;

export interface CredentialUsageRaw {
  usage?: unknown;
  profile?: unknown;
  subscription?: unknown;
  resetCredits?: unknown;
}

/** A Codex reset credit the backend can spend (it keeps only available, dated credits). */
export interface CredentialResetCredit {
  id: string;
  expiresAt: string;
}

/**
 * The backend's parsed reset inventory (`sdk/cliproxy/auth/reset_types.go`).
 * Codex sends `{credits?}`; Claude sends the flattened cedar_ember status.
 */
export interface CredentialResets {
  credits: CredentialResetCredit[];
  /** The whole object; for Claude this is the cedar_ember-shaped grant status. */
  body: Record<string, unknown>;
}

export interface CredentialUsageEntry {
  authIndex: string;
  authId: string;
  provider: string;
  /** Upstream bodies exactly as cached by the backend. Display only, never spendability. */
  raw: CredentialUsageRaw;
  /** Null when the backend could not establish reset availability. */
  resets: CredentialResets | null;
  fetchedAtMs: number | null;
  observedAtMs: number | null;
  nextFetchAtMs: number | null;
  cooldownUntilMs: number | null;
  refreshing: boolean;
  lastError: string;
}

export const CREDENTIAL_RESET_RESULTS = [
  'reset',
  'already_used',
  'not_limited',
  'cooldown',
  'ineligible',
  'unavailable',
  'rate_limited',
  'auth_error',
  'unknown',
] as const;
export type CredentialResetResult = (typeof CREDENTIAL_RESET_RESULTS)[number];

/**
 * Attempted results plus the backend's refusals:
 * - `refresh_pending`: a previous reset still waits for a fresh usage fetch (409);
 * - `in_flight`: another reset for this credential is running (409);
 * - `refused`: no usable reset was available, nothing was sent (400).
 */
export type CredentialResetCode =
  CredentialResetResult | 'refresh_pending' | 'in_flight' | 'refused';

export interface CredentialResetOutcome {
  code: CredentialResetCode;
  entry: CredentialUsageEntry | null;
  refreshPending: boolean;
  nextFetchAtMs: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Unset times are omitted by the backend; older builds sent Go's zero time
 * (0001-01-01T00:00:00Z). Both mean "never", not a date.
 */
export const parseUsageTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

const normalizeRaw = (value: unknown): CredentialUsageRaw => {
  if (!isRecord(value)) return {};
  const raw: CredentialUsageRaw = {};
  if (value.usage !== undefined && value.usage !== null) raw.usage = value.usage;
  if (value.profile !== undefined && value.profile !== null) raw.profile = value.profile;
  if (value.subscription !== undefined && value.subscription !== null) {
    raw.subscription = value.subscription;
  }
  if (value.reset_credits !== undefined && value.reset_credits !== null) {
    raw.resetCredits = value.reset_credits;
  }
  return raw;
};

const normalizeResets = (value: unknown): CredentialResets | null => {
  if (!isRecord(value)) return null;
  const credits = Array.isArray(value.credits)
    ? value.credits.filter(isRecord).map((credit) => ({
        id: text(credit.id),
        expiresAt: text(credit.expires_at),
      }))
    : [];
  return { credits, body: value };
};

export const normalizeCredentialUsageEntry = (value: unknown): CredentialUsageEntry | null => {
  if (!isRecord(value)) return null;
  const authIndex = text(value.auth_index);
  if (!authIndex) return null;
  return {
    authIndex,
    authId: text(value.auth_id),
    provider: text(value.provider).toLowerCase(),
    raw: normalizeRaw(value.raw),
    resets: normalizeResets(value.resets),
    fetchedAtMs: parseUsageTimestamp(value.fetched_at),
    observedAtMs: parseUsageTimestamp(value.observed_at),
    nextFetchAtMs: parseUsageTimestamp(value.next_fetch_at),
    cooldownUntilMs: parseUsageTimestamp(value.cooldown_until),
    refreshing: value.refreshing === true,
    lastError: text(value.last_error),
  };
};

export const normalizeCredentialUsageList = (value: unknown): CredentialUsageEntry[] =>
  Array.isArray(value)
    ? value
        .map(normalizeCredentialUsageEntry)
        .filter((entry): entry is CredentialUsageEntry => entry !== null)
    : [];

const normalizeResetResult = (value: unknown): CredentialResetResult => {
  const result = text(value);
  return (CREDENTIAL_RESET_RESULTS as readonly string[]).includes(result)
    ? (result as CredentialResetResult)
    : 'unknown';
};

export const normalizeCredentialResetResponse = (value: unknown): CredentialResetOutcome => {
  const body = isRecord(value) ? value : {};
  return {
    code: normalizeResetResult(body.result),
    entry: normalizeCredentialUsageEntry(body.entry),
    refreshPending: body.refresh_pending === true,
    nextFetchAtMs: parseUsageTimestamp(body.next_fetch_at),
  };
};

/**
 * Maps a failed reset request. Only the backend's documented refusals become
 * outcomes. A lost response or a gateway-style 5xx is `unknown` because the
 * reset may have been spent. 503 (manager unavailable, nothing sent), 401, 404
 * and other 4xx are rethrown.
 */
export const mapCredentialResetError = (error: unknown): CredentialResetOutcome => {
  const record = isRecord(error) ? error : {};
  const status = typeof record.status === 'number' ? record.status : undefined;
  const data = isRecord(record.data) ? record.data : {};
  const outcome = (code: CredentialResetCode): CredentialResetOutcome => ({
    code,
    entry: null,
    refreshPending: data.refresh_pending === true,
    nextFetchAtMs: parseUsageTimestamp(data.next_fetch_at),
  });
  if (status === undefined || (status >= 500 && status !== 503)) return outcome('unknown');
  if (status === 409)
    return outcome(data.refresh_pending === true ? 'refresh_pending' : 'in_flight');
  if (status === 400 && text(data.error) === 'no usable reset available') {
    return outcome('refused');
  }
  throw error;
};

export const credentialUsageApi = {
  /** Cached usage only; never reaches upstream. */
  async list(authIndex?: string): Promise<CredentialUsageEntry[]> {
    const data = await apiClient.get<unknown>(
      '/credentials/usage',
      authIndex ? { params: { auth_index: authIndex } } : undefined
    );
    return normalizeCredentialUsageList(data);
  },

  /** The backend serves cached data inside its fetch floor or a 429 cooldown. */
  async refresh(authIndex?: string): Promise<CredentialUsageEntry[]> {
    const data = await apiClient.post<unknown>(
      '/credentials/usage/refresh',
      authIndex ? { auth_index: authIndex } : {}
    );
    return normalizeCredentialUsageList(data);
  },

  /** An explicit spending action. Codex passes no grant; Claude passes the chosen grant. */
  async reset(authIndex: string, grantId?: string): Promise<CredentialResetOutcome> {
    try {
      const data = await apiClient.post<unknown>(
        '/credentials/usage/reset',
        grantId ? { auth_index: authIndex, grant_id: grantId } : { auth_index: authIndex },
        { timeout: RESET_REQUEST_TIMEOUT_MS }
      );
      return normalizeCredentialResetResponse(data);
    } catch (error: unknown) {
      return mapCredentialResetError(error);
    }
  },
};
