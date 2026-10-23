import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield, ShieldAlert, ShieldCheck, ShieldOff,
  CarFront, Unlock, Siren, Eye, FlaskConical, Move, Volume2,
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import { useGuardConfig, useGuardEvents, useGuardPanic, isGuardEventAcknowledged } from '@/api/hooks/useGuard';
import type { GuardEvent } from '@/api/hooks/useGuard';
import { useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

// ── Event type → visual mapping ──────────────────────────────────────

// Lookup-with-fallback so unknown backend event types render with a
// neutral icon instead of crashing or rendering as `undefined`. Legacy alert
// shapes are preserved so historic rows still resolve.
const EVENT_TYPE_MAP: Record<
  string,
  { icon: React.ReactNode; label: string; color: string; severity: EventFeedItem['severity'] }
> = {
  vehicle_moved:       { icon: <Move className="h-3.5 w-3.5" />,        label: 'Vehicle moved',       color: '#f59e0b', severity: 'warning' },
  unauthorized_unlock: { icon: <Unlock className="h-3.5 w-3.5" />,      label: 'Unauthorized unlock', color: '#ef4444', severity: 'critical' },
  unauthorized_drive:  { icon: <CarFront className="h-3.5 w-3.5" />,    label: 'Unauthorized drive',  color: '#ef4444', severity: 'critical' },
  sentry_triggered:    { icon: <Eye className="h-3.5 w-3.5" />,         label: 'Sentry triggered',    color: '#06b6d4', severity: 'warning' },
  manual_panic:        { icon: <Siren className="h-3.5 w-3.5" />,       label: 'Panic alert',         color: '#ef4444', severity: 'critical' },
  test_alert:          { icon: <FlaskConical className="h-3.5 w-3.5" />,label: 'Test alert',          color: '#8b5cf6', severity: 'info' },
  locked:              { icon: <ShieldCheck className="h-3.5 w-3.5" />, label: 'Lock state changed',  color: '#06b6d4', severity: 'info' },
  sentry_mode:         { icon: <Eye className="h-3.5 w-3.5" />,         label: 'Sentry mode',         color: '#f59e0b', severity: 'warning' },
  valet_mode_enabled:  { icon: <ShieldAlert className="h-3.5 w-3.5" />, label: 'Valet mode',          color: '#06b6d4', severity: 'info' },
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
    title: known ? t(`widget.guardEvent.${eventType}`, mapped.label) : mapped.label,
    subtitle: isGuardEventAcknowledged(ev)
      ? t('widget.guardAcknowledged', 'Acknowledged')
      : t('widget.guardUnacknowledged', 'Unacknowledged'),
    timestamp: ev.ts,
    color: mapped.color,
    severity: mapped.severity,
    wrap: true,
  };
}

// ── Compact layout (1×2) ─────────────────────────────────────────────

function CompactView({
  enabled,
  eventCount,
  autoPanic,
  onPanic,
  panicPending,
  panicDisabled,
  t,
}: {
  enabled: boolean | null;
  eventCount: number | null;
  autoPanic: boolean | null;
  onPanic: () => void;
  panicPending: boolean;
  panicDisabled: boolean;
  t: (key: string, fallback: string) => string;
}) {
  const { fmtInt } = useNumberFormatting();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 min-h-[44px]">
        <div className="flex items-center gap-2 min-w-0">
          {enabled ? (
            <ShieldCheck className="h-4 w-4 flex-shrink-0" />
          ) : (
            <ShieldOff className="h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />
          )}
          <Badge variant={enabled ? 'success' : 'neutral'}>
            {enabled === null ? t('widget.guardUnknown', 'Unknown')
              : enabled ? t('widget.guardArmed', 'Armed') : t('widget.guardDisarmed', 'Disarmed')}
          </Badge>
        </div>
        <Badge variant={eventCount !== null && eventCount > 0 ? 'warning' : 'neutral'}>
          {eventCount === null ? '—' : fmtInt(eventCount)} {t('widget.guardEvents', 'events')}
        </Badge>
      </div>
      <Button variant="danger" size="sm" onClick={onPanic} loading={panicPending}
        disabled={enabled === null || panicPending || panicDisabled} className="w-full">
        <Volume2 className="h-4 w-4" aria-hidden="true" />
        {panicPending ? t('widget.guardPanicSending', 'Sending…') : t('widget.guardPanicAlarm', 'Panic alarm')}
      </Button>
      {autoPanic !== null && (
        <span className="text-xs text-[var(--text-muted)]">
          {t('widget.guardAutoPanic', 'Auto-panic')}: {autoPanic ? t('widget.guardOn', 'On') : t('widget.guardOff', 'Off')}
        </span>
      )}
    </div>
  );
}

// ── Standard layout (2×4) ────────────────────────────────────────────

