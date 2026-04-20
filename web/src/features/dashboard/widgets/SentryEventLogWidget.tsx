import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Shield, Lock, Unlock, Eye, EyeOff, DoorOpen, DoorClosed } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { TimelineItem } from '@/components/data-display';
import { useVehicles } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import type { SecurityEvent } from '@/api/types';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/** Derive a human-readable event descriptor from a security snapshot. */
function deriveEvent(ev: SecurityEvent): { icon: React.ReactNode; title: string; color: string } {
  const openDoors = (ev.door_state ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.toLowerCase().includes('open'));

  if (openDoors.length > 0) {
    return {
      icon: <DoorOpen className="h-3.5 w-3.5" />,
      title: `Door open: ${openDoors.join(', ')}`,
      color: '#f59e0b',
    };
  }
  if (ev.sentry_mode) {
    return {
      icon: <Eye className="h-3.5 w-3.5" />,
      title: 'Sentry Mode activated',
      color: '#06b6d4',
    };
  }
  if (ev.sentry_mode === false) {
    return {
      icon: <EyeOff className="h-3.5 w-3.5" />,
      title: 'Sentry Mode deactivated',
      color: '#6b7280',
    };
  }
  if (ev.locked) {
    return {
      icon: <Lock className="h-3.5 w-3.5" />,
      title: 'Vehicle locked',
      color: '#22c55e',
    };
  }
  if (ev.locked === false) {
    return {
      icon: <Unlock className="h-3.5 w-3.5" />,
      title: 'Vehicle unlocked',
      color: '#ef4444',
    };
  }
  return {
    icon: <DoorClosed className="h-3.5 w-3.5" />,
    title: 'Security state updated',
    color: '#8b5cf6',
  };
}

function formatEventTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function buildSubtitle(ev: SecurityEvent): string {
  const parts: string[] = [];
  if (ev.locked != null) parts.push(ev.locked ? '🔒 Locked' : '🔓 Unlocked');
  if (ev.sentry_mode != null) parts.push(ev.sentry_mode ? '🛡️ Sentry On' : 'Sentry Off');
  return parts.join(' · ') || '—';
}

export default function SentryEventLogWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;
  const eventLimit = isWide ? 10 : isTall ? 7 : 4;

  const { data: events, isLoading } = useQuery({
    queryKey: ['security-events', id, `sentry-log-${eventLimit}`],
    queryFn: () => request<SecurityEvent[]>(`/security?vehicle_id=${id}&limit=${eventLimit}`),
    enabled: id > 0,
    refetchInterval: 30_000,
  });

  const items = useMemo(() => events ?? [], [events]);

  return (
    <WidgetShell
      title={t('widget.sentryEventLog', 'Sentry Event Log')}
      icon={<Shield className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
    >
      <div className="space-y-0 overflow-y-auto h-full">
        {items.length > 0 ? (
          items.map((ev, i) => {
            const derived = deriveEvent(ev);
            return (
              <TimelineItem
                key={ev.id}
                icon={derived.icon}
                title={derived.title}
                subtitle={isWide ? buildSubtitle(ev) : undefined}
                time={formatEventTime(ev.created_at)}
                color={derived.color}
                isLast={i === items.length - 1}
              />
            );
          })
        ) : (
          <EmptyState
            icon={<Shield className="h-5 w-5" />}
            message={t('widget.noSentryEvents', 'No security events recorded')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
