import type { RoutingStrategy } from '@/types/visualConfig';

/** The proxy fork's routing strategy when routing.strategy is unset or unrecognized. */
export const DEFAULT_ROUTING_STRATEGY: RoutingStrategy = 'intelligent-fill';

/**
 * Normalizes routing.strategy the way the proxy fork does
 * (sdk/cliproxy/service_config.go normalizedRoutingRuntimeState): known aliases map to their
 * strategy, and anything else, including an unset value, is the intelligent-fill default.
 * Round-robin therefore has to be written explicitly.
 */
export function parseRoutingStrategy(raw: unknown): RoutingStrategy {
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (['round-robin', 'roundrobin', 'rr'].includes(normalized)) return 'round-robin';
  if (['weighted-round-robin', 'weightedroundrobin', 'wrr'].includes(normalized)) {
    return 'weighted-round-robin';
  }
  if (['fill-first', 'fillfirst', 'ff'].includes(normalized)) return 'fill-first';
  return DEFAULT_ROUTING_STRATEGY;
}

/** True when the backend would fall back to the default because no known strategy is set. */
export function isDefaultedRoutingStrategy(raw: unknown): boolean {
  return (
    parseRoutingStrategy(raw) === DEFAULT_ROUTING_STRATEGY &&
    !['intelligent-fill', 'intelligentfill', 'if'].includes(
      String(raw ?? '')
        .trim()
        .toLowerCase()
    )
  );
}
