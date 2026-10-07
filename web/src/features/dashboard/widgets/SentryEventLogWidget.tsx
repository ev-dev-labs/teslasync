import { useMemo, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQuery } from '@tanstack/react-query';
import { Shield, Lock, Unlock, Eye, EyeOff, DoorOpen, DoorClosed } from 'lucide-react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import type { SecurityEvent } from '@/api/types';
import { asNonEmptyString } from '@/lib/typeGuards';
import { parseEnumBool } from '@/lib/parseEnums';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed, type EventFeedItem } from './shared';
import type { WidgetProps } from './types';

export interface DerivedEvent {
  icon: ReactNode;
  title: string;
  /** Compact lock + sentry summary, rendered as the row subtitle on wide widgets. */
  subtitle: string;
  color: string;
  severity: EventFeedItem['severity'];
}

/**
 * Derive the display metadata (icon, human title, compact lock/sentry subtitle,
 * accent colour and severity) for one security snapshot.
 *
 * `sentry_mode` is the subtle one: the Fleet Telemetry pipeline serialises it as
 * a Tesla enum STRING ("Off" / "Armed" / "SentryModeStateOff") — or, for some
 * vehicles, a native boolean — never a plain JS boolean. A naive truthy test
 * (`if (ev.sentry_mode)`) therefore treats the *string* "Off" as ON and can
 * never reach an `=== false` branch. We route every shape through
 * `parseEnumBool` (false for "Off"/""/"false"/"0"/0/null, true otherwise) and
 * use the type guards to tell "present but off" apart from "field absent" so an
 * absent sentry signal falls through to the lock branches instead of being
 * mislabelled "deactivated".
 */
export function deriveEvent(ev: SecurityEvent, t: TFunction): DerivedEvent {
  const doorRaw = asNonEmptyString(ev.door_state) ?? '';
  const openDoors = doorRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.toLowerCase().includes('open'));

  const lockPresent = ev.locked != null;
  const isLocked = ev.locked === true;
  const sentryPresent = typeof ev.sentry_mode === 'boolean' || asNonEmptyString(ev.sentry_mode) !== null;
  const sentryOn = parseEnumBool(ev.sentry_mode);

  const parts: string[] = [];
  if (lockPresent) {
    parts.push(
      isLocked
        ? t('widget.sentryLog.lockedChip', '🔒 Locked')
        : t('widget.sentryLog.unlockedChip', '🔓 Unlocked'),
    );
  }
  if (sentryPresent) {
    parts.push(
      sentryOn
        ? t('widget.sentryLog.sentryOnChip', '🛡️ Sentry On')
        : t('widget.sentryLog.sentryOffChip', 'Sentry Off'),
    );
  }
  const subtitle = parts.join(' · ') || '—';

  let icon: ReactNode;
  let title: string;
  let color: string;
  let severity: EventFeedItem['severity'];

  if (openDoors.length > 0) {
    icon = <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" />;
    title = t('widget.sentryLog.doorOpen', 'Door open: {{doors}}', { doors: openDoors.join(', ') });
    color = '#f59e0b';
    severity = 'warning';
  } else if (sentryPresent && sentryOn) {
    icon = <Eye className="h-3.5 w-3.5" aria-hidden="true" />;
    title = t('widget.sentryLog.sentryActivated', 'Sentry Mode activated');
    color = '#06b6d4';
    severity = 'info';
  } else if (sentryPresent) {
    icon = <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />;
    title = t('widget.sentryLog.sentryDeactivated', 'Sentry Mode deactivated');
    color = '#6b7280';
    severity = 'info';
  } else if (isLocked) {
    icon = <Lock className="h-3.5 w-3.5" aria-hidden="true" />;
    title = t('widget.sentryLog.vehicleLocked', 'Vehicle locked');
    color = '#22c55e';
    severity = 'info';
  } else if (ev.locked === false) {
    icon = <Unlock className="h-3.5 w-3.5" aria-hidden="true" />;
    title = t('widget.sentryLog.vehicleUnlocked', 'Vehicle unlocked');
    color = '#ef4444';
    severity = 'critical';
  } else {
    icon = <DoorClosed className="h-3.5 w-3.5" aria-hidden="true" />;
    title = t('widget.sentryLog.securityUpdated', 'Security state updated');
    color = '#8b5cf6';
    severity = 'info';
  }

  return { icon, title, subtitle, color, severity };
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
      const derived = deriveEvent(ev, t);
      return {
        id: ev.id ?? `${ev.vehicle_id}-${ev.ts}-${ev.event_type}`,
        icon: derived.icon,
        title: derived.title,
        subtitle: isWide ? derived.subtitle : undefined,
        timestamp: ev.created_at ?? ev.ts,
        color: derived.color,
        severity: derived.severity,
      };
    });
  }, [events, isWide, t]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <WidgetShell
      title={t('widget.sentryEventLog', 'Sentry Event Log')}
      icon={<Shield className="h-3.5 w-3.5 text-neon-cyan" aria-hidden="true" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetEventFeed
        items={feedItems}
        maxItems={eventLimit}
        emptyMessage={
          isError
            ? t('widget.sentryEventsError', 'Failed to load security events')
            : t('widget.noSentryEvents', 'No security events recorded')
        }
        emptyIcon={<Shield className="h-5 w-5" aria-hidden="true" />}
      />
    </WidgetShell>
  );
}
