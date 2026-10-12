import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Radio, Wifi, WifiOff, RefreshCw, AlertTriangle, AlertCircle,
  Activity, Server, Clock,
} from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { GlassPanel, Badge, Button, DataTable, Icon, PanelTitle, Text, Caption, type Column } from '@/components/ui';
import { OperationalBrief } from '@/components/data-display';
import {
  ChartTooltip, ChartGradient,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  EmbeddedChart, axisTick,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError, AlertBanner, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { AIMqttSseInspectorExplanations } from '@/components/ai';
import { useMQTTStatus } from '@/api/hooks/useTelemetry';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { chartTokens, typography } from '@/lib/tokens';
import type { VehicleTelemetry } from '@/types/telemetry';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { mqttSummary } from '../components/statstrip-signals-mqtt/mqttSummary';

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
  return vehicleFreshness(v) === 'stale';
}

function vehicleFreshness(v: VehicleTelemetry): 'live' | 'stale' | 'unknown' {
  if (!v.lastReceived) return 'stale';
  const age = (Date.now() - new Date(v.lastReceived).getTime()) / 1000;
  if (!Number.isFinite(age) || age < 0) return 'unknown';
  return age > STALE_THRESHOLD ? 'stale' : 'live';
}

function freshnessLabel(v: VehicleTelemetry, t: (key: string, fallback: string) => string): string {
  const freshness = vehicleFreshness(v);
  return freshness === 'unknown' ? t('common.unknown', 'Unknown')
    : freshness === 'stale' ? t('mqtt.stale', 'Stale') : t('mqtt.live', 'Live');
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
      filterValue: (v) => v.vin ?? null,
      render: (v) => <Text as="span" mono color="primary" className="break-all">{v.vin}</Text>,
    },
    {
      key: 'state',
      header: t('mqtt.state', 'State'),
      filterValue: (v) => v.state ?? null,
      render: (v) => v.state
        ? <Badge variant={v.state === 'online' ? 'success' : 'neutral'} size="sm">{v.state}</Badge>
        : <Text as="span" color="muted">—</Text>,
    },
    {
      key: 'signals',
      groupStart: true,
      header: t('mqtt.signals', 'Signals'),
      align: 'right',
      filterValue: (v) => v.signalCount ?? null,
      filterValueLabel: (_value, v) => v.signalCount == null ? '—' : fmtInt(v.signalCount),
      className: 'text-right',
      render: (v) => <Text as="span" mono color="secondary">{v.signalCount == null ? '—' : fmtInt(v.signalCount)}</Text>,
    },
    {
      key: 'batches',
      header: t('mqtt.batches', 'Batches'),
      align: 'right',
      filterValue: (v) => v.batchCount ?? null,
      filterValueLabel: (_value, v) => v.batchCount == null ? '—' : fmtInt(v.batchCount),
      className: 'text-right',
      render: (v) => <Text as="span" mono color="secondary">{v.batchCount == null ? '—' : fmtInt(v.batchCount)}</Text>,
    },
    {
      key: 'sigPerSec',
      header: t('mqtt.sigPerSec', 'Sig/sec'),
      align: 'right',
      filterValue: (v) => v.signalsPerSecond ?? null,
      filterValueLabel: (_value, v) => v.signalsPerSecond == null ? '—' : fmtNumber(v.signalsPerSecond),
      className: 'text-right',
      render: (v) => <Text as="span" mono color="secondary">{v.signalsPerSecond != null ? fmtNumber(v.signalsPerSecond) : '—'}</Text>,
    },
    {
      key: 'lastReceived',
      groupStart: true,
      header: t('mqtt.lastReceived', 'Last received'),
      className: 'text-right',
      render: (v) => <Text as="span" color="muted" className="whitespace-nowrap">{v.lastReceived && Number.isFinite(Date.parse(v.lastReceived)) ? formatRelative(v.lastReceived) : '—'}</Text>,
    },
    {
      key: 'status',
      header: t('mqtt.status', 'Status'),
      align: 'center',
      filterValue: (v) => vehicleFreshness(v) === 'unknown' ? null : isVehicleStale(v),
      filterValueLabel: (_value, v) => freshnessLabel(v, t),
      className: 'text-center',
      render: (v) => {
        const freshness = vehicleFreshness(v);
        return <Badge variant={freshness === 'unknown' ? 'neutral' : freshness === 'stale' ? 'warning' : 'success'} size="sm" dot>{freshnessLabel(v, t)}</Badge>;
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function MQTTInspectorPage() {
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatTime, formatRelative } = useDateFormat();
  usePageTitle(t('mqtt.title', 'MQTT inspector'));

  const statusQuery = useMQTTStatus();
  const { data: status, isLoading } = statusQuery;
  const statusState = useDataState(statusQuery, { provenance: 'live' });
  const error = statusState.fatalError;
  const metricsUnavailable = !statusState.hasData || error != null;

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

  const vehicleColumns = useMemo(() => buildVehicleColumns(t, formatRelative), [t, formatRelative, displayPrecision, displayLocale]);

  // AI explainer window: derive (from_unix, to_unix) from the current time so
  // the in-scope window covers the most recent 30 minutes of broker activity.
  // Recomputed once per mount — a deliberate choice so the body reference stays
  // stable between renders (the AI advisor's useAiStream hook depends on body
  // identity). Operators who want a different window refresh the page.
  const aiWindow = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return { fromUnix: now - 30 * 60, toUnix: now };
  }, []);

  const connected = status?.connected;
  const summary = mqttSummary({
    available: !metricsUnavailable, vehicles: vehicles.length,
    signals: totalSignals, batches: totalBatches, rate: totalRate,
    observedAt: statusQuery.dataUpdatedAt ? new Date(statusQuery.dataUpdatedAt).toISOString() : null,
    precision: displayPrecision, locale: displayLocale,
  }, t);
  const briefMetrics = useOperationalMetrics(summary.metrics);

  return (
    <PageLayout
      title={t('mqtt.title', 'MQTT inspector')}
      subtitle={t('mqtt.subtitle', 'MQTT connection status and streaming telemetry')}
      metadataActions={
        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end sm:gap-3">
          <Caption className="inline-flex items-center gap-1">
            <Icon icon={RefreshCw} size="xs" />
            {t('mqtt.refreshInterval', 'Refreshes every 5s')}
          </Caption>
          <Badge variant={connected === true ? 'success' : 'neutral'} dot>
            {connected === true
              ? <><Icon icon={Wifi} size="xs" /> {t('mqtt.connected', 'Connected')}</>
              : connected === false
                ? <><Icon icon={WifiOff} size="xs" /> {t('mqtt.disconnected', 'Disconnected')}</>
                : t('common.unknown', 'Unknown')}
          </Badge>
        </div>
      }
    >
      {error && (
        <FadeIn>
          <AlertBanner variant="danger" icon={<Icon icon={AlertCircle} size="lg" />}>
            {t('mqtt.fetchError', 'Unable to load MQTT status')}: {(error as Error)?.message ?? String(error)}
            <div className="mt-3">
              <Button variant="secondary" icon={<Icon icon={RefreshCw} />}
                className="min-h-11" onClick={statusState.retry ?? undefined}
                disabled={!statusState.retry || statusQuery.isFetching}>
                {t('common.refresh', 'Refresh')}
              </Button>
            </div>
          </AlertBanner>
        </FadeIn>
      )}
      <StaleRefreshWarning state={statusState} label={t('mqtt.connectionInfo', 'Connection')} />

      {/* 1 — Summary: source broker counters and reported rates */}
      <FadeIn>
        <section aria-label={t('mqtt.metrics', 'Stream metrics')}>
          <OperationalBrief
            compact
            testId="mqtt-summary"
            eyebrow={t('mqtt.title', 'MQTT inspector')}
            title={t('mqtt.summary.title', 'Broker counters and reported rates')}
            description={summary.period.kind === 'snapshot' ? summary.period.provenance : summary.period.label}
            metrics={briefMetrics}
            scope={summary.period.label}
            statusLabel={metricsUnavailable
              ? isLoading ? t('common.loading', 'Loading') : t('mqtt.summary.unavailable', 'Broker snapshot unavailable')
              : statusState.refreshError || statusState.isRefreshBlocked ? t('developerReference.stats.state.retained', 'Showing retained measurements')
                : t('mqtt.summary.available', 'Broker snapshot available')}
            statusTone={error ? 'danger' : statusState.refreshError || statusState.isRefreshBlocked ? 'warning' : 'neutral'}
            freshness={statusQuery.dataUpdatedAt ? formatRelative(new Date(statusQuery.dataUpdatedAt)) : undefined}
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
              <Icon icon={Activity} className={typography.color.secondary} />
              {t('mqtt.signalThroughput', 'Signal throughput')}
            </PanelTitle>
            {error && !status ? (
              <QueryError error={error} />
            ) : (
              <EmbeddedChart
                title={t('mqtt.signalThroughput', 'Signal throughput')}
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
                      <ChartGradient id="throughputGrad" color={THROUGHPUT_COLOR} opacity={0.08} />
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
                    <XAxis dataKey="time" tick={axisTick} />
                    <YAxis tick={axisTick} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="signals"
                      name={t('mqtt.signals', 'Signals')}
                      stroke={THROUGHPUT_COLOR}
                      fill="url(#throughputGrad)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            )}
          </GlassPanel>

          {/* Connection info — broker, uptime, topic patterns */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Icon icon={Server} className={typography.color.secondary} />
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
                    <Text as="p" mono variant="body" className="break-words">{status.broker ?? '—'}</Text>
                  </div>
                  <div className="min-w-0">
                    <Caption className="mb-1 flex items-center gap-1">
                      <Icon icon={Clock} size="xs" />
                      {t('mqtt.uptime', 'Uptime')}
                    </Caption>
                    <Text as="p" mono variant="body" className="break-words">
                      {status.uptimeSeconds != null ? formatUptime(status.uptimeSeconds) : '—'}
                    </Text>
                  </div>
                </div>
                <div>
                  <Caption className="mb-1.5 block">{t('mqtt.topicPatterns', 'Topic patterns')}</Caption>
                  {topics.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {topics.map((topic) => (
                        <Badge key={topic} variant="neutral" size="sm" className="max-w-full break-all">{topic}</Badge>
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
              <Icon icon={Radio} className={typography.color.secondary} />
              {t('mqtt.vehicleBreakdown', 'Vehicle breakdown')}
              {vehicles.length > 0 && (
                <Text as="span" variant="caption" className="font-normal">
                  {vehicles.length} {t('mqtt.vehicles', 'vehicles')}
                </Text>
              )}
            </PanelTitle>
            {staleVehicles.length > 0 && (
              <Badge variant="warning" size="sm" dot>
                <Icon icon={AlertTriangle} size="xs" />
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
              name={t('mqtt.vehicleBreakdown', 'Vehicle breakdown')}
              enableValueFilters
              columns={vehicleColumns}
              mobileColumns={['vin', 'status', 'lastReceived']}
              mobilePresentation={{
                variant: 'cards',
                roles: { vin: 'title', status: 'badge', lastReceived: 'meta', signals: 'primary' },
                displayValue: (v, key) => {
                  switch (key) {
                    case 'vin': return v.vin;
                    case 'state': return v.state ?? '—';
                    case 'signals': return v.signalCount == null ? '—' : fmtInt(v.signalCount);
                    case 'batches': return v.batchCount == null ? '—' : fmtInt(v.batchCount);
                    case 'sigPerSec': return v.signalsPerSecond == null ? '—' : fmtNumber(v.signalsPerSecond);
                    case 'lastReceived': return v.lastReceived && Number.isFinite(Date.parse(v.lastReceived)) ? formatRelative(v.lastReceived) : '—';
                    case 'status': return freshnessLabel(v, t);
                    default: return '—';
                  }
                },
              }}
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
    </PageLayout>
  );
}
