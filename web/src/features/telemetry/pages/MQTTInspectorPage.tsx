import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio, Wifi, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Badge, DataTable, type Column } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import {
  ChartTooltip, ChartGradient,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useMQTTStatus } from '@/api/hooks/useTelemetry';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatRelative } from '@/lib/dateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { VehicleTelemetry } from '@/types/telemetry';

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const STALE_THRESHOLD = 120;

interface ThroughputPoint {
  time: string;
  signals: number;
}

function formatUptime(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${fmtInt((seconds % 3600) / 60)}m`;
}

/* ------------------------------------------------------------------ */
/*  Vehicle table columns                                              */
/* ------------------------------------------------------------------ */

function buildVehicleColumns(t: (key: string, fallback: string) => string): Column<VehicleTelemetry>[] {
  return [
    {
      key: 'vin',
      header: t('mqtt.vin', 'VIN'),
      render: (v) => <span className="font-mono text-[var(--text-primary)]">{v.vin}</span>,
    },
    {
      key: 'state',
      header: t('mqtt.state', 'State'),
      render: (v) => v.state
        ? <Badge variant={v.state === 'online' ? 'success' : 'neutral'} size="sm">{v.state}</Badge>
        : <span className="text-[var(--text-muted)]">—</span>,
    },
    {
      key: 'signals',
      header: t('mqtt.signals', 'Signals'),
      className: 'text-right',
      render: (v) => <span className="font-mono text-[var(--text-secondary)]">{fmtInt(v.signalCount)}</span>,
    },
    {
      key: 'batches',
      header: t('mqtt.batches', 'Batches'),
      className: 'text-right',
      render: (v) => <span className="font-mono text-[var(--text-secondary)]">{fmtInt(v.batchCount)}</span>,
    },
    {
      key: 'sigPerSec',
      header: t('mqtt.sigPerSec', 'Sig/sec'),
      className: 'text-right',
      render: (v) => <span className="font-mono text-[var(--text-secondary)]">{v.signalsPerSecond != null ? fmtNumber(v.signalsPerSecond) : '—'}</span>,
    },
    {
      key: 'lastReceived',
      header: t('mqtt.lastReceived', 'Last Received'),
      className: 'text-right',
      render: (v) => <span className="text-[var(--text-muted)] whitespace-nowrap">{v.lastReceived ? formatRelative(v.lastReceived) : '—'}</span>,
    },
    {
      key: 'status',
      header: t('mqtt.status', 'Status'),
      className: 'text-center',
      render: (v) => {
        const isStale = !v.lastReceived || (Date.now() - new Date(v.lastReceived).getTime()) / 1000 > STALE_THRESHOLD;
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
  usePageTitle(t('mqtt.title', 'MQTT Inspector'));

  const { data: status, isLoading, error } = useMQTTStatus();

  /* ---- throughput history ---- */
  const [throughputHistory, setThroughputHistory] = useState<ThroughputPoint[]>([]);
  const prevTotalRef = useRef<number | null>(null);

  const vehicles: VehicleTelemetry[] = Array.isArray(status?.vehicles) ? status.vehicles : [];
  const totalSignals = vehicles.reduce((sum, v) => sum + (v.signalCount ?? 0), 0);
  const totalBatches = vehicles.reduce((sum, v) => sum + (v.batchCount ?? 0), 0);
  const totalRate = vehicles.reduce((sum, v) => sum + (v.signalsPerSecond ?? 0), 0);

  useEffect(() => {
    if (totalSignals === 0 && prevTotalRef.current === null) return;
    const delta = prevTotalRef.current !== null ? totalSignals - prevTotalRef.current : 0;
    prevTotalRef.current = totalSignals;
    if (delta >= 0) {
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setThroughputHistory((prev) => [...prev, { time: now, signals: Math.max(delta, 0) }].slice(-60));
    }
  }, [totalSignals]);

  const staleVehicles = useMemo(
    () => vehicles.filter((v) => {
      if (!v.lastReceived) return true;
      return (Date.now() - new Date(v.lastReceived).getTime()) / 1000 > STALE_THRESHOLD;
    }),
    [vehicles],
  );

  const vehicleColumns = useMemo(() => buildVehicleColumns(t), [t]);

  return (
    <PageContainer
      title={t('mqtt.title', 'MQTT Inspector')}
      subtitle={t('mqtt.subtitle', 'MQTT connection status and streaming telemetry')}
      actions={
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-muted)]">
            <RefreshCw className="inline h-3 w-3 mr-1" />
            {t('mqtt.refreshInterval', 'Refreshes every 5s')}
          </span>
          <Badge variant={status?.connected ? 'success' : 'danger'} dot>
            {status?.connected
              ? <><Wifi className="h-3 w-3" /> {t('mqtt.connected', 'Connected')}</>
              : <><WifiOff className="h-3 w-3" /> {t('mqtt.disconnected', 'Disconnected')}</>}
          </Badge>
        </div>
      }
    >
      {error && !status && (
        <FadeIn>
          <GlassPanel className="p-4 border border-red-500/30 bg-red-500/5">
            <div className="flex items-start gap-3 text-sm">
              <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-red-300">
                  {t('mqtt.fetchError', 'Unable to load MQTT status')}
                </p>
                <p className="mt-1 text-[var(--text-muted)]">
                  {(error as Error)?.message ?? String(error)}
                </p>
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}
      {/* Summary Cards */}
      <FadeIn delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label={t('mqtt.streamingVehicles', 'Streaming Vehicles')}
            value={isLoading ? '—' : vehicles.length}
            icon={<Radio className="h-4 w-4" />}
          />
          <StatCard
            label={t('mqtt.totalSignals', 'Total Signals')}
            value={isLoading ? '—' : fmtInt(totalSignals)}
            icon={<Radio className="h-4 w-4" />}
          />
          <StatCard
            label={t('mqtt.totalBatches', 'Total Batches')}
            value={isLoading ? '—' : fmtInt(totalBatches)}
            icon={<Radio className="h-4 w-4" />}
          />
          <StatCard
            label={t('mqtt.signalsPerSec', 'Signals / sec')}
            value={isLoading ? '—' : fmtNumber(totalRate)}
            icon={<Radio className="h-4 w-4" />}
          />
        </div>
      </FadeIn>

      {/* Connection Info */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-5">
          {status ? (
            <div className="flex flex-wrap gap-6 text-sm">
              {status.broker && (
                <div>
                  <span className="text-[var(--text-muted)] text-xs">{t('mqtt.broker', 'Broker')}</span>
                  <p className="font-mono text-[var(--text-primary)]">{status.broker}</p>
                </div>
              )}
              {status.uptimeSeconds != null && (
                <div>
                  <span className="text-[var(--text-muted)] text-xs">{t('mqtt.uptime', 'Uptime')}</span>
                  <p className="font-mono text-[var(--text-primary)]">{formatUptime(status.uptimeSeconds)}</p>
                </div>
              )}
              {status.topics && status.topics.length > 0 ? (
                <div>
                  <span className="text-[var(--text-muted)] text-xs">{t('mqtt.topicPatterns', 'Topic Patterns')}</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {status.topics.map((topic) => (
                      <Badge key={topic} variant="neutral" size="sm">{topic}</Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState message={t('mqtt.noTopics', 'No MQTT topics detected')} />
              )}
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('mqtt.noStatus', 'MQTT broker status not available')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Throughput Chart */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            {t('mqtt.signalThroughput', 'Signal Throughput')}
          </h2>
          {throughputHistory.length > 2 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={throughputHistory}>
                <defs>
                  <ChartGradient id="throughputGrad" color="#00f0ff" opacity={0.3} />
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="signals"
                  name={t('mqtt.signals', 'Signals')}
                  stroke="#00f0ff"
                  fill="url(#throughputGrad)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">
              {t('mqtt.collectingData', 'Collecting throughput data…')}
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Vehicle Breakdown */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('mqtt.vehicleBreakdown', 'Vehicle Breakdown')}
              {vehicles.length > 0 && (
                <span className="ml-2 text-[var(--text-muted)] font-normal">
                  {vehicles.length} {t('mqtt.vehicles', 'vehicles')}
                </span>
              )}
            </h2>
            {staleVehicles.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {staleVehicles.length} {t('mqtt.stale', 'stale')}
              </span>
            )}
          </div>

          {isLoading ? (
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
