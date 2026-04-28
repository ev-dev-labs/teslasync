import { useMemo, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollText, Pause, Play } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { useSignalObservations, useMQTTStatus } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed, WidgetBigNumber } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';
import type { SignalObservation } from '@/types/signals';

// ── Source → visual mapping ──────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  fleet_telemetry: '#22c55e',
  fleet_api: '#06b6d4',
  manual: '#f59e0b',
  backfill: '#6b7280',
};

const SOURCE_LABELS: Record<string, string> = {
  fleet_telemetry: 'MQTT',
  fleet_api: 'API',
  manual: 'Manual',
  backfill: 'Cache',
};

function formatSignalValue(obs: SignalObservation): string {
  if (obs.value_numeric != null) return String(obs.value_numeric);
  if (obs.value_text != null) return obs.value_text;
  if (obs.value_bool != null) return obs.value_bool ? 'true' : 'false';
  return '—';
}

// ── Compact layout (1×2): big number for signals/sec ─────────────────

function CompactView({
  rate,
  t,
}: {
  rate: number;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <WidgetBigNumber
      value={Math.round(rate)}
      label={t('widget.signalLog.signalsPerSec', 'signals/sec')}
    />
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function SignalLogWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const [paused, setPaused] = useState(false);
  const pausedDataRef = useRef<EventFeedItem[]>([]);

  const {
    data: observations,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSignalObservations(vid, { limit: 20 });

  const { data: mqttData } = useMQTTStatus();

  const isCompact = size.cols <= 1;

  // Map observations → EventFeedItem[]
  const feedItems = useMemo<EventFeedItem[]>(() => {
    const list = observations ?? [];
    return list.map((obs, i) => {
      const source = obs.source ?? 'backfill';
      const sourceLabel = SOURCE_LABELS[source] ?? source;
      return {
        id: `${obs.ts}-${obs.signal_name}-${i}`,
        icon: (
          <Badge
            variant={source === 'fleet_telemetry' ? 'success' : 'neutral'}
            size="sm"
          >
            {sourceLabel}
          </Badge>
        ),
        title: obs.signal_name ?? '—',
        subtitle: formatSignalValue(obs),
        timestamp: obs.ts ?? new Date(0).toISOString(),
        color: SOURCE_COLORS[source] ?? '#6b7280',
        severity: 'info' as const,
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
  const rate = useMemo(() => {
    const vList = mqttData?.vehicles ?? [];
    return vList.reduce(
      (sum, v) => sum + (v.signalsPerSecond ?? v.signals_per_second ?? 0),
      0,
    );
  }, [mqttData]);

  const pauseAction = (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleTogglePause}
      className="min-h-[44px] min-w-[44px]"
      aria-label={
        paused
          ? t('widget.signalLog.resume', 'Resume')
          : t('widget.signalLog.pause', 'Pause')
      }
    >
      {paused ? (
        <Play className="h-3.5 w-3.5" />
      ) : (
        <Pause className="h-3.5 w-3.5" />
      )}
    </Button>
  );

  return (
    <WidgetShell
      title={t('widget.signalLog.title', 'Signal Log')}
      icon={<ScrollText className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      actions={!isCompact ? pauseAction : undefined}
    >
      {isCompact ? (
        <CompactView rate={rate} t={t} />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <WidgetEventFeed
            items={displayItems}
            maxItems={20}
            compact={false}
            emptyMessage={t('widget.signalLog.noSignals', 'No signal updates yet')}
            emptyIcon={<ScrollText className="h-5 w-5" />}
          />
        </div>
      )}
    </WidgetShell>
  );
}
