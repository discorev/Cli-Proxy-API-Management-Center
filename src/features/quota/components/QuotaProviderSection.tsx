/**
 * A provider's rows under one heading.
 *
 * The grid used provider order as an invisible arrangement rule; with rows the
 * grouping is stated instead, so the eye can jump to "Codex" without counting
 * icons. Rows are passed as children because the page owns the per-credential
 * actions and the quota lookup.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { QuotaProviderType } from '../providers/types';
import styles from './QuotaProviderSection.module.scss';

export type QuotaProviderSectionProps = {
  provider: QuotaProviderType;
  count: number;
  resolvedTheme: ResolvedTheme;
  children: ReactNode;
};

export function QuotaProviderSection(props: QuotaProviderSectionProps) {
  const { provider, count, resolvedTheme, children } = props;
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(provider, resolvedTheme);
  const typeLabel = getTypeLabel(t, provider);

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <span
          className={styles.iconWrap}
          style={
            isThemeSurfaceIconProvider(provider)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" className={styles.icon} />
          ) : (
            <span className={styles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <h2 className={styles.title}>{typeLabel}</h2>
        <span className={styles.count}>{count}</span>
      </header>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}
