import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';
import { Caption } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useMQTTStatus } from '@/api/hooks/useTelemetry';

import { deriveDataState, knownNumber } from '@/api/dataState';
import { formatRelative } from '@/lib/dateFormat';
import type { VehicleTelemetry } from '@/types/telemetry';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, WidgetStatusGrid, type StatusCell } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface MqttWidgetStats {
  /** Sum of per-vehicle signal counts across the streaming fleet. */
  totalMessages: number | null;
  /** Sum of per-vehicle signal rates (signals/sec) across the fleet. */
  messagesPerSec: number | null;
  /** ISO timestamp of the most recently received signal, or null when none. */
  lastMessage: string | null;
}

/**
 * Fold the per-vehicle telemetry rows into the three fleet-level figures the
 * widget renders. Pure + null-safe so it can be unit-tested in isolation and
 * reused without a React tree.
 *
 * A missing counter makes its fleet total unknown: a partial sum cannot be
 * presented as a complete fleet measurement. `lastMessage` is
 * chosen by parsed instant rather than lexical order — an out-of-band
 * timestamp format (e.g. differing fractional-second precision) can sort
 * incorrectly as a raw string, and unparseable timestamps are skipped instead
 * of winning the comparison.
 */
export function deriveMqttStats(
  vehicles: VehicleTelemetry[] | null | undefined,
): MqttWidgetStats {
  let totalMessages: number | null = vehicles != null && vehicles.length === 0 ? 0 : null;
  let messagesPerSec: number | null = vehicles != null && vehicles.length === 0 ? 0 : null;
  let countsComplete = true;
  let ratesComplete = true;
  let lastMessage: string | null = null;
  let lastMessageMs = -Infinity;

  for (const v of vehicles ?? []) {
    const count = knownNumber(v.signalCount ?? v.signal_count);
    const rate = knownNumber(v.signalsPerSecond ?? v.signals_per_second);
    countsComplete &&= count != null;
    ratesComplete &&= rate != null;
    if (count != null) totalMessages = (totalMessages ?? 0) + count;
    if (rate != null) messagesPerSec = (messagesPerSec ?? 0) + rate;
    const received = v.lastReceived ?? v.last_received;
    if (received) {
      const ms = new Date(received).getTime();
      if (Number.isFinite(ms) && ms > lastMessageMs) {
        lastMessageMs = ms;
        lastMessage = received;
      }
    }
  }

  return {
    totalMessages: countsComplete ? totalMessages : null,
    messagesPerSec: ratesComplete ? messagesPerSec : null,
    lastMessage,
  };
}

export default function MQTTStatusWidget({ size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const query = useMQTTStatus();
  const { data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const state = deriveDataState({ ...query, data: data ?? (isLoading || query.isError || query.error ? undefined : null) });

  const isCompact = size.cols <= 1;

  const stats = useMemo(() => deriveMqttStats(data?.vehicles), [data]);

  const connected = data?.connected;
  const status: StatusCell = {
    id: 'mqtt', label: t('widget.mqtt.status', 'Status'),
    status: connected == null ? 'unknown' : connected ? 'ok' : 'error',
    statusLabel: connected == null ? t('widget.mqtt.unknown', 'Unknown')
      : connected ? t('widget.mqtt.online', 'Online') : t('widget.mqtt.offline', 'Offline'),
  };
  // `|| '—'` (not `??`) so an empty-string broker also degrades to the
  // placeholder rather than rendering a blank value.
  const broker = data?.broker || '—';

  return (
    <WidgetShell
      title={t('widget.mqtt.title', 'MQTT status')}
      icon={<Radio className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={state}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {isCompact ? (
          /* ── Compact layout (1×2) ── */
          <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
            <WidgetBigNumber
              value={stats.messagesPerSec == null ? null : fmtNumber(stats.messagesPerSec)}
              unit={t('widget.mqtt.msgSec', 'msg/s')}
              badge={{ text: status.statusLabel ?? '—', variant: connected == null ? 'neutral' : connected ? 'success' : 'error' }}
            />
          </div>
        ) : (
          /* ── Standard layout (2×2+) ── */
          <div className="flex flex-col gap-3 h-full">
            {/* Connection status row */}
            <WidgetStatusGrid cells={[status]} />

            {/* Stats grid */}
            <WidgetStatGrid cols={2} stats={[
              { label: t('widget.mqtt.msgRate', 'Messages/sec'), value: stats.messagesPerSec == null ? '—' : fmtNumber(stats.messagesPerSec) },
              { label: t('widget.mqtt.totalToday', 'Total messages'), value: stats.totalMessages == null ? '—' : fmtInt(stats.totalMessages) },
            ]} />

            {/* Last message & broker */}
            <div className="mt-auto pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Caption>{t('widget.mqtt.lastMessage', 'Last message')}</Caption>
                <Caption className="truncate">
                  {stats.lastMessage ? formatRelative(stats.lastMessage) : '—'}
                </Caption>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Caption>{t('widget.mqtt.broker', 'Broker')}</Caption>
                <Caption className="truncate" title={broker}>{broker}</Caption>
              </div>
            </div>
          </div>
      )}
      {!data && (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Radio className="h-5 w-5" />}
          message={t('widget.mqtt.noData', 'No MQTT status data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
