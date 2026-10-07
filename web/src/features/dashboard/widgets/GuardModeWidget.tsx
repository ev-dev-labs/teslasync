import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield, ShieldAlert, ShieldCheck, ShieldOff,
  CarFront, Unlock, Siren, Eye, FlaskConical, Move,
} from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useGuardConfig, useGuardEvents, isGuardEventAcknowledged } from '@/api/hooks/useGuard';
import type { GuardEvent } from '@/api/hooks/useGuard';
import { useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';
import { fmtInt } from '@/lib/numberFormat';

// ── Event type → visual mapping ──────────────────────────────────────

// Lookup-with-fallback so unknown backend event types render with a
// neutral icon instead of crashing or rendering as `undefined`. Legacy alert
// shapes are preserved so historic rows still resolve.
const EVENT_TYPE_MAP: Record<
  string,
  { icon: React.ReactNode; label: string; color: string; severity: EventFeedItem['severity'] }
> = {
  vehicle_moved:       { icon: <Move className="h-3.5 w-3.5" />,        label: 'Vehicle Moved',       color: '#f59e0b', severity: 'warning' },
  unauthorized_unlock: { icon: <Unlock className="h-3.5 w-3.5" />,      label: 'Unauthorized Unlock', color: '#ef4444', severity: 'critical' },
  unauthorized_drive:  { icon: <CarFront className="h-3.5 w-3.5" />,    label: 'Unauthorized Drive',  color: '#ef4444', severity: 'critical' },
  sentry_triggered:    { icon: <Eye className="h-3.5 w-3.5" />,         label: 'Sentry Triggered',    color: '#06b6d4', severity: 'warning' },
  manual_panic:        { icon: <Siren className="h-3.5 w-3.5" />,       label: 'Panic Alert',         color: '#ef4444', severity: 'critical' },
  test_alert:          { icon: <FlaskConical className="h-3.5 w-3.5" />,label: 'Test Alert',          color: '#8b5cf6', severity: 'info' },
  locked:              { icon: <ShieldCheck className="h-3.5 w-3.5" />, label: 'Lock State Changed',  color: '#06b6d4', severity: 'info' },
  sentry_mode:         { icon: <Eye className="h-3.5 w-3.5" />,         label: 'Sentry Mode',         color: '#f59e0b', severity: 'warning' },
  valet_mode_enabled:  { icon: <ShieldAlert className="h-3.5 w-3.5" />, label: 'Valet Mode',          color: '#06b6d4', severity: 'info' },
};

function mapEventToFeedItem(ev: GuardEvent, t: (key: string, fallback: string) => string): EventFeedItem {
  // `event_type` is a free-form backend string. Guard the lookup with
  // `hasOwnProperty` so a value that collides with an Object.prototype member
  // (e.g. "toString", "constructor") resolves to the neutral fallback instead
  // of an inherited method — which would otherwise surface an `undefined`
  // icon/color and a raw i18n key as the title.
  const eventType = ev.event_type ?? '';
  const known = Object.prototype.hasOwnProperty.call(EVENT_TYPE_MAP, eventType)
    ? EVENT_TYPE_MAP[eventType]
    : undefined;
  const mapped = known ?? {
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
    label: eventType || '—',
    color: '#6b7280',
    severity: 'info' as const,
  };

  return {
    id: ev.id,
    icon: mapped.icon,
    title: t(`widget.guardEvent.${eventType}`, mapped.label),
    subtitle: isGuardEventAcknowledged(ev)
      ? t('widget.guardAcknowledged', 'Acknowledged')
      : t('widget.guardUnacknowledged', 'Unacknowledged'),
    timestamp: ev.ts,
    color: mapped.color,
    severity: mapped.severity,
  };
}

// ── Compact layout (1×2) ─────────────────────────────────────────────

function CompactView({
  enabled,
  eventCount,
  t,
}: {
  enabled: boolean;
  eventCount: number;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 min-h-[44px]">
      <div className="flex items-center gap-2 min-w-0">
        {enabled ? (
          <ShieldCheck className="h-4 w-4 flex-shrink-0 text-neon-green" />
        ) : (
          <ShieldOff className="h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />
        )}
        <Badge variant={enabled ? 'success' : 'neutral'}>
          {enabled ? t('widget.guardArmed', 'Armed') : t('widget.guardDisarmed', 'Disarmed')}
        </Badge>
      </div>
      <Badge variant={eventCount > 0 ? 'warning' : 'neutral'}>
        {fmtInt(eventCount)} {t('widget.guardEvents', 'events')}
      </Badge>
    </div>
  );
}

// ── Standard layout (2×4) ────────────────────────────────────────────

function StandardView({
  enabled,
  sensitivity,
  autoPanic,
  feedItems,
  isCompact,
  t,
}: {
  enabled: boolean;
  sensitivity: string;
  autoPanic: boolean;
  feedItems: EventFeedItem[];
  isCompact: boolean;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Status card */}
      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {enabled ? (
            <ShieldCheck className="h-5 w-5 flex-shrink-0 text-neon-green" />
          ) : (
            <ShieldOff className="h-5 w-5 flex-shrink-0 text-[var(--text-muted)]" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {enabled ? t('widget.guardArmed', 'Armed') : t('widget.guardDisarmed', 'Disarmed')}
            </p>
            <p className="text-xs text-[var(--text-muted)] truncate">
              {t('widget.guardSensitivity', 'Sensitivity')}: {sensitivity ?? '—'}
              {autoPanic ? ` · ${t('widget.guardAutoPanic', 'Auto-panic')}` : ''}
            </p>
          </div>
        </div>
        <Badge variant={enabled ? 'success' : 'neutral'}>
          {enabled ? t('widget.guardOn', 'ON') : t('widget.guardOff', 'OFF')}
        </Badge>
      </div>

      {/* Event feed */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <WidgetEventFeed
          items={feedItems}
          maxItems={isCompact ? 3 : 5}
          compact={isCompact}
          emptyMessage={t('widget.guardNoEvents', 'No guard events')}
          emptyIcon={<Shield className="h-5 w-5" />}
        />
      </div>
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function GuardModeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: config,
    isLoading: configLoading,
    isFetching: configFetching,
    isStale: configStale,
    isError: configError,
    error: configErr,
    dataUpdatedAt: configUpdatedAt,
    refetch: refetchConfig,
  } = useGuardConfig(id);

  const {
    data: events,
    isLoading: eventsLoading,
    isFetching: eventsFetching,
    isStale: eventsStale,
    isError: eventsError,
    dataUpdatedAt: eventsUpdatedAt,
    refetch: refetchEvents,
  } = useGuardEvents(id);

  const isCompact = size.cols <= 1;

  const feedItems = useMemo<EventFeedItem[]>(
    () => (events ?? []).map((ev) => mapEventToFeedItem(ev, t)),
    [events, t],
  );

  const isLoading = configLoading || eventsLoading;
  const isFetching = configFetching || eventsFetching;
  const isStale = configStale || eventsStale;
  const isError = configError || eventsError;
  // Only blank the whole widget on an INITIAL config load failure — i.e. when
  // there is no cached config to fall back on. The widget polls on an interval,
  // so once a config is on screen a transient background-refetch error must not
  // wipe the panel; it is surfaced through the freshness indicator's error
  // state instead (WidgetShell forwards `isError` to <DataFreshness>).
  const blockingError = !config && configErr ? String(configErr) : null;
  const updatedAt = Math.max(configUpdatedAt ?? 0, eventsUpdatedAt ?? 0);

  const enabled = config?.enabled ?? false;
  const sensitivity = config?.sensitivity ?? '—';
  const autoPanic = config?.auto_panic ?? false;
  const eventCount = (events ?? []).length;

  return (
    <WidgetShell
      title={t('widget.guardMode', 'Guard Mode')}
      icon={<Shield className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      error={blockingError}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => { refetchConfig(); refetchEvents(); }}
    >
      {config ? (
        isCompact ? (
          <CompactView enabled={enabled} eventCount={eventCount} t={t} />
        ) : (
          <StandardView
            enabled={enabled}
            sensitivity={sensitivity}
            autoPanic={autoPanic}
            feedItems={feedItems}
            isCompact={isCompact}
            t={t}
          />
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Shield className="h-5 w-5" />}
          message={t('widget.noGuardData', 'No guard data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
