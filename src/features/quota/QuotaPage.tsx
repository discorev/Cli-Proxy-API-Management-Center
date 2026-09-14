/**
 * 额度查询页：提供商汇总条 + 分区行表。
 *
 * 保留的行为契约（重设计不改）：
 * - 现有提供商保持点击加载；Devin 首次可见时主动查询一次，不轮询；
 * - cacheGeneration 会话隔离 + request-id 去重（见 useQuotaBatchLoader）；
 * - 文件列表变化后按 provider 剪枝额度缓存（已删文件不残留）；
 * - useHeaderRefresh 单槽位：本页唯一注册者，全局刷新 = 重取文件列表。
 *
 * 分页已退役：行高约 58px，三十个凭证不翻页就能读完，而分区会被页边界切断。
 * 汇总条始终展示全部提供商；tab 只决定下面渲染哪些分区。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem, DevinQuotaState, ResolvedTheme } from '@/types';
import { isDevinFile } from '@/utils/quota';
import { identityTransform } from '@/utils/quota/redact';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';
import { QuotaHeader } from './components/QuotaHeader';
import { QuotaProviderSection } from './components/QuotaProviderSection';
import { QuotaRow } from './components/QuotaRow';
import { QuotaSummaryStrip } from './components/QuotaSummaryStrip';
import { QuotaTimeline } from './components/QuotaTimeline';
import {
  CARD_ENTRANCE_BUDGET_MS,
  QUOTA_SORT_MODES,
  QUOTA_TAB_ORDER,
  type QuotaSortMode,
  type QuotaTabId,
} from './constants';
import {
  buildTabCounts,
  canRefreshQuotaAfterList,
  classifyQuotaFiles,
  filterEntriesByTab,
  sortQuotaEntries,
  type QuotaFileEntry,
} from './logic';
import { buildProviderSummary } from './providerSummary';
import { nextRecoveryMs } from './resetSchedule';
import { QUOTA_ADAPTERS, getQuotaSetter, type QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import { getDevinQuotaSnapshotState } from './providers/devin/data';
import { useDevinQuotaAutoLoad } from './providers/devin/useDevinQuotaAutoLoad';
import { useQuotaActions } from './hooks/useQuotaActions';
import { useQuotaBatchLoader } from './hooks/useQuotaBatchLoader';
import {
  readPersistedQuotaRedactNames,
  readQuotaUiState,
  writePersistedQuotaRedactNames,
  writeQuotaUiState,
} from './uiState';
import styles from './QuotaPage.module.scss';

const TAB_IDS: string[] = ['all', ...QUOTA_TAB_ORDER];
const SKELETON_ROW_COUNT = 6;

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<QuotaTabId>(() => readQuotaUiState()?.tab ?? 'all');
  const [sortMode, setSortMode] = useState<QuotaSortMode>(
    () => readQuotaUiState()?.sortMode ?? 'default'
  );
  // 跨会话持久化：屏幕共享前藏起名字，重启后必须还藏着。
  const [redactNames, setRedactNames] = useState<boolean>(
    () => readPersistedQuotaRedactNames() ?? false
  );
  // 页头 + tabs 的入场级联（标题 → meta → 动作 → tabs，级差 70ms）
  const revealRef = useRevealGroup<HTMLDivElement>();

  const disableControls = connectionStatus !== 'connected';

  /* ---------- 文件列表 ---------- */

  const sessionGeneration = useQuotaStore((state) => state.cacheGeneration);
  const [filesGeneration, setFilesGeneration] = useState<number | null>(null);
  const [filesFileGenerations, setFilesFileGenerations] = useState<Record<string, number>>({});
  const fileGenerations = useQuotaStore((state) => state.fileGenerations);
  const listRequestRef = useRef(0);
  const loadFiles = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    const requestFileGenerations = useQuotaStore.getState().fileGenerations;
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesGeneration(null);
      setLoading(false);
      return;
    }
    const isCurrent = () =>
      requestId === listRequestRef.current &&
      sessionGeneration === useQuotaStore.getState().cacheGeneration;
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      if (!isCurrent()) return;
      setFiles(data?.files || []);
      setFilesGeneration(sessionGeneration);
      setFilesFileGenerations(requestFileGenerations);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connectionStatus, sessionGeneration, t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    void loadFiles();
    return () => {
      listRequestRef.current += 1;
    };
  }, [loadFiles]);

  /* ---------- 额度缓存 ----------
   * 排在归类/排序之前：「最快恢复优先」要读它算排序键。 */

  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const devinQuota = useQuotaStore((state) => state.devinQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);

  const devinSnapshots = useMemo(() => {
    const snapshots: Record<string, DevinQuotaState> = {};
    if (filesGeneration !== sessionGeneration) return snapshots;
    files.filter(isDevinFile).forEach((file) => {
      if ((fileGenerations[file.name] ?? 0) !== (filesFileGenerations[file.name] ?? 0)) return;
      const snapshot = getDevinQuotaSnapshotState(file, t);
      if (snapshot) snapshots[getQuotaCacheKey(file)] = snapshot;
    });
    return snapshots;
  }, [files, filesGeneration, filesFileGenerations, fileGenerations, sessionGeneration, t]);

  const quotaByType = useMemo<Record<QuotaProviderType, Record<string, QuotaCardState>>>(
    () =>
      ({
        antigravity: antigravityQuota,
        claude: claudeQuota,
        codex: codexQuota,
        devin: { ...devinSnapshots, ...devinQuota },
        kimi: kimiQuota,
        xai: xaiQuota,
      }) as unknown as Record<QuotaProviderType, Record<string, QuotaCardState>>,
    [antigravityQuota, claudeQuota, codexQuota, devinQuota, devinSnapshots, kimiQuota, xaiQuota]
  );

  const getQuota = useCallback(
    (entry: QuotaFileEntry): QuotaCardState | undefined =>
      quotaByType[entry.type][getQuotaCacheKey(entry.file)],
    [quotaByType]
  );

  /* ---------- 名称遮蔽 ----------
   * 单一入口：行、汇总条分段 tooltip、时间线泳道名都走这一个变换。 */

  const displayNameFor = useMemo(() => identityTransform(redactNames), [redactNames]);

  const handleToggleRedactNames = useCallback((next: boolean) => {
    setRedactNames(next);
    writePersistedQuotaRedactNames(next);
  }, []);

  /* ---------- 归类 / 过滤 / 排序 ---------- */

  // 只在「最快恢复优先」下订阅分钟时钟。默认序下不门控的话，可见条目每分钟
  // 换一次身份，会反复空转下面那个「刷新全部」的 loading 下降沿 effect。
  const tick = useNow(sortMode !== 'default');
  const sortNow = sortMode === 'default' ? 0 : tick;

  const entries = useMemo(() => classifyQuotaFiles(files), [files]);
  const tabCounts = useMemo(() => buildTabCounts(entries), [entries]);
  const filteredEntries = useMemo(() => filterEntriesByTab(entries, tab), [entries, tab]);

  const resolveNextRecovery = useCallback(
    (entry: QuotaFileEntry) => nextRecoveryMs(entry.type, getQuota(entry), sortNow),
    [getQuota, sortNow]
  );
  const sortedEntries = useMemo(
    () => sortQuotaEntries(filteredEntries, sortMode, resolveNextRecovery),
    [filteredEntries, sortMode, resolveNextRecovery]
  );

  /* ---------- 汇总条 ----------
   * 始终覆盖全部提供商（不随 tab 收窄）：它回答「我还有没有余量」，
   * 而这个问题不会因为正在看 Codex 就变成只关于 Codex。 */

  // 汇总条页脚要的是「下一次」恢复，所以它必须跟着分钟时钟走，
  // 否则窗口翻过去之后页脚会停在一个已经走完的倒计时上。
  const summaryNow = useNow();

  const summaries = useMemo(
    () =>
      QUOTA_TAB_ORDER.map((provider) => {
        const providerEntries = entries.filter((entry) => entry.type === provider);
        if (providerEntries.length === 0) return null;
        return buildProviderSummary(
          provider,
          providerEntries.map((entry) => ({
            key: getQuotaCacheKey(entry.file),
            displayName: displayNameFor(getQuotaDisplayName(entry.file)),
            quota: getQuota(entry),
          })),
          t,
          summaryNow
        );
      }).filter((summary) => summary !== null),
    [displayNameFor, entries, getQuota, summaryNow, t]
  );

  /* ---------- 分区 ---------- */

  const sections = useMemo(
    () =>
      QUOTA_TAB_ORDER.map((provider) => ({
        provider,
        rows: sortedEntries.filter((entry) => entry.type === provider),
      })).filter((section) => section.rows.length > 0),
    [sortedEntries]
  );

  const handleTabChange = useCallback((next: string) => {
    setTab(next as QuotaTabId);
    writeQuotaUiState({ tab: next as QuotaTabId });
  }, []);

  const handleSortModeChange = useCallback((next: string) => {
    setSortMode(next as QuotaSortMode);
    writeQuotaUiState({ sortMode: next as QuotaSortMode });
  }, []);

  const sortOptions = useMemo(
    () =>
      QUOTA_SORT_MODES.map((mode) => ({ value: mode, label: t(`quota_management.sort_${mode}`) })),
    [t]
  );

  const { loadedCount, attentionCount } = useMemo(() => {
    let loaded = 0;
    let attention = 0;
    entries.forEach((entry) => {
      const status = quotaByType[entry.type][getQuotaCacheKey(entry.file)]?.status;
      if (status === 'success') loaded += 1;
      else if (status === 'error') attention += 1;
    });
    return { loadedCount: loaded, attentionCount: attention };
  }, [entries, quotaByType]);

  // 剪枝：文件列表落定后，各 provider 缓存只保留仍存在的凭证
  useEffect(() => {
    if (loading || error || filesGeneration !== sessionGeneration) return;
    const survivorsByType = new Map<QuotaProviderType, Set<string>>(
      QUOTA_TAB_ORDER.map((type) => [type, new Set<string>()])
    );
    entries.forEach((entry) => survivorsByType.get(entry.type)?.add(getQuotaCacheKey(entry.file)));

    QUOTA_TAB_ORDER.forEach((type) => {
      const survivors = survivorsByType.get(type) ?? new Set<string>();
      const setQuota = getQuotaSetter(QUOTA_ADAPTERS[type]);
      setQuota((prev) => {
        const staleKeys = Object.keys(prev).filter((name) => !survivors.has(name));
        if (staleKeys.length === 0) return prev;
        const next = { ...prev };
        staleKeys.forEach((name) => delete next[name]);
        return next;
      });
    });
  }, [entries, error, filesGeneration, loading, sessionGeneration]);

  /* ---------- 加载与操作 ---------- */

  const { batchLoading, loadQuota } = useQuotaBatchLoader();
  const { resettingQuotaName, refreshQuota, resetQuota } = useQuotaActions(disableControls);

  const pendingRefreshRef = useRef<number | null>(null);
  const prevLoadingRef = useRef(loading);

  // 刷新全部：先重取文件列表，待其落定（loading 下降沿）再批量拉可见凭证额度
  const handleRefreshAll = useCallback(() => {
    if (disableControls) return;
    pendingRefreshRef.current = sessionGeneration;
    void loadFiles();
  }, [disableControls, loadFiles, sessionGeneration]);

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    const requestedSession = pendingRefreshRef.current;
    if (requestedSession === null) return;
    if (requestedSession !== sessionGeneration) {
      pendingRefreshRef.current = null;
      return;
    }
    if (loading || !wasLoading) return;

    pendingRefreshRef.current = null;
    if (
      canRefreshQuotaAfterList(
        requestedSession,
        sessionGeneration,
        filesGeneration,
        Boolean(error),
        disableControls
      )
    ) {
      void loadQuota(sortedEntries);
    }
  }, [
    disableControls,
    error,
    filesGeneration,
    loading,
    loadQuota,
    sessionGeneration,
    sortedEntries,
  ]);

  useDevinQuotaAutoLoad(
    sortedEntries,
    disableControls ||
      loading ||
      batchLoading ||
      Boolean(error) ||
      filesGeneration !== sessionGeneration,
    loadQuota
  );

  const canUseActions = !disableControls && !loading && filesGeneration === sessionGeneration;

  /* ---------- 首屏行一次性级联入场 ----------
   * 首批数据渲染后立即翻转 rowsAnimated；已挂载的行在挂载时捕获过自己的延迟
   * （QuotaRow 内 useState 初始化），后续切 tab/刷新新挂载的行拿到 null。 */

  const [rowsAnimated, setRowsAnimated] = useState(false);
  const enableRowEntrance = !rowsAnimated && !loading && sortedEntries.length > 0;
  useEffect(() => {
    if (enableRowEntrance) {
      setRowsAnimated(true);
    }
  }, [enableRowEntrance]);
  const rowEntranceDelay = (index: number): number | null => {
    if (!enableRowEntrance) return null;
    if (sortedEntries.length <= 1) return 0;
    return Math.round((index / (sortedEntries.length - 1)) * CARD_ENTRANCE_BUDGET_MS);
  };

  /* ---------- 渲染 ---------- */

  const isEmpty = !loading && filteredEntries.length === 0;
  let rowIndex = 0;

  return (
    <div className={styles.page} ref={revealRef}>
      <QuotaHeader
        totalCount={entries.length}
        loadedCount={loadedCount}
        attentionCount={attentionCount}
        refreshing={loading || batchLoading}
        disableControls={disableControls}
        redactNames={redactNames}
        onToggleRedactNames={handleToggleRedactNames}
        onRefreshAll={handleRefreshAll}
      />

      <section className={styles.workbench}>
        {!loading && <QuotaSummaryStrip summaries={summaries} resolvedTheme={resolvedTheme} />}

        {/* tabs + 排序作为一个整体入场（useRevealGroup 会给每个 [data-reveal]
            后代加一级级差，所以排序控件放在同一个节点里而不是做兄弟） */}
        <div className={styles.tabsRow} data-reveal>
          <ProviderTabs
            types={TAB_IDS}
            counts={tabCounts}
            active={tab}
            resolvedTheme={resolvedTheme}
            onChange={handleTabChange}
          />
          <div className={styles.sort}>
            <Select
              value={sortMode}
              options={sortOptions}
              onChange={handleSortModeChange}
              ariaLabel={t('quota_management.sort_label')}
              size="sm"
            />
          </div>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className={styles.skeletonList} aria-hidden="true">
            {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
              <Skeleton key={index} height={58} rounded={10} />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState
            title={
              tab === 'all'
                ? t('quota_management.empty_title')
                : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_title`)
            }
            description={
              tab === 'all'
                ? t('quota_management.empty_desc')
                : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_desc`)
            }
            action={
              tab === 'all' ? undefined : (
                <Button variant="secondary" size="sm" onClick={() => handleTabChange('all')}>
                  {t('auth_files.filter_all')}
                </Button>
              )
            }
          />
        ) : (
          <div className={styles.sections}>
            {sections.map((section) => (
              <QuotaProviderSection
                key={section.provider}
                provider={section.provider}
                count={section.rows.length}
                resolvedTheme={resolvedTheme}
              >
                {section.rows.map((entry) => {
                  const cacheKey = getQuotaCacheKey(entry.file);
                  return (
                    <QuotaRow
                      key={`${entry.type}:${cacheKey}`}
                      entry={entry}
                      quota={getQuota(entry)}
                      displayName={displayNameFor(getQuotaDisplayName(entry.file))}
                      canRefresh={canUseActions && !entry.file.disabled}
                      resetting={resettingQuotaName === cacheKey}
                      entranceDelayMs={rowEntranceDelay(rowIndex++)}
                      onRefresh={() => void refreshQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
                      onReset={() => resetQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
                    />
                  );
                })}
              </QuotaProviderSection>
            ))}
          </div>
        )}

        <QuotaTimeline
          entries={sortedEntries}
          quotaFor={getQuota}
          displayNameFor={displayNameFor}
          resolvedTheme={resolvedTheme}
        />
      </section>
    </div>
  );
}
