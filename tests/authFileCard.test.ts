import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import { redactIdentity } from '@/utils/quota/redact';

// The quota host binds CSS-module classes at import time, which Bun cannot render.
// Keep these source contracts small; browser checks cover the actual card interactions.
const source = readFileSync(
  new URL('../src/features/authFiles/components/AuthFileCard.tsx', import.meta.url),
  'utf8'
);
const css = readFileSync(
  new URL('../src/features/authFiles/components/AuthFileCard.module.scss', import.meta.url),
  'utf8'
);

describe('auth file card presentation contract', () => {
  test('uses identity rather than logos or duplicate status badges', () => {
    expect(source).not.toContain('<img');
    expect(source).not.toContain('getAuthFileIcon');
    expect(source).not.toContain('stateBadge');
    expect(source).toContain('<h3');
    expect(source).toContain('{displayPrimary}');
    expect(source).toContain('{displaySecondary}');
  });

  test('shows transformed primary and secondary identities, including their titles', () => {
    const identity = deriveAuthFileIdentity({
      name: 'claude-ollie.hayman@advt-group.com.json',
      email: 'ollie.hayman@advt-group.com',
    });

    expect(redactIdentity(identity.primary)).toBe('o•••@a•••.com');
    expect(redactIdentity(identity.secondary ?? '')).toBe('claude-o•••@a•••.com');
    expect(source).toContain('const displayPrimary = displayNameFor(identity.primary)');
    expect(source).toContain('displayNameFor(identity.secondary)');
    expect(source).toContain('const displayFullName = displayNameFor(identity.fullName)');
    expect(source).toContain('title={displayPrimary}');
    expect(source).toContain('title={displayFullName}');
    expect(source).toContain('{displayPrimary}');
    expect(source).toContain('{displaySecondary}');
  });

  test('prefixes the account with a theme-aware legacy provider pill', () => {
    const heading = source.split('<h3')[1].split('</h3>')[0];
    expect(heading.indexOf('{typeLabel}')).toBeLessThan(heading.indexOf('{displayPrimary}'));
    expect(heading).toContain('styles.providerBadge');
    expect(heading).toContain('backgroundColor: typeColor.bg');
    expect(heading).toContain('color: typeColor.text');
    expect(source).toContain('getTypeColor(providerKey, resolvedTheme)');
    const badge = css.split('.providerBadge {')[1].split('}')[0];
    expect(badge).toContain('border-radius: 12px');
    expect(badge).toContain('padding: 4px 10px');
    expect(badge).toContain('font-size: 12px');
    expect(badge).not.toContain('text-transform: uppercase');
    const account = css.split('.account {')[1].split('}')[0];
    expect(account).toContain('overflow-wrap: anywhere');
    expect(account).not.toContain('text-ellipsis');
  });

  test('centers the provider pill and account without baseline offsets', () => {
    const identity = css.split('.identity {')[1].split('}')[0];
    expect(identity).toContain('display: flex');
    expect(identity).toContain('align-items: center');
    expect(identity).toContain('flex-wrap: wrap');
    expect(identity).toContain('gap: 4px 8px');
    const badge = css.split('.providerBadge {')[1].split('}')[0];
    expect(badge).not.toContain('vertical-align: baseline');
    expect(badge).not.toContain('margin-inline-end');
    const header = css.split('.head {')[1].split('}')[0];
    expect(header).toContain('align-items: center');
  });

  test('uses one footer toggle and credential-specific accessible names', () => {
    const header = source.split('<header')[1].split('</header>')[0];
    const footer = source.split('<footer')[1].split('</footer>')[0];
    expect(source.match(/<ToggleSwitch/g)).toHaveLength(1);
    expect(header).not.toContain('<ToggleSwitch');
    expect(header).toContain("ariaLabel={t('auth_files.card_select', { name: file.name })}");
    expect(header).not.toContain('aria-label=');
    expect(footer).toContain('<ToggleSwitch');
    expect(footer).toContain("t('auth_files.card_toggle', { name: file.name })");
    expect(footer).toContain('checked={!file.disabled}');
    expect(footer).toContain('statusUpdating[file.name] === true || isManualRefreshing');
    expect(footer).toContain('!isRuntimeOnly &&');
  });

  test('keeps disabled contents readable without card lift or logo styling', () => {
    expect(source).not.toContain('cardDisabled');
    expect(css).not.toContain('.cardDisabled');
    expect(css).not.toContain('.avatar');
    expect(css).not.toContain('translateY');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  test('retains individual management actions and warning detail', () => {
    for (const handler of [
      'onShowModels(file)',
      'onDownload(file.name)',
      'onManualRefresh(file)',
      'onOpenPrefixProxyEditor(file)',
      'onDelete(file.name)',
    ]) {
      expect(source).toContain(handler);
    }
    expect(source).toContain('rawStatusMessage && hasStatusWarning');
    expect(source).toContain('showManualRefreshButton');
    expect(source).toContain('file.disabled ||');
  });
});
