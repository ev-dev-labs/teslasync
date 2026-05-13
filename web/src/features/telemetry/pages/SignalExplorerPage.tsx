/**
 * SignalExplorerPage — multi-signal explorer with chart, stats, history.
 *
 * Refactored to compose `SignalSelector`, `SignalChartPanel`,
 * `SignalStatsPanel`, `SignalHistoryTable`, and `useLiveSignalStream` so
 * the page stays in sync with the unified `/signals` workspace and
 * consolidates all SSE plumbing into one place.
 *
 * Now drives `vehicleId` from `useSelectedVehicle` instead of the
 * previous hard-coded `1`.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Activity, AlertCircle, Database, Radio } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Button, Badge, HelpTooltip, Select } from '@/components/ui';
import { EmptyState } from '@/components/feedback/EmptyState';
import { AlertBanner } from '@/components/feedback/AlertBanner';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUrlArray, useUrlNumber } from '@/hooks/useUrlState';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSignals } from '@/api/hooks/useTelemetry';
import { request } from '@/api/client';
import { getErrorMessage } from '@/lib/errorMessage';
import { adaptSignalHistoryResp, type SignalLogEntry } from '@/components/SignalQueryControls';
import type { SignalHistoryResp } from '@/api/types';

import { SignalSelector } from '../components/SignalSelector';
import { SignalChartPanel } from '../components/SignalChartPanel';
import { SignalStatsPanel } from '../components/SignalStatsPanel';
import { SignalHistoryTable } from '../components/SignalHistoryTable';
import { useLiveSignalStream, type SignalStat } from '../hooks/useLiveSignalStream';

const MAX_SIGNALS = 5;

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
  const [perPage, setPerPage] = useUrlNumber('size', 25);
  const [isLive, setIsLive] = useState(false);

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
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      ) : null}

      {vehicleId === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          title={t('signalExplorer.noVehicle', 'Select a vehicle to begin')}
          message={t('signalExplorer.noVehicleDesc', 'Pick a vehicle from the picker above to explore its signals.')}
        />
      ) : (
        <>
          <GlassPanel className="p-4 sm:p-5 space-y-4">
            <SignalSelector
              options={availableSignals ?? []}
              value={selectedSignals}
              onChange={(next) => setSelectedSignals(next.slice(0, MAX_SIGNALS))}
              max={MAX_SIGNALS}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="space-y-1">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {t('Time Range')}
                </span>
                <RangePicker
                  value={{ start, end }}
                  onChange={setRange}
                  presetIds={['today', 'yesterday', '7d', '30d', '90d', 'all']}
                  align="start"
                  triggerTestId="signal-explorer-range"
                />
              </label>
              <div className="flex flex-wrap items-end gap-3">
                {!isLive ? (
                  <Select
                    label={t('Per Page')}
                    value={String(perPage)}
                    onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
                    options={PER_PAGE_OPTIONS}
                    className="w-24"
                  />
                ) : null}
                {!isLive ? (
                  <Button
                    variant="primary"
                    icon={<Database className="h-4 w-4" />}
                    onClick={handleExplore}
                    disabled={!canExplore}
                    loading={isFetching}
                  >
                    {t('Explore')}
                  </Button>
                ) : null}
                <Button
                  variant={isLive ? 'danger' : 'outline'}
                  icon={<Radio className="h-4 w-4" />}
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

          {!hasHistorical && !isLive ? (
            <EmptyState
              icon={<Database className="h-10 w-10" />}
              title={t('Pick signals and click Explore')}
              message={t('Choose up to 5 signals, set a date range, then hit Explore — or toggle Live to stream in real time.')}
            />
          ) : (
            <>
              {activeStats.length > 0 ? (
                <SignalStatsPanel stats={activeStats} loading={historicalLoading && !isLive} />
              ) : null}

              <SignalChartPanel
                selectedSignals={selectedSignals}
                data={activeChart}
                stats={activeStats}
                isLive={isLive}
                loading={historicalLoading && !isLive}
                pointsLoaded={historicalRows?.length}
                liveEventCount={live.chartPointCount}
              />

              {!isLive && hasHistorical ? (
                <SignalHistoryTable
                  rows={paginatedRows}
                  selectedSignals={selectedSignals}
                  page={page}
                  pageSize={perPage}
                  totalRows={totalRecords}
                  onPageChange={setPage}
                  loading={historicalLoading}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}
