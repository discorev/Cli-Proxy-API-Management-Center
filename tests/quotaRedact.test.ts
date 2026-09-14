import { describe, expect, test } from 'bun:test';
import { identityTransform, redactIdentity } from '@/utils/quota/redact';

describe('redactIdentity', () => {
  test('keeps the dashed prefix and the extension, masks the account word', () => {
    expect(redactIdentity('claude-theo@lambda.dev.json')).toBe('claude-t•••@l•••.dev.json');
    expect(redactIdentity('codex-4630970a-abc@one.dev-pro.json')).toBe(
      'codex-4630970a-a•••@o•••.dev-pro.json'
    );
    expect(redactIdentity('kimi-account.json')).toBe('kimi-a•••.json');
  });

  test('redacts both halves of a Devin display name', () => {
    expect(redactIdentity('devin-main.json · theo@lambda.dev')).toBe(
      'devin-m•••.json · t•••@l•••.dev'
    );
  });

  test('leaves nothing recognizable beyond the kept prefix', () => {
    expect(redactIdentity('claude-theo@lambda.dev.json')).not.toContain('theo');
    expect(redactIdentity('claude-theo@lambda.dev.json')).not.toContain('lambda');
  });

  test('never lengthens a name that has nothing left to hide', () => {
    // Prefix already covers the whole word — masking would add characters that
    // suggest hidden content where there is none.
    expect(redactIdentity('a.json')).toBe('a.json');
    expect(redactIdentity('kimi-a.json')).toBe('kimi-a.json');
    expect(redactIdentity('')).toBe('');
  });

  test('identityTransform is the identity function when redaction is off', () => {
    expect(identityTransform(false)('claude-theo@lambda.dev.json')).toBe(
      'claude-theo@lambda.dev.json'
    );
    expect(identityTransform(true)('claude-theo@lambda.dev.json')).toBe(
      'claude-t•••@l•••.dev.json'
    );
  });
});