function StandardView({
  enabled,
  autoPanic,
  feedItems,
  eventsError,
  eventsLoading,
  onRetryEvents,
  onPanic,
  panicPending,
  panicDisabled,
  t,
}: {
  enabled: boolean | null;
  autoPanic: boolean | null;
  feedItems: EventFeedItem[];
  eventsError: Error | null;
  eventsLoading: boolean;
  onRetryEvents: () => void;
  onPanic: () => void;
  panicPending: boolean;
  panicDisabled: boolean;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {enabled ? (
            <ShieldCheck className="h-5 w-5 flex-shrink-0" />
          ) : (
            <ShieldOff className="h-5 w-5 flex-shrink-0 text-[var(--text-muted)]" />
          )}
          <div className="min-w-0">
            <p className={dashboardTokens.metric}>
              {enabled === null ? t('widget.guardUnknown', 'Unknown')
                : enabled ? t('widget.guardArmed', 'Armed') : t('widget.guardDisarmed', 'Disarmed')}
            </p>
            {autoPanic !== null && (
              <p className="text-xs text-[var(--text-muted)]">
                {t('widget.guardAutoPanic', 'Auto-panic')}: {autoPanic ? t('widget.guardOn', 'On') : t('widget.guardOff', 'Off')}
              </p>
            )}
          </div>
        </div>
        {enabled === true && (
          <Badge variant="success">{t('widget.guardProtected', 'Protected')}</Badge>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {eventsError ? <QueryError error={eventsError} onRetry={onRetryEvents} />
          : eventsLoading ? <Skeleton className="h-16" /> : <WidgetEventFeed
          items={feedItems}
          maxItems={1}
          compact={false}
          emptyMessage={t('widget.guardNoEvents', 'No guard events')}
          emptyIcon={<Shield className="h-5 w-5" />}
        />}
      </div>
      <Button variant="danger" size="sm" onClick={onPanic} loading={panicPending}
        disabled={enabled === null || panicPending || panicDisabled}
        className="w-full">
        <Volume2 className="h-4 w-4" aria-hidden="true" />
        {panicPending ? t('widget.guardPanicSending', 'Sending…') : t('widget.guardPanicAlarm', 'Panic alarm')}
      </Button>
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function GuardModeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehicleQuery = useVehicles();
  const { data: vehicles } = vehicleQuery;
  const vehicleState = useDataState(vehicleQuery);
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const configQuery = useGuardConfig(id);
  const {
    data: config,
    isLoading: configLoading,
    isFetching: configFetching,
    isStale: configStale,
    isError: configError,
    dataUpdatedAt: configUpdatedAt,
    refetch: refetchConfig,
  } = configQuery;
  const configState = useDataState(configQuery);

  const eventsQuery = useGuardEvents(id);
  const {
    data: events,
    isLoading: eventsLoading,
    isFetching: eventsFetching,
    isStale: eventsStale,
    isError: eventsError,
    dataUpdatedAt: eventsUpdatedAt,
    refetch: refetchEvents,
  } = eventsQuery;
  const eventsState = useDataState(eventsQuery, { provenance: 'historical' });
  const combined = combineDataStates([configState, eventsState]);
  const panicMutation = useGuardPanic();

  const isCompact = size.cols <= 1;

  const feedItems = useMemo<EventFeedItem[]>(
    () => (events ?? []).map((ev) => mapEventToFeedItem(ev, t)),
    [events, t],
  );

  const isLoading = configLoading || eventsLoading;
  const isFetching = configFetching || eventsFetching;
  const isStale = configStale || eventsStale;
  const isError = configError || eventsError;
  // Configuration and event history degrade independently; neither hides the other.
  const updatedAt = combined.updatedAt ?? Math.min(configUpdatedAt ?? 0, eventsUpdatedAt ?? 0);

  const enabled = config?.enabled ?? null;
  const autoPanic = config?.auto_panic ?? null;
  const eventCount = events === undefined ? null : events.length;

  return (
    <WidgetShell
      title={t('widget.guardMode', 'Guard mode')}
      icon={<Shield className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={isLoading}
      dataState={id === 0 && (vehicleState.fatalError || vehicleQuery.isLoading) ? vehicleState : {
        ...configState, ...combined,
        hasData: configState.hasData || eventsState.hasData,
        retry: () => { void refetchConfig(); void refetchEvents(); },
        status: combined.status === 'initial' && !isLoading ? 'unavailable' : combined.status,
      }}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => { refetchConfig(); refetchEvents(); }}
    >
      {configState.fatalError ? <QueryError error={configState.fatalError} onRetry={() => { void refetchConfig(); }} /> : configLoading && !config ? <Skeleton className="h-16" /> : config ? (
        isCompact ? (
          <CompactView enabled={enabled} eventCount={eventCount} autoPanic={autoPanic}
            onPanic={() => panicMutation.mutate(id)} panicPending={panicMutation.isPending}
            panicDisabled={id === 0} t={t} />
        ) : (
          <StandardView
            enabled={enabled}
            autoPanic={autoPanic}
            feedItems={feedItems}
            eventsError={eventsState.fatalError}
            eventsLoading={eventsLoading && events === undefined}
            onRetryEvents={() => { void refetchEvents(); }}
            onPanic={() => panicMutation.mutate(id)}
            panicPending={panicMutation.isPending}
            panicDisabled={id === 0}
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
      {!config && (eventsState.fatalError ? (
        <QueryError error={eventsState.fatalError} onRetry={() => { void refetchEvents(); }} />
      ) : eventsLoading && events === undefined ? <Skeleton className="h-16" /> : !config && (
        <WidgetEventFeed items={feedItems} maxItems={5} emptyMessage={t('widget.guardNoEvents', 'No guard events')} />
      ))}
    </WidgetShell>
  );
}
