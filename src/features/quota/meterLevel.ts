/**
 * The quota meter's three-band colour rule.
 *
 * Lives outside `QuotaMeter.tsx` because three views now draw a meter — the
 * provider bodies through the class contract, the rows, and the summary strip's
 * per-credential segments — and a threshold that disagrees between them would
 * colour the same number two ways on one screen.
 */

export const QUOTA_PROGRESS_HIGH_THRESHOLD = 70;
export const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 30;

export type QuotaMeterLevel = 'high' | 'medium' | 'low';

/** Unknown reads as `medium`, which renders at zero width — no colour. */
export function quotaMeterLevel(percent: number | null): QuotaMeterLevel {
  if (percent === null) return 'medium';
  if (percent >= QUOTA_PROGRESS_HIGH_THRESHOLD) return 'high';
  if (percent >= QUOTA_PROGRESS_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}
