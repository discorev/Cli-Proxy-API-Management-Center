/**
 * Screen-share redaction for credential identities.
 *
 * The quota page shows filenames and Devin account emails in full. That is the
 * right default at a desk and the wrong one on a call, so the header toggle
 * routes every identity string on the page through this one helper.
 *
 * The rule keeps the parts that identify a *kind* of credential — the provider
 * prefix, hex id segments, the file extension and the TLD — and masks the
 * words that name the person, account or organisation, dots included. Enough survives to tell
 * two rows apart; not enough to read an address off a stream.
 *
 *   claude-theo@lambda.dev.json                 → claude-t•••@l•••.dev.json
 *   codex-4630970a-abc@one.dev-pro.json         → codex-4630970a-a•••@o•••.dev-pro.json
 *   claude-f95094e6-ollie.hayman@advt-group.com.json → claude-f95094e6-o•••@a•••.com.json
 *   kimi-account.json                           → kimi-a•••.json
 *
 * Pure and React-free.
 */

const MASK = '•••';

/** Devin display names are `file · identity`; both halves are redacted. */
const DISPLAY_SEPARATOR = ' · ';

/** Auth-file extension, kept verbatim so a redacted name still reads as a file. */
const FILE_EXTENSION = /\.json$/i;

/** Opaque id segments (`4630970a`, `f95094e6`) identify a credential, not a person. */
const HEX_ID = /^[0-9a-f]{6,}$/i;

/** First character plus the mask; one-character words have nothing left to hide. */
const maskWord = (word: string): string => (word.length <= 1 ? word : `${word[0]}${MASK}`);

/**
 * The account half: keep the provider prefix and any hex ids that follow it,
 * mask everything after that as one word — `ollie.hayman` is a person, so the
 * dot inside it is masked too.
 */
function redactLocal(local: string): string {
  const [head, ...rest] = local.split('-');
  if (rest.length === 0) return maskWord(head);
  const kept = [head];
  let index = 0;
  while (index < rest.length && HEX_ID.test(rest[index])) {
    kept.push(rest[index]);
    index += 1;
  }
  const remainder = rest.slice(index).join('-');
  if (remainder) kept.push(maskWord(remainder));
  return kept.join('-');
}

/** The domain half: keep only the TLD, mask every other label. */
function redactDomain(domain: string): string {
  const labels = domain.split('.');
  return labels.map((label, i) => (i === labels.length - 1 ? label : maskWord(label))).join('.');
}

function redactSegment(segment: string): string {
  const extension = FILE_EXTENSION.exec(segment)?.[0] ?? '';
  const base = extension ? segment.slice(0, -extension.length) : segment;
  const at = base.indexOf('@');
  const redacted =
    at === -1
      ? redactLocal(base)
      : `${redactLocal(base.slice(0, at))}@${redactDomain(base.slice(at + 1))}`;
  return `${redacted}${extension}`;
}

/**
 * Redact a credential identity — a filename, an email, or the `file · identity`
 * display name Devin credentials use.
 */
export function redactIdentity(name: string): string {
  if (!name) return name;
  return name.split(DISPLAY_SEPARATOR).map(redactSegment).join(DISPLAY_SEPARATOR);
}

/** The identity transform for a given redaction preference. */
export const identityTransform = (redact: boolean): ((name: string) => string) =>
  redact ? redactIdentity : (name: string) => name;
