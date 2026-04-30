import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';
import { StatusBadge, StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useMQTTStatus } from '@/api/hooks/useTelemetry';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function MQTTStatusWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } =
    useMQTTStatus();

  const isCompact = size.cols <= 1;

  const stats = useMemo(() => {
    const vehicles = data?.vehicles ?? [];
    const totalMessages = vehicles.reduce(
      (sum, v) => sum + (v.signalCount ?? v.signal_count ?? 0),
      0,
    );
    const messagesPerSec = vehicles.reduce(
      (sum, v) => sum + (v.signalsPerSecond ?? v.signals_per_second ?? 0),
      0,
    );
    const lastReceivedDates = vehicles
      .map((v) => v.lastReceived ?? v.last_received)
      .filter(Boolean) as string[];
    const lastMessage =
      lastReceivedDates.length > 0
        ? lastReceivedDates.sort().reverse()[0]
        : null;
    return { totalMessages, messagesPerSec, lastMessage };
  }, [data]);

  const connected = data?.connected ?? false;
  const broker = data?.broker ?? '—';

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
            <span className="text-lg font-bold text-white/90 truncate">
              {fmtNumber(stats.messagesPerSec, 1)}
              <span className="text-xs font-normal text-white/50 ml-1">
                {t('widget.mqtt.msgSec', 'msg/s')}
              </span>
            </span>
          </div>
        ) : (
          /* ── Standard layout (2×2+) ── */
          <div className="flex flex-col gap-3 h-full">
            {/* Connection status row */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-white/40">
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
              <div className="flex items-center justify-between text-[10px] text-white/40">
                <span>{t('widget.mqtt.lastMessage', 'Last Message')}</span>
                <span className="text-white/60 truncate ml-2">
                  {stats.lastMessage ? formatRelative(stats.lastMessage) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-white/40">
                <span>{t('widget.mqtt.broker', 'Broker')}</span>
                <span className="text-white/60 truncate ml-2">{broker}</span>
              </div>
            </div>
          </div>
        )
      ) : (
        <EmptyState
          icon={<Radio className="h-5 w-5" />}
          message={t('widget.mqtt.noData', 'No MQTT status data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
