/**
 * Guards for a reset's asynchronous result. The outcome toast reports money that
 * may have been spent, so it shows while the same session and connection are
 * current; only the card update also needs the file's cache generation.
 */

import { apiClient } from '@/services/api/client';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores/useQuotaStore';

export interface ResetSession {
  generation: ReturnType<typeof captureQuotaCacheGeneration>;
  connectionRevision: number;
}

export const captureResetSession = (fileName: string): ResetSession => ({
  generation: captureQuotaCacheGeneration(fileName),
  connectionRevision: apiClient.getConnectionRevision(),
});

export const isResetSessionCurrent = (session: ResetSession): boolean =>
  session.connectionRevision === apiClient.getConnectionRevision() &&
  session.generation.cacheGeneration === useQuotaStore.getState().cacheGeneration;

/** Applies the card update when the file is unchanged and notifies while the session is current. */
export function settleResetOutcome(
  session: ResetSession,
  updateCard: () => void,
  notify: () => void
): void {
  commitIfQuotaCacheCurrent(session.generation, updateCard);
  if (isResetSessionCurrent(session)) notify();
}
