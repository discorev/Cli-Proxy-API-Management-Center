import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore, useQuotaStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import { normalizeAuthIndex } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { resetOutcomeText, resetOutcomeType } from '../../resetOutcome';
import { captureResetSession, isResetSessionCurrent, settleResetOutcome } from '../../resetSession';
import { CLAUDE_CONFIG, resetClaudeGrant } from './data';
import { selectResetGrant, soonestGrantExpiryMs } from './selectResetGrant';

/**
 * Grant status comes from the backend's reset inventory already in the card state
 * (absent inventory blocks the claim). The
 * backend owns spending: it refreshes eligibility, claims the grant, guards
 * against repeat claims, and returns the refreshed entry for this card.
 */
export function useClaudeResetGrants(
  file: AuthFileItem,
  quota: ClaudeQuotaState | undefined,
  disabled: boolean
) {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [session] = useState(() => apiClient.getConnectionRevision());
  const sessionActive =
    connectionStatus === 'connected' && session === apiClient.getConnectionRevision();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const now = useNow();
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const status = quota?.status === 'success' ? (quota.resetGrants ?? null) : null;
  const selected = status ? selectResetGrant(status, now)?.id : undefined;
  const blocked = disabled || !sessionActive || !authIndex || busy || !selected;

  const confirm = () => {
    if (blocked || lock.current || !selected) return;
    const current = () => session === apiClient.getConnectionRevision();
    showConfirmation({
      title: t('claude_reset.title'),
      message: t('claude_reset.confirm_text', { name: file.name }),
      confirmText: t('claude_reset.confirm'),
      variant: 'primary',
      onConfirm: async () => {
        if (!current() || lock.current || useAuthStore.getState().connectionStatus !== 'connected')
          return;
        lock.current = true;
        setBusy(true);
        const resetSession = captureResetSession(file.name);
        try {
          const { code, data, nextFetchAtMs } = await resetClaudeGrant(file, selected, t, quota);
          settleResetOutcome(
            resetSession,
            () => {
              if (data === null) return;
              const cacheKey = getQuotaCacheKey(file);
              useQuotaStore.getState().setClaudeQuota((prev) => ({
                ...prev,
                [cacheKey]: CLAUDE_CONFIG.buildSuccessState(data),
              }));
            },
            () =>
              showNotification(
                resetOutcomeText(t, code, nextFetchAtMs, i18n.resolvedLanguage),
                resetOutcomeType(code)
              )
          );
        } catch (err: unknown) {
          if (!isResetSessionCurrent(resetSession)) return;
          showNotification(err instanceof Error ? err.message : t('common.unknown_error'), 'error');
        } finally {
          lock.current = false;
          setBusy(false);
        }
      },
    });
  };

  return {
    count: status?.grants.reduce((sum, grant) => sum + grant.resetsLeft, 0) ?? null,
    expiresAtMs: status ? soonestGrantExpiryMs(status, now) : null,
    busy,
    blocked,
    confirm,
  };
}
