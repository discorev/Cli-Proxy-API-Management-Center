/**
 * One flat shape for six provider states.
 *
 * The card grid let every provider render its own body, so each state shape
 * only ever had to satisfy its own component. The row layout and the summary
 * strip both need the same thing instead — a list of windows with a label, a
 * remaining percentage and a reset instant — and deriving that twice, once per
 * view, is how the two would drift apart.
 *
 * Pure and React-free (`t` is injected), so every provider is directly
 * testable. The existing `*QuotaBody` components are untouched: they still
 * render the Auth Files compact card from the raw state.
 */

import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  XaiQuotaState,
} from '@/types';
import {
  PREMIUM_CODEX_PLAN_TYPES,
  formatInstantShort,
  formatKimiResetHint,
  formatQuotaResetTime,
  normalizePlanType,
  parseIsoToMs,
  resolveResetMs,
} from '@/utils/quota';
import { XAI_WEEKLY_ROW_ID } from './resetSchedule';
import type { QuotaProviderType } from './providers/types';

export interface QuotaRowWindow {
  /** Matches the row id used by resetSchedule, so highlighting lines up. */
  id: string;
  label: string;
  /** Remaining capacity, 0–100. Null when the provider reported none. */
  remainingPercent: number | null;
  /** Absolute label baked at fetch time; null when only an instant exists. */
  resetLabel: string | null;
  resetAtMs: number | null;
  /** Window length in hours — the summary picks the provider's longest. */
  periodHours: number | null;
}

export interface QuotaRowResetCredit {
  id: string;
  resetLabel: string | null;
  resetAtMs: number | null;
}

export interface QuotaRowResetCredits {
  available: number;
  credits: QuotaRowResetCredit[];
}

export interface QuotaRowModel {
  /** Subscription tier, already localized. */
  plan: string | null;
  /** Secondary plan detail — renewal date, extra-usage spend. */
  planNote: string | null;
  windows: QuotaRowWindow[];
  /** Codex only: manual resets available and when they expire. */
  resetCredits?: QuotaRowResetCredits;
  /** Shown instead of windows when the provider returned nothing usable. */
  message: string | null;
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

/** Used-percent payloads become remaining capacity; null survives as null. */
const remainingFromUsed = (used: number | null | undefined): number | null =>
  used === null || used === undefined ? null : clampPercent(100 - clampPercent(used));

const trimLabel = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed && trimmed !== '-' ? trimmed : null;
};

const EMPTY_MODEL: QuotaRowModel = { plan: null, planNote: null, windows: [], message: null };

/* ---------------------------------------------------------------- Claude */

function claudeRowModel(quota: ClaudeQuotaState, t: TFunction): QuotaRowModel {
  const extra = quota.extraUsage ?? null;
  return {
    plan: quota.planType ? t(`claude_quota.${quota.planType}`) : null,
    planNote:
      extra && extra.is_enabled
        ? `${t('claude_quota.extra_usage_label')} $${(extra.used_credits / 100).toFixed(2)} / $${(
            extra.monthly_limit / 100
          ).toFixed(2)}`
        : null,
    windows: (quota.windows ?? []).map((window) => ({
      id: window.id,
      label: window.labelKey ? t(window.labelKey) : window.label,
      remainingPercent: remainingFromUsed(window.usedPercent),
      resetLabel: trimLabel(window.resetLabel),
      resetAtMs: window.resetAtMs ?? null,
      periodHours: window.periodHours ?? null,
    })),
    message: (quota.windows ?? []).length === 0 ? t('claude_quota.empty_windows') : null,
  };
}

/* ----------------------------------------------------------------- Codex */

/**
 * Mirrors `CodexQuotaBody`'s plan labelling. Duplicated rather than shared
 * because the body is frozen for the Auth Files card; the ordering contract it
 * depends on lives in `resolvePlanTier` and is guarded by quotaPlanTier tests.
 */
function codexPlanLabel(planType: string | null | undefined, t: TFunction): string | null {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'pro') return t('codex_quota.plan_pro');
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return t('codex_quota.plan_prolite');
  if (normalized === 'plus') return t('codex_quota.plan_plus');
  if (normalized === 'team') return t('codex_quota.plan_team');
  if (normalized === 'free') return t('codex_quota.plan_free');
  return planType || normalized;
}

