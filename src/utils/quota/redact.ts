/**
 * Screen-share redaction for credential identities.
 *
 * The quota page shows filenames and Devin account emails in full. That is the
 * right default at a desk and the wrong one on a call, so the header toggle
 * routes every identity string on the page through this one helper.
 *
 * The rule keeps the parts that identify a *kind* of credential — the provider
 * prefix, the dashed id segment, the file extension and the domain tail — and
 * masks only the word that names the person or account. Enough survives to tell
 * two rows apart; not enough to read an address off a stream.
 *
 *   claude-theo@lambda.dev.json          → claude-t•••@l•••.dev.json
 *   codex-4630970a-abc@one.dev-pro.json  → codex-4630970a-a•••@o•••.dev-pro.json
 *   kimi-account.json                    → kimi-a•••.json
 *
 * Pure and React-free.
 */

const MASK = '•••';

/** Devin display names are `file · identity`; both halves are redacted. */
const DISPLAY_SEPARATOR = ' · ';

/**
 * Mask one dotless word, keeping its structural prefix.
 *
 * The prefix is everything up to and including the first character after the
 * last dash — `codex-4630970a-abc` keeps `codex-4630970a-a`. A word with no
 * dash keeps only its first character. Words already at or below that length
 * carry no secret worth hiding and are returned untouched, so the mask never
 * makes a name *longer* than the original.
 */
function maskWord(word: string): string {
  if (word.length === 0) return word;
  const lastDash = word.lastIndexOf('-');
  const keep = lastDash === -1 ? 1 : lastDash + 2;
  if (word.length <= keep) return word;
  return `${word.slice(0, keep)}${MASK}`;
}

/** Mask the leading word of one `@`-part, preserving its dotted tail. */
function redactPart(part: string): string {
  const dot = part.indexOf('.');
  if (dot === -1) return maskWord(part);
  return `${maskWord(part.slice(0, dot))}${part.slice(dot)}`;
}

/**
 * Redact a credential identity — a filename, an email, or the `file · identity`
 * display name Devin credentials use.
 */
export function redactIdentity(name: string): string {
  if (!name) return name;
  return name
    .split(DISPLAY_SEPARATOR)
    .map((segment) => segment.split('@').map(redactPart).join('@'))
    .join(DISPLAY_SEPARATOR);
}

/** The identity transform for a given redaction preference. */
export const identityTransform = (redact: boolean): ((name: string) => string) =>
  redact ? redactIdentity : (name: string) => name;
