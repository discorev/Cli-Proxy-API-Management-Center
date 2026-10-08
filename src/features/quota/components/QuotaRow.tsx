/**
 * One credential, one line.
 *
 * The card grid gave every credential a 170px tile, so fifteen credentials
 * meant scrolling and paging to answer "which of these is nearly empty". A row
 * puts the identity, every window and the actions on one baseline, and the
 * meters line up down the page so the answer is a glance rather than a tour.
 *
 * Four states, same as the card it replaces: idle offers the load, loading
 * shows ghost meters, error repeats the provider's own failure copy, success
 * renders the normalized row model.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { buildResetDisplay, resolveQuotaErrorMessage, type ResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import type { ClaudeQuotaState, QuotaUsageMeta } from '@/types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { collectQuotaRowInstants, pickUrgentRowId } from '../resetSchedule';
import { toQuotaRowModel } from '../rowModel';
import { quotaMeterLevel, type QuotaMeterLevel } from '../meterLevel';
import { QuotaUsageNotes } from './QuotaUsageNotes';
import styles from './QuotaRow.module.scss';

export type QuotaRowProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  /** Identity as it should be shown — already redacted when the toggle is on. */
  displayName: string;
  canRefresh: boolean;
  resetting: boolean;
  /** First-paint cascade delay; null = no entrance (tab switch, refresh). */
  entranceDelayMs?: number | null;
  onRefresh: () => void;
  onReset: () => void;
};

const meterClass: Record<QuotaMeterLevel, string> = {
  high: styles.meterFillHigh,
  medium: styles.meterFillMedium,
  low: styles.meterFillLow,
};