function codexRowModel(quota: CodexQuotaState, t: TFunction): QuotaRowModel {
  const subscriptionMs = resolveResetMs([quota.subscriptionActiveUntil ?? null]);
  const credits = (quota.rateLimitResetCredits ?? []).filter(
    (credit) => credit.status === 'available'
  );
  const availableCount = quota.rateLimitResetCreditsAvailableCount;

  return {
    plan: codexPlanLabel(quota.planType, t),
    planNote:
      subscriptionMs === null
        ? null
        : `${t('codex_quota.expires_label')} ${formatInstantShort(subscriptionMs)}`,
    windows: (quota.windows ?? []).map((window) => ({
      id: window.id,
      label: window.labelKey
        ? t(window.labelKey, (window.labelParams ?? {}) as Record<string, string | number>)
        : window.label,
      remainingPercent: remainingFromUsed(window.usedPercent),
      resetLabel: trimLabel(window.resetLabel),
      resetAtMs: window.resetAtMs ?? null,
      periodHours: window.periodHours ?? null,
    })),
    resetCredits:
      availableCount === null || availableCount === undefined
        ? undefined
        : {
            available: availableCount,
            credits: credits.map((credit, index) => {
              const atMs = parseIsoToMs(credit.expiresAt);
              return {
                id: credit.id || `${credit.expiresAt}-${index}`,
                resetLabel: atMs === null ? trimLabel(credit.expiresAt) : formatInstantShort(atMs),
                resetAtMs: atMs,
              };
            }),
          },
    message: (quota.windows ?? []).length === 0 ? t('codex_quota.empty_windows') : null,
  };
}

/* ----------------------------------------------------------------- Devin */

function devinRowModel(quota: DevinQuotaState, t: TFunction): QuotaRowModel {
  return {
    plan: quota.plan,
    planNote:
      quota.planEndMs === null
        ? null
        : `${t('devin_quota.plan_end')} ${formatInstantShort(quota.planEndMs)}`,
    windows: (quota.windows ?? []).map((window) => ({
      id: window.id,
      label: t(`devin_quota.${window.id}`),
      remainingPercent: window.remainingPercent === null ? null : clampPercent(window.remainingPercent),
      resetLabel: null,
      resetAtMs: window.resetAtMs,
      periodHours: window.periodHours,
    })),
    message: (quota.windows ?? []).length === 0 ? t('devin_quota.reset_unknown') : null,
  };
}

/* ------------------------------------------------------------------ Kimi */

function kimiRowModel(quota: KimiQuotaState, t: TFunction): QuotaRowModel {
  const rows = quota.rows ?? [];
  return {
    plan: null,
    planNote: null,
    windows: rows.map((row) => {
      const remaining =
        row.limit > 0
          ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100))
          : row.used > 0
            ? 0
            : null;
      return {
        id: row.id,
        label: row.labelKey
          ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
          : (row.label ?? ''),
        remainingPercent: remaining,
        resetLabel:
          row.resetAtMs == null ? trimLabel(formatKimiResetHint(t, row.resetHint)) : null,
        resetAtMs: row.resetAtMs ?? null,
        periodHours: row.periodHours ?? null,
      };
    }),
    message: rows.length === 0 ? t('kimi_quota.empty_data') : null,
  };
}

/* ------------------------------------------------------------------- xAI */

const XAI_SUPERGROK_LIMIT_CENTS = 15_000;
const XAI_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

function xaiPlanLabel(monthlyLimitCents: number | null, t: TFunction): string | null {
  if (monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS) return t('xai_quota.plan_supergrok');
  if (monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) {
    return t('xai_quota.plan_supergrok_heavy');
  }
  return null;
}

function xaiRowModel(quota: XaiQuotaState, t: TFunction): QuotaRowModel {
  const billing = quota.billing;
  if (!billing) return { ...EMPTY_MODEL, message: t('xai_quota.empty_data') };
  if (billing.mode === 'paid-health') {
    return {
      plan: t('xai_quota.plan_paid'),
      planNote: null,
      windows: [],
      message: t('xai_quota.paid_health'),
    };
  }

  const windows: QuotaRowWindow[] = [];

  if (billing.periodType === 'weekly') {
    const weeklyReset = formatQuotaResetTime(billing.periodEnd);
    windows.push({
      id: XAI_WEEKLY_ROW_ID,
      label: t('xai_quota.weekly_limit'),
      remainingPercent: remainingFromUsed(billing.usagePercent),
      resetLabel: trimLabel(weeklyReset),
      resetAtMs: billing.resetAtMs ?? null,
      periodHours: billing.periodHours ?? null,
    });
  }

  billing.productUsage.forEach((item) => {
    windows.push({
      id: `xai:product:${item.product}`,
      label: t('xai_quota.product_usage', { product: item.product }),
      remainingPercent: remainingFromUsed(item.usagePercent),
      resetLabel: null,
      resetAtMs: null,
      periodHours: null,
    });
  });

  if ((billing.onDemandCapCents ?? 0) > 0) {
    windows.push({
      id: 'xai:on-demand',
      label: t('xai_quota.pay_as_you_go_label'),
      remainingPercent: remainingFromUsed(billing.onDemandUsedPercent),
      resetLabel: null,
      resetAtMs: null,
      periodHours: null,
    });
  }

  const hasMonthly =
    billing.monthlyLimitCents !== null ||
    billing.usedCents !== null ||
    Boolean(billing.billingPeriodEnd);
  if (hasMonthly) {
    // A billing cycle, not a rate limit — it carries no periodHours, so the
    // summary never mistakes it for the provider's longest quota window.
    windows.push({
      id: 'xai:monthly',
      label: t('xai_quota.monthly_credits'),
      remainingPercent: remainingFromUsed(billing.usedPercent),
      resetLabel: trimLabel(formatQuotaResetTime(billing.billingPeriodEnd)),
      resetAtMs: parseIsoToMs(billing.billingPeriodEnd),
      periodHours: null,
    });
  }

  return {
    plan: xaiPlanLabel(billing.monthlyLimitCents, t),
    planNote: null,
    windows,
    message: windows.length === 0 ? t('xai_quota.empty_data') : null,
  };
}

