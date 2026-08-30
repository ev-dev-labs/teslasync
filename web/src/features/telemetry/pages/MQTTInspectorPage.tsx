import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Radio, Wifi, WifiOff, RefreshCw, AlertTriangle, AlertCircle,
  Activity, Layers, Gauge, Server, Clock,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, DataTable, PanelTitle, Text, Caption, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  ChartTooltip, ChartGradient,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  EmbeddedChart,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { AIMqttSseInspectorExplanations } from '@/components/ai/AIMqttSseInspectorExplanations';
import { useMQTTStatus } from '@/api/hooks/useTelemetry';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import type { VehicleTelemetry } from '@/types/telemetry';

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const STALE_THRESHOLD = 120;

/** Color-blind-safe cyan from the shared series palette (chartTokens.series[5]). */
const THROUGHPUT_COLOR = chartTokens.series[5];

interface ThroughputPoint {
  time: string;
  signals: number;
}

function formatUptime(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${fmtInt((seconds % 3600) / 60)}m`;
}

/**
 * A vehicle is "stale" when it has never reported (`lastReceived` missing) or
 * its last signal is older than {@link STALE_THRESHOLD} seconds. Single source
 * of truth shared by the per-row status Badge and the header "N stale" count so
 * the two can never disagree.
 */
function isVehicleStale(v: VehicleTelemetry): boolean {
  if (!v.lastReceived) return true;
  return (Date.now() - new Date(v.lastReceived).getTime()) / 1000 > STALE_THRESHOLD;
}

/* ------------------------------------------------------------------ */
/*  Vehicle table columns                                              */
/* ------------------------------------------------------------------ */

function buildVehicleColumns(
  t: (key: string, fallback: string) => string,
  formatRelative: (value: string | Date | null | undefined) => string,
): Column<VehicleTelemetry>[] {
  return [
    {
      key: 'vin',
      header: t('mqtt.vin', 'VIN'),
      render: (v) => <Text as="span" mono color="primary">{v.vin}</Text>,
    },
    {
      key: 'state',
      header: t('mqtt.state', 'State'),
      render: (v) => v.state
        ? <Badge variant={v.state === 'online' ? 'success' : 'neutral'} size="sm">{v.state}</Badge>
        : <Text as="span" color="muted">—</Text>,
    },
    {
      key: 'signals',
      header: t('mqtt.signals', 'Signals'),
      className: 'text-right',
      render: (v) => <Text as="span" mono color="secondary">{fmtInt(v.signalCount ?? 0)}</Text>,
    },
    {
      key: 'batches',
      header: t('mqtt.batches', 'Batches'),
      className: 'text-right',
      render: (v) => <Text as="span" mono color="secondary">{fmtInt(v.batchCount ?? 0)}</Text>,
    },
    {
      key: 'sigPerSec',
      header: t('mqtt.sigPerSec', 'Sig/sec'),
      className: 'text-right',
      render: (v) => <Text as="span" mono color="secondary">{v.signalsPerSecond != null ? fmtNumber(v.signalsPerSecond) : '—'}</Text>,
    },
    {
      key: 'lastReceived',
      header: t('mqtt.lastReceived', 'Last Received'),
      className: 'text-right',
      render: (v) => <Text as="span" color="muted" className="whitespace-nowrap">{v.lastReceived ? formatRelative(v.lastReceived) : '—'}</Text>,
    },
    {
      key: 'status',
      header: t('mqtt.status', 'Status'),
      className: 'text-center',
      render: (v) => {
        const isStale = isVehicleStale(v);
        return <Badge variant={isStale ? 'warning' : 'success'} size="sm" dot>{isStale ? t('mqtt.stale', 'Stale') : t('mqtt.live', 'Live')}</Badge>;
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function MQTTInspectorPage() {
  const { t } = useTranslation();
  const { formatTime, formatRelative } = useDateFormat();
  usePageTitle(t('mqtt.title', 'MQTT Inspector'));

  const { data: status, isLoading, error } = useMQTTStatus();

  /* ---- derived totals ---- */
  const vehicles: VehicleTelemetry[] = Array.isArray(status?.vehicles) ? status.vehicles : [];
  const totalSignals = vehicles.reduce((sum, v) => sum + (v.signalCount ?? 0), 0);
  const totalBatches = vehicles.reduce((sum, v) => sum + (v.batchCount ?? 0), 0);
  const totalRate = vehicles.reduce((sum, v) => sum + (v.signalsPerSecond ?? 0), 0);
  const topics = Array.isArray(status?.topics) ? status.topics : [];

  /* ---- throughput history (local UI-derived series, not a data fetch) ---- */
  const [throughputHistory, setThroughputHistory] = useState<ThroughputPoint[]>([]);
  const prevTotalRef = useRef<number | null>(null);
  const throughputChartRows = useMemo(
    () => throughputHistory.map(({ time, signals }) => ({ time, signals })),
    [throughputHistory],
  );

  useEffect(() => {
    if (totalSignals === 0 && prevTotalRef.current === null) return;
    const delta = prevTotalRef.current !== null ? totalSignals - prevTotalRef.current : 0;
    prevTotalRef.current = totalSignals;
    if (delta >= 0) {
      const now = formatTime(new Date());
      setThroughputHistory((prev) => [...prev, { time: now, signals: Math.max(delta, 0) }].slice(-60));
    }
  }, [totalSignals, formatTime]);

  const staleVehicles = useMemo(() => vehicles.filter(isVehicleStale), [vehicles]);

  const vehicleColumns = useMemo(() => buildVehicleColumns(t, formatRelative), [t, formatRelative]);

  // AI explainer window: derive (from_unix, to_unix) from the current time so
  // the in-scope window covers the most recent 30 minutes of broker activity.
  // Recomputed once per mount — a deliberate choice so the body reference stays
  // stable between renders (the AI advisor's useAiStream hook depends on body
  // identity). Operators who want a different window refresh the page.
  const aiWindow = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return { fromUnix: now - 30 * 60, toUnix: now };
  }, []);

  const connected = status?.connected ?? false;

  return (
    <PageContainer
      title={t('mqtt.title', 'MQTT Inspector')}
      subtitle={t('mqtt.subtitle', 'MQTT connection status and streaming telemetry')}
      actions={
        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end sm:gap-3">
          <Caption className="inline-flex items-center gap-1">
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            {t('mqtt.refreshInterval', 'Refreshes every 5s')}
          </Caption>
          <Badge variant={connected ? 'success' : 'danger'} dot>
            {connected
              ? <><Wifi className="h-3 w-3" aria-hidden="true" /> {t('mqtt.connected', 'Connected')}</>
              : <><WifiOff className="h-3 w-3" aria-hidden="true" /> {t('mqtt.disconnected', 'Disconnected')}</>}
          </Badge>
        </div>
      }
    >
      {error && (
        <FadeIn>
          <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" aria-hidden="true" />}>
            {t('mqtt.fetchError', 'Unable to load MQTT status')}: {(error as Error)?.message ?? String(error)}
          </AlertBanner>
        </FadeIn>
      )}

      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('mqtt.metrics', 'Stream metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <MetricCard
            label={t('mqtt.streamingVehicles', 'Streaming Vehicles')}
            value={isLoading ? '—' : vehicles.length}
            icon={<Radio className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('mqtt.totalSignals', 'Total Signals')}
            value={isLoading ? '—' : fmtInt(totalSignals)}
            icon={<Activity className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('mqtt.totalBatches', 'Total Batches')}
            value={isLoading ? '—' : fmtInt(totalBatches)}
            icon={<Layers className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('mqtt.signalsPerSec', 'Signals / sec')}
            value={isLoading ? '—' : fmtNumber(totalRate)}
            icon={<Gauge className="h-5 w-5" />}
            color="amber"
          />
        </section>
      </FadeIn>

      {/* 2 — Hero bento: throughput chart (hero) + connection info (side) */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('mqtt.streamOverview', 'Stream overview')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          {/* Signal throughput — hero visual spanning most of the width */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('mqtt.signalThroughput', 'Signal Throughput')}
            </PanelTitle>
            {error && !status ? (
              <QueryError error={error} />
            ) : (
              <EmbeddedChart
                title={t('mqtt.signalThroughput', 'Signal Throughput')}
                ariaLabel={t('mqtt.throughputAria', 'MQTT signal throughput over time')}
                loading={isLoading && throughputHistory.length === 0}
                error={!status && error != null ? error : undefined}
                empty={throughputHistory.length <= 2}
                emptyMessage={t('mqtt.collectingData', 'Collecting throughput data…')}
                data={throughputChartRows}
                dataColumns={[
                  { key: 'time', label: t('mqtt.time', 'Time') },
                  { key: 'signals', label: t('mqtt.signals', 'Signals') },
                ]}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={throughputHistory}>
                    <defs>
                      <ChartGradient id="throughputGrad" color={THROUGHPUT_COLOR} opacity={0.3} />
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="signals"
                      name={t('mqtt.signals', 'Signals')}
                      stroke={THROUGHPUT_COLOR}
                      fill="url(#throughputGrad)"
                      strokeWidth={1.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            )}
          </GlassPanel>

          {/* Connection info — broker, uptime, topic patterns */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Server className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('mqtt.connectionInfo', 'Connection')}
            </PanelTitle>
            {error && !status ? (
              <QueryError error={error} />
            ) : isLoading && !status ? (
              <Skeleton height={160} />
            ) : status ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <Caption className="mb-1 block">{t('mqtt.broker', 'Broker')}</Caption>
                    <Text as="p" mono variant="body" className="truncate">{status.broker ?? '—'}</Text>
                  </div>
                  <div className="min-w-0">
                    <Caption className="mb-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {t('mqtt.uptime', 'Uptime')}
                    </Caption>
                    <Text as="p" mono variant="body" className="truncate">
                      {status.uptimeSeconds != null ? formatUptime(status.uptimeSeconds) : '—'}
                    </Text>
                  </div>
                </div>
                <div>
                  <Caption className="mb-1.5 block">{t('mqtt.topicPatterns', 'Topic Patterns')}</Caption>
                  {topics.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {topics.map((topic) => (
                        <Badge key={topic} variant="neutral" size="sm">{topic}</Badge>
                      ))}
                    </div>
                  ) : (
                    <EmptyState /* no-action: transient — surfaces when the broker reports no subscribed topic patterns */
                      message={t('mqtt.noTopics', 'No MQTT topics detected')}
                    />
                  )}
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                message={t('mqtt.noStatus', 'MQTT broker status not available')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Opt-in AI explainer (renders null unless the feature is enabled) */}
      <FadeIn delay={0.18}>
        <AIMqttSseInspectorExplanations
          fromUnix={aiWindow.fromUnix}
          toUnix={aiWindow.toUnix}
        />
      </FadeIn>

      {/* 4 — Vehicle breakdown: full-width detail band */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <PanelTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('mqtt.vehicleBreakdown', 'Vehicle Breakdown')}
              {vehicles.length > 0 && (
                <Text as="span" variant="caption" className="font-normal">
                  {vehicles.length} {t('mqtt.vehicles', 'vehicles')}
                </Text>
              )}
            </PanelTitle>
            {staleVehicles.length > 0 && (
              <Badge variant="warning" size="sm" dot>
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {staleVehicles.length} {t('mqtt.stale', 'stale')}
              </Badge>
            )}
          </div>

          {error && vehicles.length === 0 ? (
            <QueryError error={error} />
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : (
            <DataTable<VehicleTelemetry>
              tableId="telemetry:mqtt-inspector"
              columns={vehicleColumns}
              data={vehicles}
              keyExtractor={(v) => v.vin}
              compact
              virtualized
              rowHeight={36}
              maxHeight={640}
              pagination={{ defaultPageSize: 500 }}
              emptyMessage={t('mqtt.noVehicles', 'No vehicles currently streaming')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