function Meter({ percent }: { percent: number | null }) {
  const width = percent === null ? 0 : Math.round(Math.max(0, Math.min(100, percent)) * 100) / 100;
  return (
    <div className={styles.meter}>
      <div
        className={`${styles.meterFill} ${meterClass[quotaMeterLevel(percent)]}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function ResetText({
  display,
  soon,
  prefix,
}: {
  display: ResetDisplay | null;
  soon: boolean;
  /** Muted lead-in such as "Expires:". */
  prefix?: string;
}) {
  if (!display) return null;
  const when = (
    <>
      {display.relative && (
        <span
          className={soon ? `${styles.resetRelative} ${styles.resetSoon}` : styles.resetRelative}
        >
          {display.relative}
        </span>
      )}
      <span className={styles.resetAbsolute}>{display.absolute}</span>
    </>
  );
  return (
    <span className={styles.reset}>
      {prefix ? (
        <>
          <span className={styles.resetPrefix}>{prefix}</span>
          {/* In a narrow cell only the prefix wraps, never the relative · absolute pair. */}
          <span className={styles.resetWhen}>{when}</span>
        </>
      ) : (
        when
      )}
    </span>
  );
}

export function QuotaRow(props: QuotaRowProps) {
  const { entry, quota, displayName, canRefresh, resetting, entranceDelayMs, onRefresh, onReset } =
    props;
  const { t, i18n } = useTranslation();
  const now = useNow();
  const locale = i18n.resolvedLanguage;
  const adapter = QUOTA_ADAPTERS[entry.type];
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const claudeReset = useClaudeResetGrants(
    entry.file,
    entry.type === 'claude' ? (quota as ClaudeQuotaState | undefined) : undefined,
    !canRefresh || loading || resetting
  );
  // Only the usage-cache providers (Claude, Codex) carry this.
  const usage =
    status === 'success' ? (quota as { usage?: QuotaUsageMeta } | undefined)?.usage : undefined;

  // Captured at mount, like the card before it: the cascade plays once on first
  // paint and never replays when a tab switch remounts the list.
  const [mountDelayMs] = useState<number | null>(entranceDelayMs ?? null);
  const entranceStyle =
    mountDelayMs === null ? undefined : ({ '--row-delay': `${mountDelayMs}ms` } as CSSProperties);

  const model = useMemo(() => toQuotaRowModel(entry.type, quota, t), [entry.type, quota, t]);
  const urgentRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants(entry.type, quota), now),
    [entry.type, quota, now]
  );

  const showReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));

  const errorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  const expiresPrefix = t('quota_management.reset_expires_prefix');
  const claudeExpiryDisplay = buildResetDisplay(null, claudeReset.expiresAtMs, now, locale);
  const nextCredit = model?.resetCredits?.credits[0];
  const creditDisplay = nextCredit
    ? buildResetDisplay(nextCredit.resetLabel, nextCredit.resetAtMs, now, locale)
    : null;

  return (
    <div
      className={`${styles.row} ${mountDelayMs === null ? '' : styles.rowEnter}`}
      style={entranceStyle}
    >
      <div className={styles.identity}>
        <span className={styles.name} title={displayName}>
          {displayName}
        </span>
        {(model?.plan || model?.planNote) && (
          <span className={styles.plan} title={model?.planNote ?? undefined}>
            {model?.plan}
            {model?.plan && model?.planNote && <span className={styles.planDot}>·</span>}
            {model?.planNote}
          </span>
        )}
      </div>

      <div className={styles.body}>
        {status === 'idle' ? (
          <button
            type="button"
            className={styles.idle}
            onClick={onRefresh}
            disabled={!canRefresh}
            title={t(`${adapter.i18nPrefix}.idle`)}
          >
            {t('quota_management.row_not_loaded')}
          </button>
        ) : loading ? (
          <div className={styles.skeleton} aria-busy="true">
            <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
            {[0, 1].map((index) => (
              <span key={index} className={styles.skeletonTrack} aria-hidden="true" />
            ))}
          </div>
        ) : status === 'error' ? (
          <div className={styles.errorStrip} role="alert">
            {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
          </div>
        ) : model && model.windows.length > 0 ? (
          <div className={styles.windows}>
            {model.windows.map((window) => {
              const soon = window.id === urgentRowId;
              const display = buildResetDisplay(window.resetLabel, window.resetAtMs, now, locale);
              return (
                <div
                  key={window.id}
                  className={soon ? `${styles.window} ${styles.windowSoon}` : styles.window}
                  title={soon ? t('quota_management.soonest_row_hint') : undefined}
                >
                  <div className={styles.windowHead}>
                    <span className={styles.windowLabel}>{window.label}</span>
                    <span className={styles.windowPercent}>
                      {window.remainingPercent === null
                        ? '--'
                        : `${Math.round(window.remainingPercent)}%`}
                    </span>
                  </div>
                  <Meter percent={window.remainingPercent} />
                  <ResetText display={display} soon={soon} />
                </div>
              );
            })}
            {model.resetCredits && (
              <div className={`${styles.window} ${styles.resetSlot}`}>
                <div className={styles.windowHead}>
                  <span className={`${styles.windowLabel} ${styles.creditsLabel}`}>
                    {t('codex_quota.reset_credits_label')}
                  </span>
                </div>
                <span className={styles.creditsValue}>
                  <span className={styles.creditsCount}>
                    {model.resetCredits.available ?? '--'}
                  </span>
                  {t('quota_management.manual_resets_unit')}
                </span>
                <ResetText
                  display={creditDisplay}
                  soon={nextCredit?.id === urgentRowId}
                  prefix={expiresPrefix}
                />
              </div>
            )}
            {entry.type === 'claude' && (
              <div className={`${styles.window} ${styles.resetSlot}`}>
                <div className={styles.windowHead}>
                  <span className={`${styles.windowLabel} ${styles.creditsLabel}`}>
                    {t('claude_reset.remaining')}
                  </span>
                </div>
                <span className={styles.creditsValue}>
                  <span className={styles.creditsCount}>{claudeReset.count ?? 0}</span>
                </span>
                <ResetText display={claudeExpiryDisplay} soon={false} prefix={expiresPrefix} />
              </div>
            )}
          </div>
        ) : (
          <div className={styles.message}>
            {model?.message ?? t('quota_management.row_not_loaded')}
          </div>
        )}
        {usage && (
          <div className={styles.usageNotes}>
            <QuotaUsageNotes
              usage={usage}
              noteClassName={styles.usageNote}
              errorClassName={styles.creditsError}
            />
          </div>
        )}
      </div>

      <div className={styles.actions}>
        {entry.type === 'claude' && status !== 'idle' && (
          <button
            type="button"
            className={styles.action}
            onClick={claudeReset.confirm}
            disabled={claudeReset.blocked}
            title={t('claude_reset.use')}
          >
            <IconRefreshCw size={12} className={claudeReset.busy ? styles.spinning : undefined} />
            {t('claude_reset.use')}
          </button>
        )}
        {showReset && (
          <button
            type="button"
            className={styles.action}
            onClick={onReset}
            disabled={!canRefresh || loading || resetting}
            title={t('codex_quota.reset_button')}
          >
            <IconRefreshCw size={12} className={resetting ? styles.spinning : undefined} />
            {t('codex_quota.reset_button')}
          </button>
        )}
        <button
          type="button"
          className={
            status === 'idle' || usage?.notFetched
              ? `${styles.action} ${styles.actionPrimary}`
              : styles.action
          }
          onClick={onRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
          title={t('auth_files.quota_refresh_hint')}
        >
          <IconRefreshCw size={12} className={loading ? styles.spinning : undefined} />
          {t('auth_files.quota_refresh_single')}
        </button>
      </div>
    </div>
  );
}
