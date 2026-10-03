import { useEffect, useRef } from 'react';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, getQuotaMap } from '../providers';
import type { QuotaProviderType } from '../providers/types';

/**
 * Providers whose page-load read is loaded automatically. Devin runs its active
 * management query; Claude and Codex read the backend usage cache, which never
 * reaches upstream. Other providers keep click-to-load.
 */
export const AUTO_LOAD_QUOTA_TYPES: ReadonlySet<QuotaProviderType> = new Set([
  'devin',
  'claude',
  'codex',
]);

export interface AutoLoadContext {
  session: number;
  fileGenerations: Record<string, number>;
  /** Current card status, so an explicit refresh already in flight is not duplicated. */
  statusOf: (entry: QuotaFileEntry) => string | undefined;
}

/**
 * Picks the credentials not yet read during this visit and records them in
 * `attempted`. Each visit owns a fresh `attempted` set, so every visit reads again.
 */
export const selectAutoLoadTargets = (
  entries: QuotaFileEntry[],
  attempted: Set<string>,
  { session, fileGenerations, statusOf }: AutoLoadContext
): QuotaFileEntry[] =>
  entries.filter((entry) => {
    const { type, file } = entry;
    if (!AUTO_LOAD_QUOTA_TYPES.has(type)) return false;
    const key = JSON.stringify([
      session,
      type,
      fileGenerations[file.name] ?? 0,
      file.name,
      file.authIndex,
    ]);
    if (attempted.has(key)) return false;
    attempted.add(key);
    // An explicit refresh already started in this effect cycle counts too.
    return statusOf(entry) !== 'loading';
  });

/**
 * Loads each visible auto-load credential once per page visit. Navigating to the
 * Quota page mounts it afresh (PageTransition keys layers by location and unmounts
 * the exiting one), so every visit re-reads the usage cache. No polling.
 */
export function useQuotaAutoLoad(
  entries: QuotaFileEntry[],
  disabled: boolean,
  loadQuota: (targets: QuotaFileEntry[]) => Promise<void>
) {
  const attempted = useRef(new Set<string>());
  const session = useQuotaStore((state) => state.cacheGeneration);
  const fileGenerations = useQuotaStore((state) => state.fileGenerations);

  useEffect(() => {
    if (disabled) return;
    const targets = selectAutoLoadTargets(entries, attempted.current, {
      session,
      fileGenerations,
      statusOf: ({ type, file }) =>
        getQuotaMap(QUOTA_ADAPTERS[type])[getQuotaCacheKey(file)]?.status,
    });
    if (targets.length > 0) void loadQuota(targets);
  }, [disabled, entries, fileGenerations, loadQuota, session]);
}
