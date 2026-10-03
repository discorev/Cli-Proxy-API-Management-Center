/**
 * Notification copy for a backend reset outcome. Pure (`t` is injected) and
 * shared by the Codex reset button, the Claude grant claim and the Auth Files card.
 */

import type { TFunction } from 'i18next';
import type { NotificationType } from '@/types';
import type { CredentialResetCode } from '@/services/api/credentialUsage';
import { formatUsageNoteTime } from './usageNote';

const SUCCESS_CODES = new Set<CredentialResetCode>(['reset', 'already_used']);
const INFO_CODES = new Set<CredentialResetCode>(['refresh_pending', 'in_flight']);

export const resetOutcomeType = (code: CredentialResetCode): NotificationType =>
  SUCCESS_CODES.has(code) ? 'success' : INFO_CODES.has(code) ? 'info' : 'error';

/**
 * `refresh_pending` was not sent; it names when to try again (the backend's
 * next_fetch_at), falling back to "later" when the time is unknown.
 */
export const resetOutcomeText = (
  t: TFunction,
  code: CredentialResetCode,
  nextFetchAtMs: number | null = null,
  locale?: string
): string => {
  if (code !== 'refresh_pending') return t(`credential_usage.reset_outcome.${code}`);
  return nextFetchAtMs === null
    ? t('credential_usage.reset_outcome.refresh_pending_later')
    : t('credential_usage.reset_outcome.refresh_pending', {
        time: formatUsageNoteTime(nextFetchAtMs, locale),
      });
};

/** Codex keeps its named success/failure messages; other outcomes stand on their own. */
export function describeCodexResetOutcome(
  t: TFunction,
  code: CredentialResetCode,
  name: string,
  nextFetchAtMs: number | null = null,
  locale?: string
): { message: string; type: NotificationType } {
  const type = resetOutcomeType(code);
  if (code === 'reset') return { message: t('codex_quota.reset_success', { name }), type };
  if (type !== 'error') return { message: resetOutcomeText(t, code, nextFetchAtMs, locale), type };
  return {
    message: t('codex_quota.reset_failed', { name, message: resetOutcomeText(t, code) }),
    type,
  };
}
