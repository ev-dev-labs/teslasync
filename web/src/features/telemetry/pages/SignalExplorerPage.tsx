/**
 * SignalExplorerPage — multi-signal explorer with chart, stats, history.
 *
 * Composes `SignalSelector`, `SignalChartPanel`, `SignalStatsPanel`,
 * `SignalHistoryTable`, and `useLiveSignalStream` so the page stays in sync
 * with the unified `/signals` workspace and consolidates all SSE plumbing
 * into one place.
 *
 * Modern-UI: full-width responsive bento. A KPI summary band leads, then the
 * controls panel, the opt-in AI filter, then a results bento with the signal
 * chart as the hero (spanning two columns on wide screens), the stats summary
 * beside it, and the history table as a full-width detail band. Every data
 * section owns its loading / empty / error state — nothing is gated behind a
 * single guard, and the layout reflows to more columns on wide monitors.
 *
 * Drives `vehicleId` from `useSelectedVehicle` instead of a hard-coded `1`.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Activity, AlertCircle, Clock, Database, Radio } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, Badge, HelpTooltip, Select, Label } from '@/components/ui';
import { EmptyState, AlertBanner } from '@/components/feedback';
import { MetricCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUrlArray, useUrlNumber, useUrlBatch, type UrlBatchUpdate } from '@/hooks/useUrlState';
import { useRangeState } from '@/hooks/useRangeState';
import { getDatePreset, resolveAllTimeStart } from '@/lib/datePresets';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSignals } from '@/api/hooks/useTelemetry';
import { request } from '@/api/client';
import { getErrorMessage } from '@/lib/errorMessage';
import { fmtInt } from '@/lib/numberFormat';
import { adaptSignalHistoryResp, type SignalLogEntry } from '@/components/SignalQueryControls';
import type { SignalHistoryResp } from '@/api/types';

import { SignalSelector } from '../components/SignalSelector';
import { SignalChartPanel } from '../components/SignalChartPanel';
import { SignalStatsPanel } from '../components/SignalStatsPanel';
import { SignalHistoryTable } from '../components/SignalHistoryTable';
import { useLiveSignalStream, type SignalStat } from '../hooks/useLiveSignalStream';
import {
  AISignalExplorerNlFilter,
  type SignalFilterDraft,
} from '@/components/ai/AISignalExplorerNlFilter';

const MAX_SIGNALS = 5;
const DEFAULT_PER_PAGE = 25;

const PER_PAGE_OPTIONS = [
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '500', label: '500' },
];

export default function SignalExplorerPage() {
  const { t } = useTranslation();
  usePageTitle(t('Signal Explorer'));

  const { vehicleId: storeVehicleId } = useSelectedVehicle();
  const vehicleId = storeVehicleId ?? 0;

  const { data: availableSignals, error: signalsError } = useSignals(vehicleId);
  const [selectedSignals, setSelectedSignals] = useUrlArray('signals');

  const { start, end, setRange } = useRangeState({
    persistKey: 'signal-explorer.range',
    defaultPresetId: 'today',
  });

  const [exploreKey, setExploreKey] = useState<number | null>(null);
  const [page, setPage] = useUrlNumber('page', 1);
  const [perPage] = useUrlNumber('size', DEFAULT_PER_PAGE);
  const [isLive, setIsLive] = useState(false);
  const setUrlBatch = useUrlBatch();

  const fromIso = useMemo(
    () => (start ? new Date(`${start}T00:00:00`).toISOString() : ''),
    [start],
  );
  const toIso = useMemo(
    () => (end ? new Date(`${end}T23:59:59.999`).toISOString() : ''),
    [end],
  );

  const canExplore = selectedSignals.length > 0 && !!start && !!end && vehicleId > 0;
  const handleExplore = useCallback(() => {
    if (!canExplore) return;
    setIsLive(false);
    setPage(1);
    setExploreKey(Date.now());
  }, [canExplore, setPage]);

  const toggleLive = useCallback(() => {
    setIsLive((prev) => !prev);
  }, []);

  // Wipe history when switching vehicles to avoid intermixing.
  useEffect(() => {
    setExploreKey(null);
  }, [vehicleId]);

  const { data: historicalRows, isLoading: historicalLoading, isFetching, error: historicalError } = useQuery<SignalLogEntry[]>({
    queryKey: ['signal-explorer', vehicleId, exploreKey],
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
    enabled: !isLive && exploreKey !== null,
  });

  const live = useLiveSignalStream({
    enabled: isLive,
    vehicleId: vehicleId > 0 ? vehicleId : null,
    chartSignals: selectedSignals,
    tailMax: 0,
  });

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

  const totalRecords = (historicalRows ?? []).length;
  const paginatedRows = useMemo(() => {
    const startIdx = (page - 1) * perPage;
    return (historicalRows ?? []).slice(startIdx, startIdx + perPage);
  }, [historicalRows, page, perPage]);

  const activeChart = isLive ? live.chartData : chartData;
  const activeStats = isLive ? live.chartStats : historicalStats;
  const hasHistorical = exploreKey !== null;
  const anyError = (signalsError ?? historicalError) as Error | undefined;

  // Inclusive day span for the KPI band — mirrors the historical query window.
  const rangeDays = useMemo(() => {
    if (!start || !end) return 0;
    const s = new Date(`${start}T00:00:00`).getTime();
    const e = new Date(`${end}T00:00:00`).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) return 0;
    return Math.max(1, Math.round((e - s) / 86_400_000) + 1);
  }, [start, end]);

  // KPI-band derivations — null-safe scalars valid in both historical & live modes.
  const pointCount = isLive ? live.chartPointCount : totalRecords;
  const statSignalCount = activeStats.length;
  const statusLabel = isLive
    ? live.connected
      ? t('signalExplorer.status.streaming', 'Streaming')
      : t('signalExplorer.status.disconnected', 'Disconnected')
    : hasHistorical
      ? t('signalExplorer.status.historical', 'Historical')
      : t('signalExplorer.status.idle', 'Idle');

  // Wires the optional AI natural-language filter into deterministic page state.
  // The AI section is opt-in and absent in off mode. The LLM never writes; this
  // callback runs only when the user clicks "Apply to filters" on a typed proposal.
  const handleApplyAiDraft = useCallback(
    (draft: SignalFilterDraft) => {
      // Apply every field the AI proposed in a SINGLE navigation. Firing the
      // individual useUrl* setters back-to-back would clobber all but the last
      // — react-router v6 hands each setter the same pre-handler searchParams
      // snapshot, so the second navigate(replace) discards the first (see
      // useUrlBatch). Batching keeps signals + range + page size atomic so an
      // applied draft never lands half-populated.
      const updates: UrlBatchUpdate = {};

      const nextSignals = draft.signals
        .filter((s) => typeof s === 'string' && s.length > 0)
        .slice(0, MAX_SIGNALS);
      if (nextSignals.length > 0) updates.signals = nextSignals.join(',');

      if (draft.range_preset) {
        const preset = getDatePreset(draft.range_preset);
        if (preset) {
          const resolved =
            preset.id === 'all'
              ? { start: resolveAllTimeStart(), end: preset.resolve().end }
              : preset.resolve();
          updates.from = resolved.start;
          updates.to = resolved.end;
        }
      }

      if (draft.per_page > 0) {
        updates.size = draft.per_page === DEFAULT_PER_PAGE ? null : String(draft.per_page);
        updates.page = null;
      }

      if (Object.keys(updates).length > 0) setUrlBatch(updates);
    },
    [setUrlBatch],
  );

  return (
    <PageContainer
      title={t('Signal Explorer')}
      subtitle={t('Visualise signal history with chart and stats — or stream live')}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <VehicleSelect />
          {isLive ? (
            <Badge variant={live.connected ? 'success' : 'danger'} dot>
              {live.connected ? t('liveMonitor.connected', 'Connected') : t('liveMonitor.disconnected', 'Disconnected')}
            </Badge>
          ) : null}
        </div>
      }
    >
      {anyError ? (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" aria-hidden="true" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      ) : null}

      {vehicleId === 0 ? (
        // no-action: vehicle picker is in the page header; no inline CTA needed.
        <GlassPanel className="p-4 sm:p-5">
          <EmptyState
            icon={<Activity className="h-8 w-8" aria-hidden="true" />}
            title={t('signalExplorer.noVehicle', 'Select a vehicle to begin')}
            message={t('signalExplorer.noVehicleDesc', 'Pick a vehicle from the picker above to explore its signals.')}
          />
        </GlassPanel>
      ) : (
        <>
          {/* 1 — KPI band: full-width responsive summary of the current exploration */}
          <FadeIn>
            <section
              aria-label={t('signalExplorer.kpis', 'Exploration summary')}
              className="grid grid-cols-2 gap-4 lg:grid-cols-4"
            >
              <MetricCard
                label={t('signalExplorer.kpi.signals', 'Signals')}
                value={selectedSignals.length}
                subtitle={t('signalExplorer.kpi.ofMax', 'of {{max}} max', { max: MAX_SIGNALS })}
                icon={<Activity className="h-5 w-5" aria-hidden="true" />}
                color="cyan"
              />
              <MetricCard
                label={isLive ? t('signalExplorer.kpi.liveEvents', 'Live Events') : t('signalExplorer.kpi.records', 'Records')}
                value={fmtInt(pointCount)}
                subtitle={isLive ? t('signalExplorer.kpi.streaming', 'Streaming') : t('signalExplorer.kpi.loaded', 'Loaded')}
                icon={<Database className="h-5 w-5" aria-hidden="true" />}
                color="purple"
              />
              <MetricCard
                label={t('signalExplorer.kpi.timeSpan', 'Time Span')}
                value={
                  isLive
                    ? t('signalExplorer.kpi.live', 'Live')
                    : rangeDays > 0
                      ? t('signalExplorer.kpi.days', '{{count}}d', { count: rangeDays })
                      : '—'
                }
                subtitle={
                  isLive
                    ? t('signalExplorer.kpi.rollingWindow', '5-min window')
                    : start && end
                      ? `${start} → ${end}`
                      : t('signalExplorer.kpi.noRange', 'No range set')
                }
                icon={<Clock className="h-5 w-5" aria-hidden="true" />}
                color="amber"
              />
              <MetricCard
                label={t('signalExplorer.kpi.status', 'Status')}
                value={statusLabel}
                subtitle={t('signalExplorer.kpi.withStats', '{{count}} with stats', { count: statSignalCount })}
                icon={<Radio className="h-5 w-5" aria-hidden="true" />}
                color={isLive ? (live.connected ? 'green' : 'red') : hasHistorical ? 'cyan' : 'amber'}
              />
            </section>
          </FadeIn>

          {/* 2 — Controls: signal picker, time range, per-page, explore / live */}
          <FadeIn delay={0.05}>
            <GlassPanel className="p-4 sm:p-5 space-y-4">
              <SignalSelector
                options={availableSignals ?? []}
                value={selectedSignals}
                onChange={(next) => setSelectedSignals(next.slice(0, MAX_SIGNALS))}
                max={MAX_SIGNALS}
              />

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1.5">
                  <Label className="block">{t('Time Range')}</Label>
                  <RangePicker
                    value={{ start, end }}
                    onChange={setRange}
                    presetIds={['today', 'yesterday', '7d', '30d', '90d', 'all']}
                    align="start"
                    triggerTestId="signal-explorer-range"
                  />
                </div>
                <div className="flex flex-wrap items-end gap-2 sm:gap-3">
                  {!isLive ? (
                    <Select
                      label={t('Per Page')}
                      value={String(perPage)}
                      onChange={(e) => {
                        // Atomic update — resetting to page 1 alongside the new
                        // size in ONE navigation. Two separate useUrlNumber
                        // setters here would clobber each other (react-router
                        // v6 snapshot semantics), silently dropping the size
                        // change so the dropdown appeared to do nothing.
                        const nextSize = Number(e.target.value);
                        setUrlBatch({
                          size: nextSize === DEFAULT_PER_PAGE ? null : String(nextSize),
                          page: null,
                        });
                      }}
                      options={PER_PAGE_OPTIONS}
                      className="w-24"
                    />
                  ) : null}
                  {!isLive ? (
                    <Button
                      variant="primary"
                      icon={<Database className="h-4 w-4" aria-hidden="true" />}
                      onClick={handleExplore}
                      disabled={!canExplore}
                      loading={isFetching}
                    >
                      {t('Explore')}
                    </Button>
                  ) : null}
                  <Button
                    variant={isLive ? 'danger' : 'outline'}
                    icon={<Radio className="h-4 w-4" aria-hidden="true" />}
                    onClick={toggleLive}
                    disabled={selectedSignals.length === 0 && !isLive}
                  >
                    {isLive ? t('signalExplorer.stopLive', 'Stop live') : t('signalExplorer.live', 'Live')}
                  </Button>
                  <HelpTooltip
                    i18nKey="help.signal.live"
                    defaultValue="Live mode streams real-time signal values via SSE. Maintains a rolling 5-minute window throttled to 2 Hz updates."
                    ariaLabel={t('help.signal.live.aria', { defaultValue: 'More info about live signal streaming' })}
                    placement="left"
                  />
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* 3 — Optional AI natural-language filter (self-hides when ai_mode='off') */}
          <AISignalExplorerNlFilter
            vehicleId={vehicleId}
            onApply={handleApplyAiDraft}
          />

          {/* 4 — Results: guidance until a query runs, then the chart / stats / history bento */}
          {!hasHistorical && !isLive ? (
            // no-action: signal picker, range, and Explore/Live controls are directly above this state.
            <FadeIn delay={0.1}>
              <GlassPanel className="p-4 sm:p-5">
                <EmptyState
                  icon={<Database className="h-10 w-10" aria-hidden="true" />}
                  title={t('Pick signals and click Explore')}
                  message={t('Choose up to 5 signals, set a date range, then hit Explore — or toggle Live to stream in real time.')}
                />
              </GlassPanel>
            </FadeIn>
          ) : (
            <section
              aria-label={t('signalExplorer.results', 'Results')}
              className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
            >
              {/* Hero — the multi-signal chart spans two of three columns on wide screens. */}
              <div className="xl:col-span-2">
                <SignalChartPanel
                  selectedSignals={selectedSignals}
                  data={activeChart}
                  stats={activeStats}
                  isLive={isLive}
                  loading={historicalLoading && !isLive}
                  pointsLoaded={historicalRows?.length}
                  liveEventCount={live.chartPointCount}
                />
              </div>

              {/* Context — per-signal min/max/avg/count summary beside the chart. */}
              <div className="xl:col-span-1">
                <SignalStatsPanel
                  stats={activeStats}
                  selectedSignals={selectedSignals}
                  loading={historicalLoading && !isLive}
                />
              </div>

              {/* Detail — full-width history band (historical mode only; live is a rolling window). */}
              {!isLive && hasHistorical ? (
                <div className="xl:col-span-3">
                  <SignalHistoryTable
                    rows={paginatedRows}
                    selectedSignals={selectedSignals}
                    page={page}
                    pageSize={perPage}
                    totalRows={totalRecords}
                    onPageChange={setPage}
                    loading={historicalLoading}
                  />
                </div>
              ) : null}
            </section>
          )}
        </>
      )}
    </PageContainer>
  );
}
