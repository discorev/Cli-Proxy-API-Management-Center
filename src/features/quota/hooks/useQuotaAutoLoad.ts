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

/** Loads each visible auto-load credential once per visit. No polling. */
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
    const targets = entries.filter(({ type, file }) => {
      if (!AUTO_LOAD_QUOTA_TYPES.has(type)) return false;
      const key = JSON.stringify([
        session,
        type,
        fileGenerations[file.name] ?? 0,
        file.name,
        file.authIndex,
      ]);
      if (attempted.current.has(key)) return false;
      attempted.current.add(key);
      // An explicit refresh already started in this effect cycle counts too.
      return getQuotaMap(QUOTA_ADAPTERS[type])[getQuotaCacheKey(file)]?.status !== 'loading';
    });
    if (targets.length > 0) void loadQuota(targets);
  }, [disabled, entries, fileGenerations, loadQuota, session]);
}
