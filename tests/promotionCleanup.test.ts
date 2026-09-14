import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { buildProviderGroups } from '../src/features/providers/useProviderWorkbench';

const root = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const collectProductFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectProductFiles(path);
    return ['.ts', '.tsx', '.scss', '.json'].includes(extname(entry.name)) ? [path] : [];
  });

const productFiles = [
  ...collectProductFiles(join(root, 'src')),
  join(root, 'README.md'),
  join(root, 'README_CN.md'),
];

describe('promotion cleanup', () => {
  test('removes Quick Start while keeping first-class provider management', () => {
    const routes = read('src/router/MainRoutes.tsx');
    const layout = read('src/components/layout/MainLayout.tsx');
    const workbench = read('src/features/providers/ProvidersWorkbenchPage.tsx');
    const resourcePanel = read('src/features/providers/components/ProviderResourcePanel.tsx');

    expect(routes).not.toContain('/quick-start');
    expect(layout).not.toContain('quickStart');
    expect(workbench).not.toContain('fixedBrand');
    expect(workbench).not.toContain('SponsorQuickStartPanel');
    expect(resourcePanel).toContain('onClick={onCreate}');
    expect(
      existsSync(join(root, 'src/features/providers/components/SponsorQuickStartPanel.tsx'))
    ).toBe(false);

    const ids = buildProviderGroups({}).map((group) => group.id);
    expect(ids).toContain('kimi');
    expect(ids).toContain('openrouter');
    for (const brand of ['apikeyFun', 'fennoAI', 'qiniuCloud']) {
      expect(ids).not.toContain(brand);
    }

    const categoryList = read('src/features/providers/components/ProviderCategoryList.tsx');
    expect(categoryList).not.toContain('QUICK_FILL');
    expect(categoryList).not.toContain('categories.quickFill');
  });

  test('uses shared category and badge styles for Kimi', () => {
    const categoryList = read('src/features/providers/components/ProviderCategoryList.tsx');
    const categoryStyles = read(
      'src/features/providers/components/ProviderCategoryList.module.scss'
    );

    expect(categoryList).not.toContain("group.id === 'kimi'");
    expect(categoryList).toContain("active ? styles.active : ''");
    expect(categoryList).toContain("total === 0 ? styles.badgeAmber : ''");
    expect(categoryStyles).not.toContain('.itemKimi');
    expect(categoryStyles).not.toContain('.badgeKimi');
  });

  test('contains no known sponsor or affiliate promotion in production files or docs', () => {
    const promotionPatterns = [
      /\/quick-start/i,
      /apikey\.fan\/(?:register|dashboard)/i,
      /platform\.kimi\.(?:com|ai)\/\?aff=/i,
      /api\.fenno\.ai\/register\?aff=/i,
      /s\.qiniu\.com\/miI73q/i,
      /bestproxy\.com/i,
      /go\.apimart\.ai/i,
    ];
    const hits = productFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return promotionPatterns
        .filter((pattern) => pattern.test(source))
        .map((pattern) => ({ file, pattern: pattern.source }));
    });

    expect(hits).toEqual([]);
    for (const path of [
      'assets/apimart-en.png',
      'assets/apimart-zh.png',
      'src/assets/icons/bestproxy.png',
      'src/assets/icons/apikey-fun.png',
      'src/assets/icons/fenno-ai.png',
      'src/assets/icons/qiniu-cloud.png',
      'src/features/providers/sponsor.ts',
      'src/features/providers/fennoAI.ts',
      'src/features/providers/qiniuCloud.ts',
      'src/features/providers/sheets/forms/useSponsorUsageCheck.ts',
    ]) {
      expect(existsSync(join(root, path))).toBe(false);
    }
  });

  test('uses fork links without changing docs or plugin trust links', () => {
    const mainRepo = 'https://github.com/discorev/CLIProxyAPI';
    const panelRepo = 'https://github.com/discorev/Cli-Proxy-API-Management-Center';
    const systemPage = read('src/pages/SystemPage.tsx');
    const connectivity = read('src/features/config/components/sections/SectionConnectivity.tsx');

    for (const readme of [read('README.md'), read('README_CN.md')]) {
      expect(readme).toContain(mainRepo);
      expect(readme).toContain(panelRepo);
    }
    expect(systemPage).toContain(mainRepo);
    expect(systemPage).toContain(panelRepo);
    expect(systemPage).toContain('https://help.router-for.me/');
    expect(connectivity).toContain(`placeholder="${panelRepo}"`);
    expect(read('src/features/plugins/pluginResources.ts')).toContain(
      "OFFICIAL_PLUGIN_REPO_PREFIX = 'https://github.com/router-for-me/'"
    );
  });

  test('removes promo translations from every locale while retaining provider and OAuth labels', async () => {
    for (const localeName of ['en', 'zh-CN', 'zh-TW', 'ru']) {
      const locale = (await Bun.file(join(root, `src/i18n/locales/${localeName}.json`)).json()) as {
        nav: Record<string, string>;
        nav_meta: Record<string, string>;
        auth_login: Record<string, string>;
        providersPage: {
          categories: Record<string, string>;
          providerNames: Record<string, string>;
          sponsor: Record<string, unknown>;
        };
        config_management: {
          visual: { sections: { network: Record<string, string> } };
        };
      };

      expect('quick_start' in locale.nav).toBe(false);
      expect('quick_start' in locale.nav_meta).toBe(false);
      expect('kimi_sign_up_button' in locale.auth_login).toBe(false);
      expect(locale.auth_login.kimi_oauth_button?.trim()).toBeTruthy();
      expect('proxy_url_sponsor_hint' in locale.config_management.visual.sections.network).toBe(
        false
      );
      for (const key of [
        'registerLink',
        'registerNow',
        'kimiPromo',
        'dashboardLink',
        'emptyRegisterHint',
      ]) {
        expect(key in locale.providersPage.sponsor).toBe(false);
      }
      expect('quickFill' in locale.providersPage.categories).toBe(false);
      expect(locale.providersPage.providerNames.openrouter?.trim()).toBeTruthy();
      expect(locale.providersPage.providerNames.kimi?.trim()).toBeTruthy();
      for (const brand of ['apikeyFun', 'fennoAI', 'qiniuCloud']) {
        expect(brand in locale.providersPage.providerNames).toBe(false);
      }
    }
  });
});
