import { useMemo, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollText, Pause, Play } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { useSignalObservations, useMQTTStatus } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import { isFiniteNumber } from '@/lib/numberFormat';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';
import type { SignalObservation } from '@/types/signals';
import type { VehicleTelemetry } from '@/types/telemetry';
import { useDateFormat } from '@/hooks/useDateFormat';
import { EmptyState } from '@/components/feedback';

/**
 * Render a single observation's value for the feed subtitle.
 *
 * Guards the numeric branch with `isFiniteNumber` so a `NaN` / `Infinity`
 * value_numeric (which the `number` type still permits) can never leak
 * "NaN" / "Infinity" into the UI — such rows fall through to the text /
 * bool branches and ultimately the "—" placeholder.
 */
export function formatSignalValue(obs: SignalObservation): string {
  if (isFiniteNumber(obs.value_numeric)) return String(obs.value_numeric);
  if (obs.value_text != null && obs.value_text !== '') return obs.value_text;
  if (obs.value_bool != null) return obs.value_bool ? 'true' : 'false';
  return '—';
}

/**
 * Sum the per-vehicle signal ingest rate across the fleet for the compact
 * "signals/sec" hero. Prefers the camelCase field, falls back to the
 * snake_case alias. A missing rate on any vehicle makes the aggregate unknown
 * rather than presenting a partial sample as a complete fleet total.
 */
export function deriveSignalRate(
  vehicles: VehicleTelemetry[] | null | undefined,
): number | null {
  if (vehicles == null) return null;
  let total = 0;
  for (const vehicle of vehicles) {
    const rate = knownNumber(vehicle.signalsPerSecond ?? vehicle.signals_per_second);
    if (rate == null) return null;
    total += rate;
  }
  return total;
}

// ── Compact layout (1×2): big number for signals/sec ─────────────────

function CompactView({
  rate,
  t,
}: {
  rate: number | null;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <WidgetBigNumber
      value={rate == null ? null : Math.round(rate)}
      animated={false}
      label={t('widget.signalLog.signalsPerSec', "signals/sec")}
    />
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function SignalLogWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { opts: dateOpts } = useDateFormat();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const [paused, setPaused] = useState(false);
  const pausedDataRef = useRef<EventFeedItem[]>([]);

  const observationsQuery = useSignalObservations(vid, { limit: 20 });
  const {
    data: observations,
    isLoading,
  } = observationsQuery;

  const mqttQuery = useMQTTStatus();
  const { data: mqttData } = mqttQuery;

  const isCompact = size.cols <= 1;
  const query = isCompact ? mqttQuery : observationsQuery;
  const state = deriveDataState({
    data: query.data ?? (query.isLoading || query.isError || query.error ? undefined : null),
    error: query.error,
    isError: query.isError,
    isFetching: query.isFetching,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  });

  // Map observations → EventFeedItem[]
  const feedItems = useMemo<EventFeedItem[]>(() => {
    const list = observations ?? [];
    return list.map((obs, i) => {
      return {
        id: `${obs.ts}-${obs.signal_name}-${i}`,
        icon: null,
        title: obs.signal_name ?? '—',
        subtitle: formatSignalValue(obs),
        timestamp: obs.ts ?? '',
        color: 'var(--text-muted)',
        severity: 'info' as const,
        wrap: true,
      };
    });
  }, [observations]);

  // Freeze display when paused
  const displayItems = useMemo(() => {
    if (!paused) {
      pausedDataRef.current = feedItems;
      return feedItems;
    }
    return pausedDataRef.current;
  }, [paused, feedItems]);

  const handleTogglePause = useCallback(() => {
    if (!paused) {
      pausedDataRef.current = feedItems;
    }
    setPaused((prev) => !prev);
  }, [paused, feedItems]);

  // Aggregate signals/sec from MQTT status for compact view
  const rate = useMemo(() => deriveSignalRate(mqttData?.vehicles), [mqttData]);

  const pauseAction = (
    <IconButton
      icon={paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
      label={paused ? t('widget.signalLog.resume', 'Resume') : t('widget.signalLog.pause', 'Pause')}
      aria-label={paused ? t('widget.signalLog.resume', 'Resume') : t('widget.signalLog.pause', 'Pause')}
      onClick={handleTogglePause}
    />
  );

  return (
    <WidgetShell
      title={t('widget.signalLog.title', 'Signal log')}
      icon={<ScrollText className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={state}
      query={query}
      onRefresh={() => { void observationsQuery.refetch(); void mqttQuery.refetch(); }}
      actions={!isCompact ? pauseAction : undefined}
    >
      {isCompact ? (
        <CompactView rate={rate} t={t} />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {displayItems.length === 0 ? (
            <EmptyState
              message={t('widget.signalLog.noSignals', 'No signal updates yet')}
              className="py-4"
            />
          ) : (
            <ul role="list" aria-label={t('widget.eventFeed.label', 'Event feed')} className="divide-y divide-[var(--border-subtle)] font-mono">
              {[...displayItems]
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .slice(0, 20)
                .map((item) => {
                  const parsed = new Date(item.timestamp);
                  const timeLabel = Number.isNaN(parsed.getTime())
                    ? '—'
                    : new Intl.DateTimeFormat(dateOpts.locale, {
                        timeZone: dateOpts.tz,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                      }).format(parsed);
                  return (
                    <li role="listitem" key={item.id} className="grid min-h-9 grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-xs">
                      <span className="tabular-nums text-[var(--text-muted)]">{timeLabel}</span>
                      <span className="truncate text-[var(--text-primary)]" title={item.title}>{item.title}</span>
                      <span className="max-w-24 truncate text-end font-semibold tabular-nums text-[var(--text-primary)]" title={item.subtitle}>
                        {item.subtitle ?? '—'}
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