/* ---------------------------------------------------------- Antigravity */

const ANTIGRAVITY_GROUP_LABEL_KEYS = new Map<string, string>([
  ['gemini models', 'group_gemini_models'],
  ['claude and gpt models', 'group_claude_gpt_models'],
]);

const ANTIGRAVITY_BUCKET_LABEL_KEYS = new Map<string, string>([
  ['weekly limit', 'weekly_limit'],
  ['daily limit', 'daily_limit'],
  ['5 hour limit', 'five_hour_limit'],
  ['5-hour limit', 'five_hour_limit'],
  ['five hour limit', 'five_hour_limit'],
  ['monthly limit', 'monthly_limit'],
]);

const translateAntigravityLabel = (
  value: string,
  keys: Map<string, string>,
  t: TFunction
): string => {
  const key = keys.get(value.trim().toLowerCase().replace(/\s+/g, ' '));
  return key ? t(`antigravity_quota.${key}`) : value;
};

function antigravityPlanLabel(quota: AntigravityQuotaState, t: TFunction): string | null {
  const subscription = quota.subscription;
  if (!subscription) return null;
  if (subscription.plan === 'free') return t('antigravity_subscription.plan_free');
  if (subscription.plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (subscription.plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (subscription.plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return (
    subscription.tierName ||
    subscription.tierId ||
    (subscription.plan === 'unknown' ? t('antigravity_subscription.plan_unknown') : null)
  );
}

function antigravityRowModel(quota: AntigravityQuotaState, t: TFunction): QuotaRowModel {
  const groups = quota.groups ?? [];
  const windows: QuotaRowWindow[] = groups.flatMap((group) => {
    const groupLabel = translateAntigravityLabel(group.label, ANTIGRAVITY_GROUP_LABEL_KEYS, t);
    return (group.buckets ?? []).map((bucket) => ({
      id: bucket.id,
      // Buckets repeat their limit names across groups, so the row label has to
      // carry the group or three "Weekly limit" columns sit side by side.
      label: `${groupLabel} · ${translateAntigravityLabel(
        bucket.label,
        ANTIGRAVITY_BUCKET_LABEL_KEYS,
        t
      )}`,
      remainingPercent: clampPercent(Math.max(0, Math.min(1, bucket.remainingFraction)) * 100),
      resetLabel: bucket.resetAtMs ? null : trimLabel(bucket.resetTime),
      resetAtMs: bucket.resetAtMs ?? null,
      periodHours: bucket.periodHours ?? null,
    }));
  });

  return {
    plan: antigravityPlanLabel(quota, t),
    planNote: null,
    windows,
    message: windows.length === 0 ? t('antigravity_quota.empty_models') : null,
  };
}

/* ----------------------------------------------------------------- entry */

/**
 * Normalize one credential's quota state into the row/summary shape.
 *
 * Returns null for anything that is not a loaded success — idle, loading and
 * error rows render their own state and have no windows to show.
 */
export function toQuotaRowModel(
  provider: QuotaProviderType,
  quota: unknown,
  t: TFunction
): QuotaRowModel | null {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return null;

  switch (provider) {
    case 'claude':
      return claudeRowModel(quota as ClaudeQuotaState, t);
    case 'codex':
      return codexRowModel(quota as CodexQuotaState, t);
    case 'devin':
      return devinRowModel(quota as DevinQuotaState, t);
    case 'kimi':
      return kimiRowModel(quota as KimiQuotaState, t);
    case 'xai':
      return xaiRowModel(quota as XaiQuotaState, t);
    case 'antigravity':
      return antigravityRowModel(quota as AntigravityQuotaState, t);
    default:
      return EMPTY_MODEL;
  }
}
