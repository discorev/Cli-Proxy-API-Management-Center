/**
 * One summary card per provider: how much headroom is left across every
 * credential of that provider, and when the next of them comes back.
 *
 * The headline is a *sum*, not an average — `436% of 500%` says both "you have
 * four and a bit credentials' worth of capacity" and "you hold five
 * credentials", which is the question the strip exists to answer. An average
 * reads more naturally and hides the second half.
 *
 * The window chosen is the provider's longest (7-day / weekly / monthly): the
 * short rolling windows recover on their own within the hour and say nothing
 * about the week ahead. When several windows share that length — Claude's
 * per-model 7-day limits — the one present on the most credentials leads and
 * the rest become extra headlines behind a Show/Hide control.
 *
 * Pure and React-free.
 */

import type { TFunction } from 'i18next';
import type { QuotaProviderType } from './providers/types';
import { toQuotaRowModel, type QuotaRowWindow } from './rowModel';

export interface QuotaSummarySegment {
  /** Stable per-credential key, also the React key. */
  key: string;
  displayName: string;
  /** Null when this credential has not been loaded, or reported no value. */
  remainingPercent: number | null;
}

export interface QuotaSummaryHeadline {
  label: string;
  /** Sum of remaining percent over loaded credentials; null when none are. */
  totalRemaining: number | null;
  segments: QuotaSummarySegment[];
  /** Soonest upcoming reset of this window, across loaded credentials. */
  resetAtMs: number | null;
  resetLabel: string | null;
}

export interface QuotaProviderSummary {
  provider: QuotaProviderType;
  credentialCount: number;
  /** credentialCount × 100 — the denominator both headlines are read against. */
  denominator: number;
  loadedCount: number;
  headline: QuotaSummaryHeadline | null;
  /** Same-length windows that did not lead, e.g. Claude's per-model limits. */
  extraHeadlines: QuotaSummaryHeadline[];
  /** Soonest upcoming reset of the headline window, across loaded credentials. */
  resetAtMs: number | null;
  resetLabel: string | null;
}

export interface QuotaSummaryInput {
  key: string;
  displayName: string;
  quota: unknown;
}

/** Windows with no declared length cannot be compared; they never lead. */
const windowRank = (window: QuotaRowWindow): number => window.periodHours ?? -1;

/**
 * Soonest *upcoming* reset when a clock is supplied: a window that already
 * turned over would otherwise keep the footer showing a countdown that ran out.
 */
function pickReset(
  windows: readonly QuotaRowWindow[],
  nowMs?: number
): { resetAtMs: number; resetLabel: string | null } | undefined {
  const dated = windows
    .filter((window): window is QuotaRowWindow & { resetAtMs: number } => window.resetAtMs !== null)
    .sort((a, b) => a.resetAtMs - b.resetAtMs);
  return (
    (nowMs === undefined ? undefined : dated.find((window) => window.resetAtMs > nowMs)) ?? dated[0]
  );
}

interface Candidate {
  label: string;
  rank: number;
  order: number;
  byKey: Map<string, QuotaRowWindow>;
}

/**
 * Build the summary for one provider's credentials.
 *
 * `inputs` is every credential of the provider — including the unloaded ones,
 * which still occupy a grey segment and still count towards the denominator.
 */
export function buildProviderSummary(
  provider: QuotaProviderType,
  inputs: readonly QuotaSummaryInput[],
  t: TFunction,
  nowMs?: number
): QuotaProviderSummary {
  const candidates = new Map<string, Candidate>();
  let loadedCount = 0;

  inputs.forEach((input) => {
    const model = toQuotaRowModel(provider, input.quota, t);
    if (!model) return;
    loadedCount += 1;
    // Only this credential's longest window competes: a 5-hour limit must not
    // become the provider headline just because one credential lacks a weekly.
    const best = model.windows.reduce<number>(
      (max, window) => Math.max(max, windowRank(window)),
      -1
    );
    if (best < 0) return;
    model.windows
      .filter((window) => windowRank(window) === best)
      .forEach((window) => {
        const existing = candidates.get(window.label);
        if (existing) {
          existing.byKey.set(input.key, window);
          return;
        }
        candidates.set(window.label, {
          label: window.label,
          rank: best,
          order: candidates.size,
          byKey: new Map([[input.key, window]]),
        });
      });
  });

  const ranked = [...candidates.values()].sort(
    (a, b) => b.rank - a.rank || b.byKey.size - a.byKey.size || a.order - b.order
  );

  const toHeadline = (candidate: Candidate): QuotaSummaryHeadline => {
    let total: number | null = null;
    const segments = inputs.map((input) => {
      const percent = candidate.byKey.get(input.key)?.remainingPercent ?? null;
      if (percent !== null) total = (total ?? 0) + percent;
      return { key: input.key, displayName: input.displayName, remainingPercent: percent };
    });
    const reset = pickReset([...candidate.byKey.values()], nowMs);
    return {
      label: candidate.label,
      totalRemaining: total,
      segments,
      resetAtMs: reset?.resetAtMs ?? null,
      resetLabel: reset?.resetLabel ?? null,
    };
  };

  const leader = ranked[0] ?? null;
  const headline = leader ? toHeadline(leader) : null;

  // Only same-length siblings are offered as extra headlines. A shorter window
  // measured against the same denominator would read as a comparison it isn't.
  const extraHeadlines = leader
    ? ranked
        .filter((candidate) => candidate !== leader && candidate.rank === leader.rank)
        .map(toHeadline)
    : [];

  return {
    provider,
    credentialCount: inputs.length,
    denominator: inputs.length * 100,
    loadedCount,
    headline,
    extraHeadlines,
    resetAtMs: headline?.resetAtMs ?? null,
    resetLabel: headline?.resetLabel ?? null,
  };
}
