import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Shield, Lock, Unlock, Eye, EyeOff, DoorOpen, DoorClosed } from 'lucide-react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import type { SecurityEvent } from '@/api/types';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed, type EventFeedItem } from './shared';
import type { WidgetProps } from './types';

/** Derive a human-readable event descriptor with severity from a security snapshot. */
function deriveEvent(ev: SecurityEvent): { icon: React.ReactNode; title: string; color: string; severity: EventFeedItem['severity'] } {
  const openDoors = (ev.door_state ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.toLowerCase().includes('open'));

  if (openDoors.length > 0) {
    return {
      icon: <DoorOpen className="h-3.5 w-3.5" />,
      title: `Door open: ${openDoors.join(', ')}`,
      color: '#f59e0b',
      severity: 'warning',
    };
  }
  if (ev.sentry_mode) {
    return {
      icon: <Eye className="h-3.5 w-3.5" />,
      title: 'Sentry Mode activated',
      color: '#06b6d4',
      severity: 'info',
    };
  }
  if (ev.sentry_mode === false) {
    return {
      icon: <EyeOff className="h-3.5 w-3.5" />,
      title: 'Sentry Mode deactivated',
      color: '#6b7280',
      severity: 'info',
    };
  }
  if (ev.locked) {
    return {
      icon: <Lock className="h-3.5 w-3.5" />,
      title: 'Vehicle locked',
      color: '#22c55e',
      severity: 'info',
    };
  }
  if (ev.locked === false) {
    return {
      icon: <Unlock className="h-3.5 w-3.5" />,
      title: 'Vehicle unlocked',
      color: '#ef4444',
      severity: 'critical',
    };
  }
  return {
    icon: <DoorClosed className="h-3.5 w-3.5" />,
    title: 'Security state updated',
    color: '#8b5cf6',
    severity: 'info',
  };
}

export default function SentryEventLogWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;
  const eventLimit = isWide ? 10 : isTall ? 7 : 4;

  const { data: events, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['security-events', id, `sentry-log-${eventLimit}`],
    queryFn: () => request<SecurityEvent[]>(`/security?vehicle_id=${id}&limit=${eventLimit}`),
    enabled: id > 0,
    refetchInterval: 30_000,
  });

  const feedItems = useMemo<EventFeedItem[]>(() => {
    return (events ?? []).map((ev) => {
      const derived = deriveEvent(ev);
      const parts: string[] = [];
      if (ev.locked != null) parts.push(ev.locked ? '🔒 Locked' : '🔓 Unlocked');
      if (ev.sentry_mode != null) parts.push(ev.sentry_mode ? '🛡️ Sentry On' : 'Sentry Off');
      const subtitle = parts.join(' · ') || '—';
      return {
        id: ev.id ?? `${ev.vehicle_id}-${ev.ts}`,
        icon: derived.icon,
        title: derived.title,
        subtitle: isWide ? subtitle : undefined,
        timestamp: ev.created_at ?? ev.ts,
        color: derived.color,
        severity: derived.severity,
      };
    });
  }, [events, isWide]);

  return (
    <WidgetShell
      title={t('widget.sentryEventLog', 'Sentry Event Log')}
      icon={<Shield className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <WidgetEventFeed
        items={feedItems}
        maxItems={eventLimit}
        emptyMessage={t('widget.noSentryEvents', 'No security events recorded')}
        emptyIcon={<Shield className="h-5 w-5" />}
      />
    </WidgetShell>
  );
}
