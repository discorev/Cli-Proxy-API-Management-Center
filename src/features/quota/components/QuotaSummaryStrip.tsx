/**
 * One card per provider, across the top of the page.
 *
 * The rows below answer "which credential"; this answers "have I got room at
 * all". The headline sums remaining capacity over a provider's credentials and
 * shows it against the count — `436% of 500%` reads as four-and-a-bit
 * credentials' worth of headroom on five credentials, which an average would
 * flatten away. One bar segment per credential keeps the distribution visible:
 * five even segments and one exhausted credential are the same average.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildResetDisplay, type ResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { QuotaProviderSummary, QuotaSummaryHeadline } from '../providerSummary';
import { quotaMeterLevel, type QuotaMeterLevel } from '../meterLevel';
import styles from './QuotaSummaryStrip.module.scss';

export type QuotaSummaryStripProps = {
  summaries: QuotaProviderSummary[];
  resolvedTheme: ResolvedTheme;
};

const segmentClass: Record<QuotaMeterLevel, string> = {
  high: styles.segmentHigh,
  medium: styles.segmentMedium,
  low: styles.segmentLow,
};

function SegmentBar({ headline }: { headline: QuotaSummaryHeadline }) {
  return (
    <div className={styles.segments}>
      {headline.segments.map((segment) => (
        <span
          key={segment.key}
          className={
            segment.remainingPercent === null
              ? `${styles.segment} ${styles.segmentIdle}`
              : `${styles.segment} ${segmentClass[quotaMeterLevel(segment.remainingPercent)]}`
          }
          // Redacted upstream when the header toggle is on.
          title={
            segment.remainingPercent === null
              ? segment.displayName
              : `${segment.displayName} · ${Math.round(segment.remainingPercent)}%`
          }
        />
      ))}
    </div>
  );
}

const formatTotal = (total: number | null): string =>
  total === null ? '--' : `${Math.round(total)}%`;

type HeadlineBlockProps = {
  headline: QuotaSummaryHeadline | null;
  denominator: number;
  credentialCount: number;
  /** False while no credential has loaded: the footer says so instead of a reset. */
  loaded: boolean;
  reset: ResetDisplay | null;
};

/** Big figure, segmented bar and reset footer — shared by the lead and extra headlines. */
function HeadlineBlock({
  headline,
  denominator,
  credentialCount,
  loaded,
  reset,
}: HeadlineBlockProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className={styles.figure}>
        <span className={styles.total}>{formatTotal(headline?.totalRemaining ?? null)}</span>
        <span className={styles.denominator}>
          {t('quota_management.summary_of', { total: denominator })}
        </span>
      </div>

      {headline ? (
        <SegmentBar headline={headline} />
      ) : (
        <div className={styles.segments}>
          {Array.from({ length: Math.max(1, credentialCount) }, (_, index) => (
            <span key={index} className={`${styles.segment} ${styles.segmentIdle}`} />
          ))}
        </div>
      )}

      <div className={styles.footer}>
        {!loaded || !reset ? (
          <span className={styles.footerMuted}>{t('quota_management.summary_not_loaded')}</span>
        ) : (
          <>
            {reset.relative && <span className={styles.footerRelative}>{reset.relative}</span>}
            <span className={styles.footerAbsolute}>{reset.absolute}</span>
          </>
        )}
      </div>
    </>
  );
}

export function QuotaSummaryStrip({ summaries, resolvedTheme }: QuotaSummaryStripProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (summaries.length === 0) return null;

  const resetOf = (headline: QuotaSummaryHeadline | null): ResetDisplay | null =>
    headline
      ? buildResetDisplay(headline.resetLabel, headline.resetAtMs, now, i18n.resolvedLanguage)
      : null;

  return (
    <div className={styles.strip}>
      {summaries.map((summary) => {
        const iconSrc = getAuthFileIcon(summary.provider, resolvedTheme);
        const typeLabel = getTypeLabel(t, summary.provider);

        return (
          <article key={summary.provider} className={styles.card}>
            <header className={styles.head}>
              <span
                className={styles.iconWrap}
                style={
                  isThemeSurfaceIconProvider(summary.provider)
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
              <span className={styles.name}>{typeLabel}</span>
              <span className={styles.credentials}>
                {t('quota_management.credentials_count', { count: summary.credentialCount })}
              </span>
            </header>

            <div className={styles.headlineLabel}>{summary.headline?.label ?? ' '}</div>

            <HeadlineBlock
              headline={summary.headline}
              denominator={summary.denominator}
              credentialCount={summary.credentialCount}
              loaded={summary.loadedCount > 0}
              reset={resetOf(summary.headline)}
            />

            {summary.extraHeadlines.map((extra) => {
              const key = `${summary.provider}:${extra.label}`;
              const isExpanded = expanded[key] ?? false;
              return (
                <div key={extra.label} className={styles.extra}>
                  <div className={styles.extraToggleLine}>
                    <span className={styles.extraLabel}>{extra.label}</span>
                    <span className={styles.extraTotal}>{formatTotal(extra.totalRemaining)}</span>
                    <button
                      type="button"
                      className={styles.extraToggle}
                      onClick={() => setExpanded((prev) => ({ ...prev, [key]: !isExpanded }))}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded
                        ? t('quota_management.summary_hide')
                        : t('quota_management.summary_show')}
                    </button>
                  </div>
                  {isExpanded && (
                    <HeadlineBlock
                      headline={extra}
                      denominator={summary.denominator}
                      credentialCount={summary.credentialCount}
                      loaded={summary.loadedCount > 0}
                      reset={resetOf(extra)}
                    />
                  )}
                </div>
              );
            })}
          </article>
        );
      })}
    </div>
  );
}
