/**
 * SignalsWorkspacePage — unified `/signals` workspace.
 *
 * Composes the seven shared telemetry components so this page is a thin
 * orchestrator instead of duplicating five pages' worth of UI:
 *
 *   - SignalCatalogPanel    — staleness-aware catalog (left rail)
 *   - SignalSelector        — capped multi-select (workspace toolbar)
 *   - SignalChartPanel      — multi-line chart (live + historical)
 *   - SignalStatsPanel      — per-signal min/max/avg/count
 *   - SignalHistoryTable    — paginated history with row expansion
 *   - LiveSignalTail        — pause/autoscroll/clear/filter live tail
 *   - SignalCompareControls — windows + presets + filter + chips
 *   + SignalDiffTable       — already-extracted diff table
 *   + useLiveSignalStream   — chart + tail SSE hook
 *
 * Two mutually-exclusive mode toggles (Live / Compare) drive the right
 * column without behaving like tabs — the catalog is always visible
 * alongside, and toggling neither leaves a sensible default historical
 * view. URL state ensures every view is deep-linkable.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  Bell,
  Database,
  GitCompare,
  Pin,
  PinOff,
  Radio,
  RefreshCw,
} from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Badge, Button, Select, HelpTooltip, CopyButton } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { StatCard, BulkActionsToolbar, SavedViewMenu } from '@/components/data-display';
import type { BulkAction } from '@/components/data-display/BulkActionsToolbar';
import { EmptyState, AlertBanner, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUrlArray, useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { useRangeState } from '@/hooks/useRangeState';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useSignals, useSignalDiffServer, type SignalDiffRow } from '@/api/hooks/useTelemetry';
import { usePinned, useTogglePin } from '@/api/hooks/usePinned';
import { request } from '@/api/client';
import { getErrorMessage } from '@/lib/errorMessage';
import { fmtInt } from '@/lib/numberFormat';
import { downloadCSV, objectsToCSV } from '@/lib/csvExport';
import type { SignalHistoryResp } from '@/api/types';
import { adaptSignalHistoryResp, type SignalLogEntry } from '@/components/SignalQueryControls';

import { SignalDiffTable } from '../components/SignalDiffTable';
import { SignalCatalogPanel } from '../components/SignalCatalogPanel';
import { SignalSelector } from '../components/SignalSelector';
import { SignalChartPanel } from '../components/SignalChartPanel';
import { SignalStatsPanel } from '../components/SignalStatsPanel';
import { SignalHistoryTable } from '../components/SignalHistoryTable';
import { LiveSignalTail } from '../components/LiveSignalTail';
import {
  SignalCompareControls,
  CATEGORY_PREFIXES,
  isoOrEmpty,
  toLocalDatetimeInput,
} from '../components/SignalCompareControls';
import { useLiveSignalStream, type SignalStat } from '../hooks/useLiveSignalStream';

const MAX_SELECTED_SIGNALS = 5;
const LIVE_TAIL_MAX = 500;

const PER_PAGE_OPTIONS = [
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '500', label: '500' },
];

interface CombinedHistoryRow extends SignalLogEntry {}

export default function SignalsWorkspacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('signalsWorkspace.title', 'Signals'));

  // ── Vehicle context ───────────────────────────────────────────
  const { vehicleId: storeVehicleId } = useSelectedVehicle();
  const vehicleId = storeVehicleId ?? 0;

  // ── Saved views & permalink ──────────────────────────────────
  const { currentQuery, apply } = useSavedViewUrl();

  // ── Selection state (URL-synced) ─────────────────────────────
  const [selectedSignals, setSelectedSignals] = useUrlArray('signals');
  const { data: availableSignals, error: signalsError } = useSignals(vehicleId);

  const toggleSignal = useCallback((name: string) => {
    setSelectedSignals((prev) => {
      if (prev.includes(name)) return prev.filter((s) => s !== name);
      if (prev.length >= MAX_SELECTED_SIGNALS) return prev;
      return [...prev, name];
    });
  }, [setSelectedSignals]);

  // ── Time range ───────────────────────────────────────────────
  const { start, end, setRange } = useRangeState({
    persistKey: 'signals-workspace.range',
    defaultPresetId: 'today',
  });
  const fromIso = useMemo(() => (start ? new Date(`${start}T00:00:00`).toISOString() : ''), [start]);
  const toIso   = useMemo(() => (end   ? new Date(`${end}T23:59:59.999`).toISOString() : ''), [end]);

  // ── Pagination ───────────────────────────────────────────────
  const [page, setPage]       = useUrlNumber('page', 1);
  const [perPage, setPerPage] = useUrlNumber('size', 25);

  // ── Mode toggles (Live / Compare are mutually exclusive) ─────
  const [isLive, setIsLive]       = useState(false);
  const [isCompare, setIsCompare] = useState(false);
  const toggleLive = useCallback(() => {
    setIsLive((prev) => {
      const next = !prev;
      if (next) setIsCompare(false);
      return next;
    });
  }, []);
  const toggleCompare = useCallback(() => {
    setIsCompare((prev) => {
      const next = !prev;
      if (next) setIsLive(false);
      return next;
    });
  }, []);

  // ── Compare-mode state ───────────────────────────────────────
  const defaultAtA = useMemo(() => toLocalDatetimeInput(new Date(Date.now() - 3600 * 1000)), []);
  const defaultAtB = useMemo(() => toLocalDatetimeInput(new Date()), []);
  const [atA, setAtA] = useUrlString('a', defaultAtA);
  const [atB, setAtB] = useUrlString('b', defaultAtB);
  const [diffSearch, setDiffSearch]           = useUrlString('q', '');
  const [diffCategoryRaw, setDiffCategoryRaw] = useUrlString('cat', '');
  const diffCategory = diffCategoryRaw || null;

  const pinContext = `signal-diff:vehicle:${vehicleId}`;
  const { data: pinnedItems = [] } = usePinned('widget', pinContext);
  const pinnedSignals = useMemo(() => {
    const set = new Set<string>();
    for (const p of pinnedItems) {
      if (p.item_id?.startsWith('signal:')) set.add(p.item_id.slice('signal:'.length));
    }
    return set;
  }, [pinnedItems]);
  const togglePin = useTogglePin('widget');

  const [diffBulkSelection, setDiffBulkSelection] = useState<string[]>([]);

  const atAIso = isoOrEmpty(atA);
  const atBIso = isoOrEmpty(atB);
  const signalsCsv = useMemo(
    () => (availableSignals && availableSignals.length > 0 ? availableSignals.join(',') : ''),
    [availableSignals],
  );
  const { data: diffResp, isLoading: diffLoading, error: diffError } = useSignalDiffServer(
    vehicleId,
    atAIso,
    atBIso,
    signalsCsv,
    { enabled: isCompare && vehicleId > 0 && Boolean(atAIso) && Boolean(atBIso) },
  );
  const diffAllRows: SignalDiffRow[] = diffResp?.data ?? [];
  const diffFilteredRows = useMemo(() => {
    let rows = diffAllRows;
    if (diffSearch.trim()) {
      const needle = diffSearch.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(needle));
    }
    if (diffCategory) {
      const cat = CATEGORY_PREFIXES.find((c) => c.id === diffCategory);
      if (cat) rows = rows.filter((r) => cat.matches(r.name));
    }
    return rows;
  }, [diffAllRows, diffSearch, diffCategory]);
  const diffFilterActive = diffSearch.trim().length > 0 || diffCategory != null;

  // ── Historical fetch (manual trigger via Run button) ─────────
  const [exploreKey, setExploreKey] = useState<number | null>(null);
  const canExplore = selectedSignals.length > 0 && !!start && !!end && vehicleId > 0;
  const handleRun = useCallback(() => {
    if (!canExplore) return;
    setPage(1);
    setExploreKey(Date.now());
  }, [canExplore, setPage]);

  const { data: historicalRows, isLoading: historicalLoading, isFetching: historicalFetching, error: historicalError } = useQuery<CombinedHistoryRow[]>({
    queryKey: ['signals-workspace-history', vehicleId, exploreKey],
    queryFn: async () => {
      const results = await Promise.all(
        selectedSignals.map((sig) =>
          request<SignalHistoryResp>(
            `/signals/${vehicleId}/${sig}/history?from=${fromIso}&to=${toIso}&limit=${perPage * 10}`,
          ),
        ),
      );
      return results
        .flatMap((resp) => adaptSignalHistoryResp(resp))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },
    enabled: !isLive && !isCompare && exploreKey !== null,
  });

  // ── Live SSE — chart + tail share one subscription ───────────
  const live = useLiveSignalStream({
    enabled: isLive,
    vehicleId: vehicleId > 0 ? vehicleId : null,
    chartSignals: selectedSignals,
    tailMax: LIVE_TAIL_MAX,
  });

  // Wipe history when switching vehicles to avoid intermixing.
  useEffect(() => {
    setExploreKey(null);
  }, [vehicleId]);

  // ── Historical chart / stats / paginated table ──────────────
  const chartData = useMemo(() => {
    if (!historicalRows?.length) return [] as Record<string, unknown>[];
    const map = new Map<string, Record<string, unknown>>();
    for (const row of historicalRows) {
      let entry = map.get(row.created_at);
      if (!entry) { entry = { timestamp: row.created_at }; map.set(row.created_at, entry); }
      entry[row.signal] = row.value_num ?? (row.value_bool === true ? 1 : row.value_bool === false ? 0 : null);
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.timestamp as string).getTime() - new Date(b.timestamp as string).getTime(),
    );
  }, [historicalRows]);

  const historicalStats = useMemo<SignalStat[]>(() => {
    if (!historicalRows?.length) return [];
    const bySignal = new Map<string, number[]>();
    for (const row of historicalRows) {
      if (row.value_num == null) continue;
      const arr = bySignal.get(row.signal) ?? [];
      arr.push(row.value_num);
      bySignal.set(row.signal, arr);
    }
    return Array.from(bySignal.entries()).map(([signal, values]) => ({
      signal,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      count: values.length,
    }));
  }, [historicalRows]);

  const tableRows = historicalRows ?? [];
  const totalTableRows = tableRows.length;
  const paginatedRows = useMemo(() => {
    const startIdx = (page - 1) * perPage;
    return tableRows.slice(startIdx, startIdx + perPage);
  }, [tableRows, page, perPage]);

  const activeChart = isLive ? live.chartData : chartData;
  const activeStats = isLive ? live.chartStats : historicalStats;

  // ── Diff bulk actions ────────────────────────────────────────
  const diffBulkActions: BulkAction[] = useMemo(
    () => [
      {
        id: 'pin',
        label: t('signalDiff.bulk.pin', 'Pin selected'),
        icon: <Pin className="h-3.5 w-3.5" />,
        onClick: async (ids) => {
          for (const id of ids) {
            const name = String(id);
            if (pinnedSignals.has(name)) continue;
            await togglePin.mutateAsync({ itemId: `signal:${name}`, context: pinContext, pin: true });
          }
        },
      },
      {
        id: 'unpin',
        label: t('signalDiff.bulk.unpin', 'Unpin selected'),
        icon: <PinOff className="h-3.5 w-3.5" />,
        onClick: async (ids) => {
          for (const id of ids) {
            const name = String(id);
            if (!pinnedSignals.has(name)) continue;
            await togglePin.mutateAsync({ itemId: `signal:${name}`, context: pinContext, pin: false });
          }
        },
      },
      {
        id: 'csv',
        label: t('signalDiff.bulk.csv', 'Copy CSV'),
        onClick: async (ids) => {
          const idSet = new Set(ids.map(String));
          const rowsToExport = diffFilteredRows.filter((r) => idSet.has(r.name));
          const csv = objectsToCSV(
            rowsToExport.map((r) => ({
              signal: r.name,
              window_a: String(r.value_a ?? ''),
              window_b: String(r.value_b ?? ''),
              source_a: String(r.source_a ?? ''),
              source_b: String(r.source_b ?? ''),
            })),
          );
          downloadCSV(`signal-diff-vehicle-${vehicleId}.csv`, csv);
        },
      },
      {
        id: 'alert',
        label: t('signalDiff.bulk.addAlert', 'Add as alert rule'),
        icon: <Bell className="h-3.5 w-3.5" />,
        onClick: async (ids) => {
          const csv = ids.map(String).join(',');
          navigate(`/alert-studio?signals=${encodeURIComponent(csv)}&from=signal-diff`);
        },
      },
    ],
    [diffFilteredRows, navigate, pinContext, pinnedSignals, togglePin, vehicleId, t],
  );

  // ── Permalink ────────────────────────────────────────────────
  const permalinkUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}?${currentQuery}`;
  }, [currentQuery]);

  const anyError = signalsError ?? historicalError ?? diffError;
  const hasHistorical = exploreKey !== null;

  return (
    <PageContainer
      title={t('signalsWorkspace.title', 'Signals')}
      subtitle={t(
        'signalsWorkspace.subtitle',
        'Browse the live catalog, inspect history, monitor live, or compare snapshots — all in one place.',
      )}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <VehicleSelect />
          {isLive ? (
            <Badge variant={live.connected ? 'success' : 'danger'} dot>
              {live.connected ? t('liveMonitor.connected', 'Connected') : t('liveMonitor.disconnected', 'Disconnected')}
            </Badge>
          ) : null}
          <SavedViewMenu route="/signals" currentQuery={currentQuery} onApply={apply} />
          {permalinkUrl ? (
            <CopyButton text={permalinkUrl} label={t('signalsWorkspace.share', 'Share')} size="sm" />
          ) : null}
        </div>
      }
    >
      {anyError ? (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      ) : null}

      {vehicleId === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          title={t('signalsWorkspace.noVehicle', 'Select a vehicle to begin')}
          message={t('signalsWorkspace.noVehicleDesc', 'Pick a vehicle from the picker above to see its signals.')}
        />
      ) : null}

      {/* ── Headline strip ─────────────────────────────────────── */}
      <FadeIn>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
          <StatCard
            label={t('signalsWorkspace.selected', 'Selected')}
            value={`${selectedSignals.length} / ${MAX_SELECTED_SIGNALS}`}
            icon={<ArrowUpDown className="h-4 w-4" />}
          />
          <StatCard
            label={t('signalsWorkspace.mode', 'Mode')}
            value={isCompare ? t('signalsWorkspace.compare', 'Compare') : isLive ? t('signalsWorkspace.live', 'Live') : t('signalsWorkspace.historical', 'Historical')}
            icon={isCompare ? <GitCompare className="h-4 w-4" /> : isLive ? <Radio className="h-4 w-4" /> : <Database className="h-4 w-4" />}
          />
          <StatCard
            label={t('signalsWorkspace.liveRate', 'Live rate')}
            value={isLive ? `${fmtInt(live.tailRate)} /s` : '—'}
            icon={<Radio className="h-4 w-4" />}
          />
          <StatCard
            label={t('signalsWorkspace.pinned', 'Pinned signals')}
            value={fmtInt(pinnedSignals.size)}
            icon={<Pin className="h-4 w-4" />}
          />
        </div>
      </FadeIn>

      {/* ── Master / detail layout ─────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Catalog left rail */}
        <div className="lg:col-span-5 order-2 lg:order-1">
          <SignalCatalogPanel
            vehicleId={vehicleId}
            title={t('signalsWorkspace.catalogTitle', 'Catalog')}
            showSummary={false}
            selection={{
              selectedSignals,
              onToggle: toggleSignal,
              max: MAX_SELECTED_SIGNALS,
            }}
            tableMaxHeight="60vh"
          />
        </div>

        {/* Workspace right column */}
        <div className="space-y-5 lg:col-span-7 order-1 lg:order-2">
          {/* Selector + toolbar */}
          <GlassPanel className="p-4 sm:p-5 space-y-4">
            <SignalSelector
              options={availableSignals ?? []}
              value={selectedSignals}
              onChange={(next) => setSelectedSignals(next.slice(0, MAX_SELECTED_SIGNALS))}
              max={MAX_SELECTED_SIGNALS}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-wrap items-end gap-2">
                {!isCompare ? (
                  <label className="space-y-1">
                    <span className="block text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                      {t('Time Range')}
                    </span>
                    <RangePicker
                      value={{ start, end }}
                      onChange={setRange}
                      presetIds={['today', 'yesterday', '7d', '30d', '90d', 'all']}
                      align="start"
                      triggerTestId="signals-workspace-range"
                    />
                  </label>
                ) : null}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {!isLive && !isCompare ? (
                  <Select
                    label={t('Per Page')}
                    value={String(perPage)}
                    onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
                    options={PER_PAGE_OPTIONS}
                    className="w-24"
                  />
                ) : null}
                {!isLive && !isCompare ? (
                  <Button
                    variant="primary"
                    icon={<Database className="h-4 w-4" />}
                    onClick={handleRun}
                    disabled={!canExplore}
                    loading={hasHistorical && historicalFetching}
                  >
                    {t('signalsWorkspace.run', 'Run')}
                  </Button>
                ) : null}
                <Button
                  variant={isLive ? 'danger' : 'outline'}
                  icon={<Radio className="h-4 w-4" />}
                  onClick={toggleLive}
                  disabled={selectedSignals.length === 0 && !isLive}
                >
                  {isLive ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                      {t('signalsWorkspace.stopLive', 'Stop live')}
                    </span>
                  ) : t('signalsWorkspace.live', 'Live')}
                </Button>
                <Button
                  variant={isCompare ? 'primary' : 'outline'}
                  icon={<GitCompare className="h-4 w-4" />}
                  onClick={toggleCompare}
                >
                  {isCompare ? t('signalsWorkspace.exitCompare', 'Exit compare') : t('signalsWorkspace.compare', 'Compare')}
                </Button>
                <HelpTooltip
                  i18nKey="help.signal.live"
                  defaultValue="Live mode streams real-time signal values via SSE. Maintains a rolling 5-minute window throttled to 2 Hz updates. Compare mode swaps in two-snapshot diff."
                  ariaLabel={t('help.signal.live.aria', { defaultValue: 'More info about live and compare modes' })}
                  placement="left"
                />
              </div>
            </div>
          </GlassPanel>

          {/* COMPARE MODE */}
          {isCompare ? (
            <>
              <SignalCompareControls
                atA={atA}
                atB={atB}
                onChangeA={setAtA}
                onChangeB={setAtB}
                search={diffSearch}
                onSearchChange={setDiffSearch}
                category={diffCategory}
                onCategoryChange={(next) => setDiffCategoryRaw(next ?? '')}
              />

              <FadeIn delay={0.05}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard label={t('signalDiff.totalChanged', 'Changed signals')} value={diffLoading ? '—' : String(diffAllRows.length)} />
                  <StatCard label={t('signalDiff.visible', 'Visible after filter')} value={diffLoading ? '—' : String(diffFilteredRows.length)} />
                  <StatCard label={t('signalDiff.pinnedCount', 'Pinned')} value={String(pinnedSignals.size)} />
                  <StatCard
                    label={t('signalDiff.windowSpan', 'Window span')}
                    value={atAIso && atBIso
                      ? `${Math.abs(new Date(atBIso).getTime() - new Date(atAIso).getTime()) / 1000} s`
                      : '—'}
                  />
                </div>
              </FadeIn>

              <BulkActionsToolbar
                selectedIds={diffBulkSelection}
                total={diffFilteredRows.length}
                onClear={() => setDiffBulkSelection([])}
                actions={diffBulkActions}
              />

              <FadeIn delay={0.1}>
                <GlassPanel className="p-4 sm:p-5">
                  {diffLoading && !diffResp ? (
                    <div className="space-y-2">
                      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={36} />)}
                    </div>
                  ) : diffAllRows.length === 0 && !diffFilterActive && atAIso && atBIso ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                      <GitCompare className="h-10 w-10 text-[var(--text-muted)] opacity-30" />
                      <p className="text-sm text-[var(--text-muted)]">
                        {t('signalDiff.noChanges', 'No signals changed between the two snapshots')}
                      </p>
                    </div>
                  ) : (
                    <SignalDiffTable
                      rows={diffFilteredRows}
                      vehicleId={vehicleId}
                      loading={false}
                      filterActive={diffFilterActive}
                      selectedSignals={diffBulkSelection}
                      onSelectionChange={setDiffBulkSelection}
                      pinnedSignals={pinnedSignals}
                    />
                  )}
                  {pinnedSignals.size > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] pt-3">
                      <span className="text-xs text-[var(--text-muted)]">
                        {t('signalDiff.pinnedLabel', 'Pinned:')}
                      </span>
                      {Array.from(pinnedSignals).sort().map((s) => (
                        <Badge key={s} variant="neutral">{s}</Badge>
                      ))}
                    </div>
                  ) : null}
                </GlassPanel>
              </FadeIn>
            </>
          ) : null}

          {/* LIVE / HISTORICAL — chart + stats + tail or history */}
          {!isCompare ? (
            <>
              {(hasHistorical || isLive) && activeStats.length > 0 ? (
                <SignalStatsPanel stats={activeStats} loading={historicalLoading && !isLive} />
              ) : null}

              {hasHistorical || isLive ? (
                <SignalChartPanel
                  selectedSignals={selectedSignals}
                  data={activeChart}
                  stats={activeStats}
                  isLive={isLive}
                  loading={historicalLoading && !isLive}
                  pointsLoaded={historicalRows?.length}
                  liveEventCount={live.chartPointCount}
                />
              ) : null}

              {isLive ? (
                <LiveSignalTail
                  entries={live.tailEntries}
                  rate={live.tailRate}
                  paused={live.tailPaused}
                  onPauseToggle={() => live.setTailPaused((p) => !p)}
                  onClear={live.clearTail}
                  bufferMax={LIVE_TAIL_MAX}
                  title={t('liveMonitor.title', 'Live tail')}
                  maxHeight="55vh"
                />
              ) : hasHistorical ? (
                <SignalHistoryTable
                  rows={paginatedRows}
                  selectedSignals={selectedSignals}
                  page={page}
                  pageSize={perPage}
                  totalRows={totalTableRows}
                  onPageChange={setPage}
                  loading={historicalLoading}
                  title={t('signalsWorkspace.historyTitle', 'Signal history')}
                />
              ) : (
                <FadeIn>
                  <GlassPanel className="p-4 sm:p-5">
                    <EmptyState
                      icon={<Database className="h-8 w-8" />}
                      title={t('signalsWorkspace.emptyTitle', 'Pick signals and run a query')}
                      message={t(
                        'signalsWorkspace.emptyDesc',
                        'Select up to 5 signals from the catalog, choose a time range, then click Run for historical data — or toggle Live to stream in real time.',
                      )}
                    />
                  </GlassPanel>
                </FadeIn>
              )}
            </>
          ) : null}

          {/* Helper footer for catalog refresh tip */}
          <div className="text-[10px] text-[var(--text-muted)] text-right">
            <RefreshCw className="inline h-3 w-3 mr-1" />
            {t('signalGap.refreshInterval', 'Catalog refreshes every 5s')}
            {selectedSignals.length === MAX_SELECTED_SIGNALS ? (
              <span className="ml-3 inline-flex items-center gap-1 text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                {t('signalsWorkspace.capReached', 'Selection cap reached — deselect to add another')}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
