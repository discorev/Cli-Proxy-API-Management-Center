import {
  anthropicResetGrantBlocker,
  type AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';

/** Prefer the upstream recommendation; otherwise use stable ID ordering. */
export function selectResetGrant(status: AnthropicResetGrantStatus, now: number) {
  if (status.cooldownUntil && Date.parse(status.cooldownUntil) > now) return undefined;
  const usable = status.grants.filter(
    (grant) =>
      !anthropicResetGrantBlocker(status, grant.id) &&
      (!grant.startsAt || Date.parse(grant.startsAt) <= now) &&
      (!grant.endsAt || Date.parse(grant.endsAt) > now)
  );
  return (
    usable.find((grant) => grant.id === status.nextGrantId) ??
    usable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
  );
}

/** Soonest future `endsAt` (epoch ms) among grants that still have resets left. */
export function soonestGrantExpiryMs(
  status: AnthropicResetGrantStatus,
  now: number
): number | null {
  let soonest: number | null = null;
  for (const grant of status.grants) {
    if (grant.resetsLeft <= 0 || !grant.endsAt) continue;
    const ms = Date.parse(grant.endsAt);
    if (!Number.isFinite(ms) || ms <= now) continue;
    if (soonest === null || ms < soonest) soonest = ms;
  }
  return soonest;
}
