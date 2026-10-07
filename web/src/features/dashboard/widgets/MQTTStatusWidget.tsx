import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';
import { StatusBadge, StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useMQTTStatus } from '@/api/hooks/useTelemetry';
import { fmtNumber, fmtInt, safeNumber } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import type { VehicleTelemetry } from '@/types/telemetry';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export interface MqttWidgetStats {
  /** Sum of per-vehicle signal counts across the streaming fleet. */
  totalMessages: number;
  /** Sum of per-vehicle signal rates (signals/sec) across the fleet. */
  messagesPerSec: number;
  /** ISO timestamp of the most recently received signal, or null when none. */
  lastMessage: string | null;
}

/**
 * Fold the per-vehicle telemetry rows into the three fleet-level figures the
 * widget renders. Pure + null-safe so it can be unit-tested in isolation and
 * reused without a React tree.
 *
 * Counts run through `safeNumber` so a nullish/NaN/non-numeric field
 * contributes 0 instead of poisoning the running total. `lastMessage` is
 * chosen by parsed instant rather than lexical order — an out-of-band
 * timestamp format (e.g. differing fractional-second precision) can sort
 * incorrectly as a raw string, and unparseable timestamps are skipped instead
 * of winning the comparison.
 */
export function deriveMqttStats(
  vehicles: VehicleTelemetry[] | null | undefined,
): MqttWidgetStats {
  let totalMessages = 0;
  let messagesPerSec = 0;
  let lastMessage: string | null = null;
  let lastMessageMs = -Infinity;

  for (const v of vehicles ?? []) {
    totalMessages += safeNumber(v.signalCount ?? v.signal_count);
    messagesPerSec += safeNumber(v.signalsPerSecond ?? v.signals_per_second);
    const received = v.lastReceived ?? v.last_received;
    if (received) {
      const ms = new Date(received).getTime();
      if (Number.isFinite(ms) && ms > lastMessageMs) {
        lastMessageMs = ms;
        lastMessage = received;
      }
    }
  }

  return { totalMessages, messagesPerSec, lastMessage };
}

export default function MQTTStatusWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } =
    useMQTTStatus();

  const isCompact = size.cols <= 1;

  const stats = useMemo(() => deriveMqttStats(data?.vehicles), [data]);

  const connected = data?.connected ?? false;
  // `|| '—'` (not `??`) so an empty-string broker also degrades to the
  // placeholder rather than rendering a blank value.
  const broker = data?.broker || '—';

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.mqtt.title', 'MQTT Status')}
      icon={<Radio className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {data ? (
        isCompact ? (
          /* ── Compact layout (1×2) ── */
          <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
            <StatusBadge status={connected ? 'online' : 'offline'} size="sm" />
            <span className="text-lg font-bold text-[var(--text-primary)] truncate">
              {fmtNumber(stats.messagesPerSec, 1)}
              <span className="text-xs font-normal text-[var(--text-secondary)] ml-1">
                {t('widget.mqtt.msgSec', 'msg/s')}
              </span>
            </span>
          </div>
        ) : (
          /* ── Standard layout (2×2+) ── */
          <div className="flex flex-col gap-3 h-full">
            {/* Connection status row */}
            <div className="flex items-center justify-between">
              <span className="text-2xs uppercase tracking-wider text-[var(--text-muted)]">
                {t('widget.mqtt.status', 'Status')}
              </span>
              <StatusBadge status={connected ? 'online' : 'offline'} size="sm" />
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label={t('widget.mqtt.msgRate', 'Messages/sec')}
                value={fmtNumber(stats.messagesPerSec, 1)}
              />
              <StatCard
                label={t('widget.mqtt.totalToday', 'Total Messages')}
                value={fmtInt(stats.totalMessages)}
              />
            </div>

            {/* Last message & broker */}
            <div className="mt-auto pt-2 border-t border-white/[0.06] space-y-1.5">
              <div className="flex items-center justify-between text-2xs text-[var(--text-muted)]">
                <span>{t('widget.mqtt.lastMessage', 'Last Message')}</span>
                <span className="text-[var(--text-secondary)] truncate ml-2">
                  {stats.lastMessage ? formatRelative(stats.lastMessage) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-2xs text-[var(--text-muted)]">
                <span>{t('widget.mqtt.broker', 'Broker')}</span>
                <span className="text-[var(--text-secondary)] truncate ml-2">{broker}</span>
              </div>
            </div>
          </div>
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Radio className="h-5 w-5" />}
          message={t('widget.mqtt.noData', 'No MQTT status data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
