/**
 * SignalExplorerPage — multi-signal explorer with chart, stats, and data table.
 *
 * Select up to 5 signals, set a time range, click Explore to visualise
 * signal history with dual-axis support and paginated data tables.
 *
 * **Live Mode** — toggle to stream real-time signal values via SSE.
 * Maintains a rolling 5-minute window, throttled to 2 Hz chart updates.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { HelpTooltip } from '@/components/ui/HelpTooltip';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Pagination } from '@/components/ui/Pagination';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { AlertBanner } from '@/components/feedback/AlertBanner';
import { FadeIn } from '@/components/motion/FadeIn';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import { useUrlArray, useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { useSignals } from '@/api/hooks/useTelemetry';
import { request } from '@/api/client';
import { CHART_COLORS } from '@/lib/colors';
import { toLocalDatetimeStr } from '@/lib/dateFormat';
import { TIME_RANGE_PRESETS } from '@/lib/constants';
import { getErrorMessage } from '@/lib/errorMessage';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { Activity, BarChart3, Search, Clock, AlertCircle, Radio } from 'lucide-react';
import type { SignalLogEntry } from '@/components/SignalQueryControls';
import type { SignalHistoryResp } from '@/api/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SignalStat {
  signal: string;
  min: number;
  max: number;
  avg: number;
  count: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minute rolling window
const LIVE_THROTTLE_MS = 500;          // 2 Hz chart updates

// ─── Page component ──────────────────────────────────────────────────────────

export default function SignalExplorerPage() {
  const { t } = useTranslation();
  usePageTitle(t('Signal Explorer'));
  const vehicleId = 1;

  // Signal selection
  const { data: availableSignals, error: signalsError } = useSignals(vehicleId);
  const [selectedSignals, setSelectedSignals] = useUrlArray('signals');
  const [signalSearch, setSignalSearch] = useState('');

  // DateTime range
  const defaultFrom = useMemo(() => toLocalDatetimeStr(new Date(Date.now() - 3600_000)), []);
  const defaultTo = useMemo(() => toLocalDatetimeStr(new Date()), []);
  const [fromStr, setFromStr] = useUrlString('from', defaultFrom);
  const [toStr, setToStr] = useUrlString('to', defaultTo);

  // Explore trigger key
  const [exploreKey, setExploreKey] = useState<number | null>(null);

  // Pagination
  const [page, setPage] = useUrlNumber('page', 1);
  const [perPage, setPerPage] = useUrlNumber('size', 25);

  // ── Live mode ──
  const [isLive, setIsLive] = useState(false);
  const [liveData, setLiveData] = useState<Record<string, unknown>[]>([]);
  const [liveStats, setLiveStats] = useState<SignalStat[]>([]);
  const liveBufferRef = useRef<Record<string, unknown>[]>([]);
  const liveAccRef = useRef<Map<string, number[]>>(new Map());
  const lastFlushRef = useRef(0);
  const liveCountRef = useRef(0);

  // SSE handler for live mode — accumulates signal values, throttles chart updates
  useRealtimeEvents({
    enabled: isLive && selectedSignals.length > 0,
    onVehicleUpdate: useCallback((raw: unknown) => {
      const data = raw as { signals?: Record<string, unknown>; timestamp?: string };
      if (!data?.signals) return;
      const now = Date.now();
      const ts = data.timestamp ?? new Date().toISOString();

      // Build a data point with only selected signals
      const point: Record<string, unknown> = { timestamp: ts };
      let hasValue = false;
      for (const sig of selectedSignals) {
        const val = data.signals[sig];
        if (val !== undefined && val !== null) {
          const num = typeof val === 'number' ? val : typeof val === 'boolean' ? (val ? 1 : 0) : parseFloat(String(val));
          if (!isNaN(num)) {
            point[sig] = num;
            hasValue = true;
            // Accumulate for stats
            const arr = liveAccRef.current.get(sig) ?? [];
            arr.push(num);
            liveAccRef.current.set(sig, arr);
          }
        }
      }
      if (!hasValue) return;

      // Add to rolling buffer, trim to window
      liveBufferRef.current.push(point);
      liveCountRef.current++;
      const cutoff = new Date(now - LIVE_WINDOW_MS).toISOString();
      while (liveBufferRef.current.length > 0 && (liveBufferRef.current[0].timestamp as string) < cutoff) {
        liveBufferRef.current.shift();
      }

      // Throttle React state updates
      if (now - lastFlushRef.current >= LIVE_THROTTLE_MS) {
        lastFlushRef.current = now;
        setLiveData([...liveBufferRef.current]);
        // Compute live stats
        const stats: SignalStat[] = [];
        for (const [signal, values] of liveAccRef.current) {
          if (values.length === 0) continue;
          stats.push({
            signal,
            min: Math.min(...values),
            max: Math.max(...values),
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            count: values.length,
          });
        }
        setLiveStats(stats);
      }
    }, [selectedSignals]),
  });

  // Reset live buffers when toggling off or changing signals
  useEffect(() => {
    if (!isLive) {
      liveBufferRef.current = [];
      liveAccRef.current = new Map();
      liveCountRef.current = 0;
      setLiveData([]);
      setLiveStats([]);
    }
  }, [isLive, selectedSignals]);

  const applyPreset = useCallback((hours: number) => {
    const end = new Date();
    setFromStr(toLocalDatetimeStr(new Date(end.getTime() - hours * 3600_000)));
    setToStr(toLocalDatetimeStr(end));
  }, []);

  const canExplore = selectedSignals.length > 0 && fromStr && toStr;

  const handleExplore = useCallback(() => {
    if (!canExplore) return;
    setPage(1);
    setExploreKey(Date.now());
  }, [canExplore]);

  const toggleSignal = useCallback((sig: string) => {
    setSelectedSignals(prev =>
      prev.includes(sig) ? prev.filter(s => s !== sig) : prev.length < 5 ? [...prev, sig] : prev,
    );
  }, []);

  const fromIso = fromStr ? new Date(fromStr).toISOString() : '';
  const toIso = toStr ? new Date(toStr).toISOString() : '';

  // ── Combined signal data query (parallel per-signal fetches) ──
  const { data: allSignalRows, isLoading: dataLoading, error: dataError } = useQuery<SignalLogEntry[]>({
    queryKey: ['explorer-data', exploreKey],
    queryFn: async () => {
      const results = await Promise.all(
        selectedSignals.map(sig =>
          request<SignalHistoryResp>(
            `/signals/${vehicleId}/${sig}/history?from=${fromIso}&to=${toIso}&limit=1000`,
          ),
        ),
      );
      return results.flatMap((resp) =>
        (resp?.data ?? []).map(row => ({
          created_at: row.created_at,
          signal: resp?.signal ?? '',
          value_num: row.value_num ?? null,
          value_str: row.value_str ?? null,
          value_bool: row.value_bool ?? null,
        })),
      );
    },
    enabled: exploreKey !== null,
  });

  const hasData = exploreKey !== null;
  const anyError = [signalsError, dataError].find(Boolean);

  // ── Chart data transform ──
  const chartData = useMemo(() => {
    if (!allSignalRows?.length) return [];
    const map = new Map<string, Record<string, unknown>>();
    for (const row of allSignalRows) {
      const ts = row.created_at;
      let entry = map.get(ts);
      if (!entry) { entry = { timestamp: ts }; map.set(ts, entry); }
      entry[row.signal] = row.value_num ?? (row.value_bool === true ? 1 : row.value_bool === false ? 0 : null);
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.timestamp as string).getTime() - new Date(b.timestamp as string).getTime(),
    );
  }, [allSignalRows]);

  // ── Stats computed from data ──
  const statsData = useMemo((): SignalStat[] => {
    if (!allSignalRows?.length) return [];
    const bySignal = new Map<string, number[]>();
    for (const row of allSignalRows) {
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
  }, [allSignalRows]);

  // ── Table data (client-side pagination) ──
  const tableRows = allSignalRows ?? [];
  const totalTableRows = tableRows.length;
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * perPage;
    return tableRows.slice(start, start + perPage);
  }, [tableRows, page, perPage]);

  // Dual Y-axis when scales differ significantly
  const activeStats = isLive ? liveStats : statsData;
  const activeChart = isLive ? liveData : chartData;
  const useRightAxis = useMemo(() => {
    if (!activeStats || activeStats.length < 2) return false;
    const ranges = activeStats.map(s => Math.abs(s.max - s.min) || 1);
    return ranges[0] / ranges[1] > 10 || ranges[1] / ranges[0] > 10;
  }, [activeStats]);

  // Signal search filter
  const filteredSignals = useMemo(() => {
    if (!availableSignals) return [];
    if (!signalSearch) return availableSignals;
    const q = signalSearch.toLowerCase();
    return availableSignals.filter(s => s.toLowerCase().includes(q));
  }, [availableSignals, signalSearch]);

  // Table columns
  const tableColumns: Column<SignalLogEntry>[] = useMemo(() => [
    { key: 'time', header: t('Time'), render: (r) => <span className="whitespace-nowrap text-xs text-[var(--text-muted)]">{new Date(r.created_at).toLocaleString()}</span> },
    { key: 'signal', header: t('Signal'), render: (r) => <span className="font-mono text-xs text-cyan-300">{r.signal}</span> },
    { key: 'value', header: t('Value'), render: (r) => <span className="font-mono text-xs text-[var(--text-primary)]">{r.value_num ?? r.value_str ?? String(r.value_bool ?? '')}</span> },
  ], [t]);

  return (
    <PageContainer
      title={t('Signal Explorer')}
      subtitle={isLive
        ? t('Live streaming — real-time signal values via SSE')
        : t('Explore signal history — multi-signal charts, stats & data')
      }
      loading={false}
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* ── Controls ──────────────────────────────────────────────── */}
      <GlassPanel className="p-4 sm:p-5 space-y-4">
        {/* Signal picker */}
        <div>
          <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider mb-2 text-[var(--text-muted)]">
            {t('Signals')} ({selectedSignals.length}/5)
            <HelpTooltip
              i18nKey="help.signal.layers"
              defaultValue="TeslaSync exposes three live-state layers: L1 (in-process), L2 (Redis shared), and log (TimescaleDB history)."
              ariaLabel={t('help.signal.layers.aria', { defaultValue: 'More info about signal layers (L1, L2, log)' })}
              placement="bottom"
            />
          </span>
          <div className="flex items-center gap-2 mb-2">
            <Input
              icon={<Search className="h-3.5 w-3.5" />}
              placeholder={t('Search signals…')}
              value={signalSearch}
              onChange={e => setSignalSearch(e.target.value)}
              className="flex-1"
            />
          </div>
          {selectedSignals.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedSignals.map((sig, i) => (
                <Badge
                  key={sig}
                  variant="info"
                  size="sm"
                  className="cursor-pointer"
                  style={{ borderColor: CHART_COLORS[i % CHART_COLORS.length], color: CHART_COLORS[i % CHART_COLORS.length] }}
                  onClick={() => toggleSignal(sig)}
                >
                  {sig} ×
                </Badge>
              ))}
            </div>
          )}
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filteredSignals.slice(0, 100).map(sig => (
              <Button
                key={sig}
                size="sm"
                variant={selectedSignals.includes(sig) ? 'primary' : 'ghost'}
                onClick={() => toggleSignal(sig)}
                className="w-full text-left text-xs font-mono truncate justify-start"
              >
                {sig}
              </Button>
            ))}
          </div>
        </div>

        {/* DateTime range — hidden in live mode */}
        {!isLive && (
        <div>
          <span className="block text-xs font-medium uppercase tracking-wider mb-2 text-[var(--text-muted)]">
            <Clock className="inline h-3 w-3 mr-1" />{t('Time Range')}
          </span>
          <div className="flex flex-wrap gap-2 mb-2">
            {TIME_RANGE_PRESETS.map(p => (
              <Button key={p.label} size="sm" variant="ghost" onClick={() => applyPreset(p.hours)}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label={t('From')} type="datetime-local" value={fromStr} onChange={e => setFromStr(e.target.value)} />
            <Input label={t('To')} type="datetime-local" value={toStr} onChange={e => setToStr(e.target.value)} />
          </div>
        </div>
        )}

        {/* Query controls */}
        <div className="flex items-end gap-3 justify-end">
          <Select
            label={t('Per Page')}
            value={String(perPage)}
            onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}
            options={[
              { value: '25', label: '25' },
              { value: '50', label: '50' },
              { value: '100', label: '100' },
              { value: '500', label: '500' },
            ]}
            className="w-24"
          />
          <Button
            variant="primary"
            icon={<Activity className="h-4 w-4" />}
            onClick={handleExplore}
            disabled={!canExplore || isLive}
            loading={hasData && dataLoading}
          >
            {t('Explore')}
          </Button>
          <Button
            variant={isLive ? 'danger' : 'outline'}
            icon={<Radio className="h-4 w-4" />}
            onClick={() => setIsLive(prev => !prev)}
            disabled={selectedSignals.length === 0}
          >
            {isLive ? (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                {t('Stop Live')}
              </span>
            ) : t('Live')}
          </Button>
          <HelpTooltip
            i18nKey="help.signal.live"
            defaultValue="Live mode streams real-time signal values via SSE. Maintains a rolling 5-minute window throttled to 2 Hz updates."
            ariaLabel={t('help.signal.live.aria', { defaultValue: 'More info about live signal streaming' })}
            placement="left"
          />
        </div>
      </GlassPanel>

      {/* ── Content ───────────────────────────────────────────────── */}
      {!hasData && !isLive ? (
        <GlassPanel className="p-4">
          <EmptyState
            icon={<Activity className="h-10 w-10" />}
            title={t('Select signals and click Explore')}
            message={t('Choose up to 5 signals, set a time range, and click Explore — or toggle Live for real-time streaming.')}
          />
        </GlassPanel>
      ) : (
        <div className="space-y-5">
          {/* ── Chart ─────────────────────────────────────────────── */}
          <FadeIn>
            <GlassPanel className="p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                {isLive ? (
                  <Radio className="h-4 w-4 text-red-500 animate-pulse" />
                ) : (
                  <BarChart3 className="h-4 w-4 text-neon-cyan" />
                )}
                <span className="section-title">
                  {isLive ? t('Live Signal Stream') : t('Signal Chart')}
                </span>
                {isLive ? (
                  <span className="ml-auto flex items-center gap-1.5 text-[10px] text-red-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                    {fmtInt(liveCountRef.current)} {t('events')} · {fmtInt(liveData.length)} {t('points')}
                  </span>
                ) : activeChart.length > 0 && (
                  <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                    {fmtInt((allSignalRows ?? []).length)} {t('points loaded')}
                  </span>
                )}
              </div>

              {dataLoading && !isLive ? (
                <Skeleton className="h-[350px] w-full" />
              ) : activeChart.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={activeChart} margin={{ top: 10, right: useRightAxis ? 20 : 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis
                      dataKey="timestamp"
                      tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      tickFormatter={(v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    />
                    <YAxis yAxisId="left" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    {useRightAxis && (
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    )}
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, cursor: 'pointer' }} iconType="circle" />
                    {selectedSignals.map((sig, i) => (
                      <Line
                        key={sig}
                        type="monotone"
                        dataKey={sig}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        strokeWidth={1.5}
                        dot={false}
                        name={sig}
                        yAxisId={useRightAxis && i === 1 ? 'right' : 'left'}
                        connectNulls
                        isAnimationActive={!isLive}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : isLive ? (
                <div className="h-[350px] flex items-center justify-center">
                  <span className="text-[var(--text-muted)] flex items-center gap-2">
                    <Radio className="h-4 w-4 animate-pulse text-red-500" />
                    {t('Waiting for signal data…')}
                  </span>
                </div>
              ) : (
                <div className="h-[350px] flex items-center justify-center">
                  <span className="text-[var(--text-muted)]">{t('No data for this time range')}</span>
                </div>
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── Stats summary ─────────────────────────────────────── */}
          <FadeIn>
            <GlassPanel className="p-4 sm:p-5">
              <span className="section-title mb-3 block">{t('Stats Summary')}</span>
              {dataLoading && !isLive ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
                </div>
              ) : activeStats && activeStats.length > 0 ? (
                <DataTable
                  columns={[
                    { key: 'signal', header: t('Signal'), render: (s) => <span className="font-mono font-semibold" style={{ color: CHART_COLORS[activeStats.indexOf(s) % CHART_COLORS.length] }}>{s.signal}</span> },
                    { key: 'min', header: t('Min'), render: (s) => <span className="font-mono text-[var(--text-secondary)]">{fmtNumber(s.min)}</span> },
                    { key: 'max', header: t('Max'), render: (s) => <span className="font-mono text-[var(--text-secondary)]">{fmtNumber(s.max)}</span> },
                    { key: 'avg', header: t('Avg'), render: (s) => <span className="font-mono text-[var(--text-primary)]">{fmtNumber(s.avg)}</span> },
                    { key: 'count', header: t('Count'), render: (s) => <span className="font-mono text-[var(--text-muted)]">{fmtInt(s.count)}</span> },
                  ] satisfies Column<SignalStat>[]}
                  data={statsData}
                  keyExtractor={(s) => s.signal}
                  compact
                  pagination={{ defaultPageSize: 50 }}
                />
              ) : (
                <span className="text-xs text-[var(--text-muted)]">{t('No stats available')}</span>
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── Data table ─────────────────────────────────────────── */}
          <FadeIn>
            <GlassPanel className="p-4 sm:p-5">
              <span className="section-title mb-3 block">{t('Signal Data')}</span>
              {dataLoading ? (
                <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8" />)}</div>
              ) : paginatedRows.length > 0 ? (
                <>
                  <DataTable
                    columns={tableColumns}
                    data={paginatedRows}
                    keyExtractor={(r) => `${r.created_at}-${r.signal}`}
                    compact
                    pagination={{ defaultPageSize: 50 }}
                  />
                  <Pagination
                    page={page}
                    pageSize={perPage}
                    total={totalTableRows}
                    onPageChange={setPage}
                  />
                </>
              ) : (
                <EmptyState
                  icon={<Activity className="h-8 w-8" />}
                  title={t('No data')}
                  message={t('No signal data found for this time range.')}
                />
              )}
            </GlassPanel>
          </FadeIn>
        </div>
      )}
    </PageContainer>
  );
}
