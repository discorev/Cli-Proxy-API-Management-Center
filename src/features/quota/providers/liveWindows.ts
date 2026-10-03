/**
 * Live usage windows: the backend parses rate-limit headers from every proxied
 * request into the entry's `windows`, so they can be newer than the raw usage
 * body. Only the matching usage rows take the live percent and reset; plan,
 * credits, grants and other windows still come from the raw bodies.
 */

import type { CredentialUsageEntry, CredentialUsageWindow } from '@/services/api/credentialUsage';
import { formatInstantShort } from '@/utils/quota';

const FIVE_HOUR_SECONDS = 18000;
const WEEK_SECONDS = 604800;

/** A displayed usage row (Claude or Codex) that a live window can update. */
interface UsageRow {
  id: string;
  usedPercent: number | null;
  resetLabel: string;
  resetAtMs?: number | null;
}

/** Claude windows map by slot: 5h, 7d, and the Fable-scoped 7d (`7d_oi` header). */
export const claudeLiveRowId = (window: CredentialUsageWindow): string | null => {
  if (window.kind === '5h' && !window.scope) return 'five-hour';
  if (window.kind === '7d' && !window.scope) return 'seven-day';
  if (window.kind === '7d' && window.scope === 'fable') return 'seven-day-fable';
  return null;
};

/** Codex windows map by length onto the primary rate-limit rows. */
export const codexLiveRowId = (window: CredentialUsageWindow): string | null => {
  if (window.scope) return null;
  if (window.lengthSeconds === FIVE_HOUR_SECONDS) return 'five-hour';
  if (window.lengthSeconds === WEEK_SECONDS) return 'weekly';
  return null;
};

/**
 * Overlays live windows when headers were observed after the last fetch. A
 * window absent from `windows` (Fable traffic alone refreshes the Fable one)
 * leaves its row as fetched.
 */
export const overlayLiveWindows = <T extends UsageRow>(
  rows: T[],
  entry: CredentialUsageEntry,
  rowIdFor: (window: CredentialUsageWindow) => string | null
): T[] => {
  const { observedAtMs, fetchedAtMs } = entry;
  if (observedAtMs === null || (fetchedAtMs !== null && observedAtMs <= fetchedAtMs)) return rows;
  const live = new Map<string, CredentialUsageWindow>();
  for (const window of entry.windows) {
    const id = rowIdFor(window);
    if (id) live.set(id, window);
  }
  if (live.size === 0) return rows;
  return rows.map((row) => {
    const window = live.get(row.id);
    if (!window) return row;
    const { usedPercent } = window;
    if (window.resetsAtMs === null) return { ...row, usedPercent };
    return {
      ...row,
      usedPercent,
      resetAtMs: window.resetsAtMs,
      resetLabel: formatInstantShort(window.resetsAtMs),
    };
  });
};
