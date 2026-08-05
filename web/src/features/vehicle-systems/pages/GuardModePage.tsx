import { useState, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  Siren,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
  Car,
  Eye,
  Info,
  Gauge,
  Bell,
  History,
  SlidersHorizontal,
  Activity,
  type LucideIcon,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel,
  Button,
  Select,
  Toggle,
  Badge,
  ConfirmDialog,
  PanelTitle,
  Text,
  HelperText,
} from '@/components/ui';
import { MetricCard, TimeStamp } from '@/components/data-display';
import { EmptyState, AlertBanner, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { VehicleSelect } from '@/components/forms';
import {
  MapContainer,
  Marker,
  Circle,
  Popup,
  Polyline,
  vehicleIcon,
  MapTileLayer,
  MapInvalidator,
  type MapStyle,
} from '@/components/maps';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicleState } from '@/api/hooks/useVehicles';
import { useGeofences } from '@/api/hooks/useLocations';
import {
  useGuardConfig,
  useGuardEvents,
  useSetGuardConfig,
  useGuardPanic,
  useAcknowledgeGuardEvent,
  isGuardEventAcknowledged,
  type GuardEvent,
} from '@/api/hooks/useGuard';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { typography, type NeonColor } from '@/lib/tokens';

// ── Event type display metadata ─────────────────────────────────────────
//
// `/vehicles/{id}/guard/events` returns state-change records derived from
// `security_events` (`locked`, `sentry_mode`, `valet_mode_enabled` — see
// `securityEventTypeByField` in the security_event_writer). Legacy
// alert-shaped entries (`vehicle_moved`, `unauthorized_*`) are kept so
// historic rows still render, and the lookup-with-fallback pattern makes
// any newly-added backend type render as its raw token without crashing.

type BadgeVariant = 'danger' | 'warning' | 'info';

const EVENT_BADGE_VARIANT: Record<string, BadgeVariant> = {
  vehicle_moved: 'danger',
  unauthorized_unlock: 'danger',
  unauthorized_drive: 'danger',
  sentry_triggered: 'warning',
  manual_panic: 'danger',
  test_alert: 'info',
  locked: 'info',
  sentry_mode: 'warning',
  valet_mode_enabled: 'info',
};

// [i18nKey, English fallback] — the English lives only as the sanctioned
// `t(key, fallback)` default, never as raw rendered text.
const EVENT_LABEL_KEYS: Record<string, [string, string]> = {
  vehicle_moved: ['guard.eventVehicleMoved', 'Vehicle Moved'],
  unauthorized_unlock: ['guard.eventUnauthorizedUnlock', 'Unauthorized Unlock'],
  unauthorized_drive: ['guard.eventUnauthorizedDrive', 'Unauthorized Drive'],
  sentry_triggered: ['guard.eventSentryTriggered', 'Sentry Triggered'],
  manual_panic: ['guard.eventManualPanic', 'Manual Panic'],
  test_alert: ['guard.eventTestAlert', 'Test Alert'],
  locked: ['guard.eventLocked', 'Lock State Changed'],
  sentry_mode: ['guard.eventSentryMode', 'Sentry Mode'],
  valet_mode_enabled: ['guard.eventValetMode', 'Valet Mode'],
};

function eventLabelKey(type: string): [string, string] {
  return EVENT_LABEL_KEYS[type] ?? [`guard.event.${type}`, type];
}

// ── Guard Mode Page ─────────────────────────────────────────────────────

export default function GuardModePage() {
  const { t } = useTranslation();
  usePageTitle(t('guard.title', 'Guard Mode'));

  // Vehicle selector — global, shared across all vehicle-scoped pages.
  const { vehicleId, vehicle: activeVehicle } = useSelectedVehicle();
  const activeVehicleId = vehicleId ?? 0;

  // Guard data (keep the full query objects so each panel owns its state).
  const configQuery = useGuardConfig(activeVehicleId);
  const eventsQuery = useGuardEvents(activeVehicleId);
  const guardConfig = configQuery.data;
  const vehicleStateQuery = useVehicleState(activeVehicleId, {
    refetchInterval: guardConfig?.enabled ? 5_000 : 30_000,
  });
  const { data: geofences } = useGeofences();

  // Mutations
  const setConfig = useSetGuardConfig();
  const panic = useGuardPanic();
  const ackEvent = useAcknowledgeGuardEvent();

  // Local (draft) state — falls back to the persisted config.
  const [panicDialogOpen, setPanicDialogOpen] = useState(false);
  const [sensitivity, setSensitivity] = useState<string>('');
  const [homeGeofenceId, setHomeGeofenceId] = useState<string>('');
  // `null` = "untouched, follow the persisted config"; a boolean = an explicit
  // user choice. A plain `false` default made the toggle diverge from what got
  // saved: the checkbox showed `draft || persisted` but the mutation sent the
  // draft alone, so a persisted `auto_panic: true` silently reset to `false` on
  // Save and the switch could never be turned back off. Mirror the sensitivity/
  // geofence "effective draft" pattern instead.
  const [autoPanic, setAutoPanic] = useState<boolean | null>(null);

  const effectiveSensitivity = sensitivity || guardConfig?.sensitivity || 'medium';
  const effectiveHomeGeofenceId =
    homeGeofenceId || (guardConfig?.home_geofence_id != null ? String(guardConfig.home_geofence_id) : '');
  const effectiveAutoPanic = autoPanic ?? guardConfig?.auto_panic ?? false;

  // Derived data
  const isArmed = guardConfig?.enabled ?? false;
  const events = eventsQuery.data ?? [];
  const unacknowledgedCount = events.filter((e) => !isGuardEventAcknowledged(e)).length;
  const latestEvent = events[0] ?? null;
  const isTriggered =
    latestEvent != null && !isGuardEventAcknowledged(latestEvent) && latestEvent.event_type !== 'test_alert';

  const state = vehicleStateQuery.data?.state ?? vehicleStateQuery.data;
  const vehicleLat = (state as Record<string, unknown>)?.latitude as number | undefined;
  const vehicleLng = (state as Record<string, unknown>)?.longitude as number | undefined;
  const hasLocation = vehicleLat != null && vehicleLng != null && vehicleLat !== 0 && vehicleLng !== 0;
  const isLocked = Boolean((state as Record<string, unknown>)?.is_locked);
  const sentryOn = Boolean((state as Record<string, unknown>)?.sentry_mode);

  const homeGeofence = geofences?.find((g) => String(g.id) === effectiveHomeGeofenceId) ?? null;

  const geofenceOptions = useMemo(
    () => [
      { value: '', label: t('guard.noGeofence', '— No home geofence —') },
      ...(geofences ?? []).map((g) => ({ value: String(g.id), label: g.name })),
    ],
    [geofences, t],
  );

  const sensitivityOptions = useMemo(
    () => [
      { value: 'low', label: t('guard.sensitivityLowFull', 'Low — Movement > 1 km') },
      { value: 'medium', label: t('guard.sensitivityMediumFull', 'Medium — Movement > 200 m') },
      { value: 'high', label: t('guard.sensitivityHighFull', 'High — Any movement') },
    ],
    [t],
  );

  // ── Labels ──────────────────────────────────────────────────────────
  const stateLabel = isTriggered
    ? t('guard.triggered', 'Triggered')
    : isArmed
    ? t('guard.armed', 'Armed')
    : t('guard.disarmed', 'Disarmed');
  const stateColor: NeonColor = isTriggered ? 'red' : isArmed ? 'green' : 'amber';
  const StateIcon: LucideIcon = isTriggered ? ShieldAlert : isArmed ? ShieldCheck : ShieldOff;
  const LockIcon: LucideIcon = isLocked ? Lock : Unlock;
  const sensitivityLabel =
    effectiveSensitivity === 'low'
      ? t('guard.sensitivityLow', 'Low')
      : effectiveSensitivity === 'high'
      ? t('guard.sensitivityHigh', 'High')
      : t('guard.sensitivityMedium', 'Medium');

  // ── Handlers ────────────────────────────────────────────────────────
  const handleToggleGuard = () => {
    if (activeVehicleId <= 0) return;
    setConfig.mutate({
      vehicleId: activeVehicleId,
      enabled: !isArmed,
      home_geofence_id: effectiveHomeGeofenceId ? Number(effectiveHomeGeofenceId) : null,
      sensitivity: effectiveSensitivity,
      auto_panic: effectiveAutoPanic,
    });
  };

  const handleSaveSettings = () => {
    if (activeVehicleId <= 0) return;
    setConfig.mutate({
      vehicleId: activeVehicleId,
      enabled: isArmed,
      home_geofence_id: effectiveHomeGeofenceId ? Number(effectiveHomeGeofenceId) : null,
      sensitivity: effectiveSensitivity,
      auto_panic: effectiveAutoPanic,
    });
  };

  const handlePanic = () => {
    setPanicDialogOpen(false);
    if (activeVehicleId > 0) panic.mutate(activeVehicleId);
  };

  const handleAcknowledge = (eventId: number) => {
    if (activeVehicleId > 0) ackEvent.mutate({ vehicleId: activeVehicleId, eventId });
  };

  const noVehicle = activeVehicleId <= 0;
  const kpiLoading = configQuery.isLoading && !guardConfig;

  const labelForEvent = (type: string) => {
    const [key, fallback] = eventLabelKey(type);
    return t(key, fallback);
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <PageContainer
      title={t('guard.title', 'Guard Mode')}
      subtitle={t('guard.subtitle', 'Anti-theft monitoring and emergency response')}
      actions={<VehicleSelect />}
      query={configQuery}
    >
      {/* Triggered alert banner */}
      {isTriggered && latestEvent && (
        <AlertBanner
          variant="danger"
          title={t('guard.alertTriggered', 'Guard Alert Triggered!')}
          icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
        >
          <Text as="p" variant="bodySm">
            {labelForEvent(latestEvent.event_type)} {'— '}
            <TimeStamp value={latestEvent.ts} />
          </Text>
        </AlertBanner>
      )}

      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        {kpiLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={84} className="rounded-xl" />
            ))}
          </div>
        ) : (
          <section
            aria-label={t('guard.overview', 'Guard status overview')}
            className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
          >
            <MetricCard
              label={t('guard.kpiState', 'Guard State')}
              value={stateLabel}
              icon={<StateIcon className="h-5 w-5" aria-hidden="true" />}
              color={stateColor}
            />
            <MetricCard
              label={t('guard.kpiSentry', 'Sentry Mode')}
              value={sentryOn ? t('guard.on', 'On') : t('guard.off', 'Off')}
              icon={<Eye className="h-5 w-5" aria-hidden="true" />}
              color={sentryOn ? 'green' : 'cyan'}
            />
            <MetricCard
              label={t('guard.kpiLock', 'Lock State')}
              value={isLocked ? t('guard.locked', 'Locked') : t('guard.unlocked', 'Unlocked')}
              icon={<LockIcon className="h-5 w-5" aria-hidden="true" />}
              color={isLocked ? 'green' : 'amber'}
            />
            <MetricCard
              label={t('guard.kpiSensitivity', 'Sensitivity')}
              value={sensitivityLabel}
              icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
              color="blue"
            />
            <MetricCard
              label={t('guard.kpiUnack', 'Unacknowledged')}
              value={unacknowledgedCount}
              icon={<Bell className="h-5 w-5" aria-hidden="true" />}
              color={unacknowledgedCount > 0 ? 'red' : 'green'}
            />
            <MetricCard
              label={t('guard.kpiTotal', 'Total Events')}
              value={events.length}
              icon={<History className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
          </section>
        )}
      </FadeIn>

      {/* 2 — Hero row: live map (spans) + control rail */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('guard.controlSection', 'Guard control and live location')}
          className="grid grid-cols-1 gap-4 xl:gap-5 xl:grid-cols-3"
        >
          {/* Live map — hero, spans two columns on wide screens */}
          <GlassPanel className="flex flex-col overflow-hidden p-0 xl:col-span-2">
            <div className="p-4 pb-0 sm:p-5 sm:pb-0">
              <PanelTitle className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('guard.liveMap', 'Live Vehicle Location')}
              </PanelTitle>
            </div>
            <div className="mt-3 h-80 flex-1 sm:h-96 xl:h-[32rem]">
              {vehicleStateQuery.isError ? (
                <div className="flex h-full items-center justify-center p-4">
                  <QueryError error={vehicleStateQuery.error} onRetry={() => vehicleStateQuery.refetch()} />
                </div>
              ) : vehicleStateQuery.isLoading && !state ? (
                <div className="h-full p-4">
                  <Skeleton height="100%" className="rounded-xl" />
                </div>
              ) : hasLocation ? (
                <LiveMap
                  vehicleLat={vehicleLat!}
                  vehicleLng={vehicleLng!}
                  vehicleName={activeVehicle?.display_name ?? ''}
                  homeGeofence={homeGeofence}
                  events={events}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <EmptyState
                    /* no-action: transient empty state — surfaces when the vehicle has no live position */
                    icon={<MapPin className="h-8 w-8" aria-hidden="true" />}
                    message={t('guard.noLocation', 'No vehicle location available')}
                  />
                </div>
              )}
            </div>
          </GlassPanel>

          {/* Control rail — arm/disarm + emergency panic */}
          <div className="flex flex-col gap-4 xl:gap-5">
            {/* Arm / Disarm */}
            <GlassPanel
              className={cn(
                'flex flex-col items-center justify-center gap-4 p-5 text-center transition-all duration-slow sm:p-6',
                isArmed && !isTriggered && 'ring-1 ring-emerald-500/30',
                isTriggered && 'ring-2 ring-red-500/50 animate-pulse',
              )}
            >
              <div
                className={cn(
                  'flex h-16 w-16 items-center justify-center rounded-full transition-all duration-normal',
                  isTriggered
                    ? 'bg-red-500/20 text-red-300'
                    : isArmed
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-[var(--surface-2)] text-[var(--text-muted)]',
                )}
              >
                <StateIcon className="h-8 w-8" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <Text as="p" variant="sectionTitle">
                  {stateLabel}
                </Text>
                <HelperText>
                  {isArmed
                    ? t('guard.armedHelp', 'Monitoring is active')
                    : t('guard.disarmedHelp', 'Guard monitoring is off')}
                </HelperText>
              </div>
              <Toggle
                label={t('guard.enableGuard', 'Guard Mode')}
                checked={isArmed}
                onChange={() => handleToggleGuard()}
              />
              {setConfig.isPending && (
                <Text as="span" variant="caption">
                  {t('guard.updating', 'Updating…')}
                </Text>
              )}
            </GlassPanel>

            {/* Emergency panic */}
            <GlassPanel className="flex flex-col items-center justify-center gap-3 p-5 text-center sm:p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-300">
                <Siren className="h-6 w-6" aria-hidden="true" />
              </div>
              <PanelTitle>{t('guard.emergency', 'Emergency')}</PanelTitle>
              <Button
                variant="danger"
                size="lg"
                onClick={() => setPanicDialogOpen(true)}
                loading={panic.isPending}
                disabled={panic.isPending || noVehicle}
                className="w-full"
              >
                <Siren className="h-4 w-4" aria-hidden="true" />
                {panic.isPending ? t('guard.panicking', 'Sending…') : t('guard.panicButton', 'Activate Panic')}
              </Button>
              <HelperText>
                {t(
                  'guard.panicDesc',
                  'Flash lights, honk horn, lock doors, enable sentry, and notify all channels',
                )}
              </HelperText>
            </GlassPanel>
          </div>
        </section>
      </FadeIn>

      {/* 3 — Settings (spans) + status bento */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('guard.configSection', 'Guard configuration and status')}
          className="grid grid-cols-1 gap-4 xl:gap-5 xl:grid-cols-3"
        >
          {/* Settings — two columns on wide screens */}
          <GlassPanel className="space-y-4 p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('guard.settings', 'Guard Settings')}
            </PanelTitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              <div className="space-y-1">
                <Select
                  label={t('guard.homeGeofence', 'Home Geofence')}
                  options={geofenceOptions}
                  value={effectiveHomeGeofenceId}
                  onChange={(e) => setHomeGeofenceId(e.target.value)}
                />
                <HelperText>
                  {t('guard.homeGeofenceHelp', 'Vehicle triggers an alert if it leaves this area')}
                </HelperText>
              </div>
              <div className="space-y-1">
                <Select
                  label={t('guard.sensitivity', 'Sensitivity')}
                  options={sensitivityOptions}
                  value={effectiveSensitivity}
                  onChange={(e) => setSensitivity(e.target.value)}
                />
                <HelperText>{t('guard.sensitivityHelp', 'How much movement counts as a trigger')}</HelperText>
              </div>
              <div className="flex flex-col justify-between gap-3">
                <div className="space-y-1">
                  <Toggle
                    label={t('guard.autoPanic', 'Auto-Panic on Trigger')}
                    checked={effectiveAutoPanic}
                    onChange={setAutoPanic}
                  />
                  <HelperText>
                    {t('guard.autoPanicHelp', 'Automatically run panic actions when guard is triggered')}
                  </HelperText>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSaveSettings} loading={setConfig.isPending} disabled={setConfig.isPending || noVehicle}>
                {t('guard.saveSettings', 'Save Settings')}
              </Button>
            </div>
          </GlassPanel>

          {/* Status list */}
          <GlassPanel className="space-y-3 p-4 sm:p-5">
            <PanelTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('guard.status', 'Status')}
            </PanelTitle>
            <ul className="space-y-2.5">
              <StatusRow icon={Clock}>
                {isArmed && guardConfig?.updated_at
                  ? t('guard.armedSince', 'Armed since {{time}}', { time: formatDateTime(guardConfig.updated_at) })
                  : t('guard.notArmed', 'Not armed')}
              </StatusRow>
              <StatusRow icon={LockIcon} tone={isLocked ? 'ok' : 'warn'}>
                {isLocked ? t('guard.vehicleLocked', 'Vehicle locked') : t('guard.vehicleUnlocked', 'Vehicle unlocked')}
              </StatusRow>
              <StatusRow icon={Eye} tone={sentryOn ? 'ok' : 'muted'}>
                {sentryOn ? t('guard.sentryActive', 'Sentry mode active') : t('guard.sentryInactive', 'Sentry mode off')}
              </StatusRow>
              <StatusRow icon={AlertTriangle} tone={unacknowledgedCount > 0 ? 'warn' : 'muted'}>
                {unacknowledgedCount > 0
                  ? t('guard.unackEvents', '{{count}} unacknowledged event(s)', { count: unacknowledgedCount })
                  : t('guard.noActiveAlerts', 'No active alerts')}
              </StatusRow>
            </ul>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 4 — Detail band: event timeline */}
      <FadeIn delay={0.15}>
        <GlassPanel className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PanelTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('guard.eventTimeline', 'Event Timeline')}
            </PanelTitle>
            {unacknowledgedCount > 0 && (
              <Badge variant="danger" size="sm">
                {t('guard.unackCount', '{{count}} unacknowledged', { count: unacknowledgedCount })}
              </Badge>
            )}
          </div>

          {eventsQuery.isError ? (
            <QueryError error={eventsQuery.error} onRetry={() => eventsQuery.refetch()} />
          ) : eventsQuery.isLoading && events.length === 0 ? (
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2 3xl:grid-cols-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} height={96} className="rounded-lg" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <EmptyState
              /* no-action: transient empty state — surfaces when the vehicle has no guard events yet */
              icon={<Info className="h-8 w-8" aria-hidden="true" />}
              message={t('guard.noEvents', 'No guard events yet')}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2 3xl:grid-cols-3">
              {events.map((ev) => (
                <EventCard key={ev.id} event={ev} onAcknowledge={handleAcknowledge} isAcking={ackEvent.isPending} />
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Panic confirmation dialog */}
      <ConfirmDialog
        open={panicDialogOpen}
        title={t('guard.panicConfirmTitle', 'Activate Panic Mode?')}
        message={t(
          'guard.panicConfirmMessage',
          'This will immediately flash lights, honk horn, lock doors, enable sentry mode, and send alerts to all notification channels.',
        )}
        confirmLabel={t('guard.panicConfirmLabel', 'Activate Panic')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="danger"
        loading={panic.isPending}
        onConfirm={handlePanic}
        onCancel={() => setPanicDialogOpen(false)}
      />
    </PageContainer>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

const STATUS_TONE = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  muted: 'text-[var(--text-muted)]',
} as const;

function StatusRow({
  icon: Icon,
  tone = 'muted',
  children,
}: {
  icon: LucideIcon;
  tone?: keyof typeof STATUS_TONE;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2.5">
      <Icon className={cn('h-4 w-4 shrink-0', STATUS_TONE[tone])} aria-hidden="true" />
      <Text as="span" variant="bodySm">
        {children}
      </Text>
    </li>
  );
}

function LiveMap({
  vehicleLat,
  vehicleLng,
  vehicleName,
  homeGeofence,
  events,
}: {
  vehicleLat: number;
  vehicleLng: number;
  vehicleName: string;
  homeGeofence: { latitude: number; longitude: number; radius: number; name: string } | null;
  events: GuardEvent[];
}) {
  const [mapStyle] = useState<MapStyle>('dark');

  // GuardEvent records are state-change rows sourced from security_events;
  // they no longer carry latitude/longitude, so the trail is empty and the
  // map shows only the live position + the home geofence circle.
  const eventPositions: [number, number][] = useMemo(() => [], [events]);

  return (
    <MapContainer center={[vehicleLat, vehicleLng]} zoom={15} scrollWheelZoom className="z-0 h-full w-full">
      <MapTileLayer style={mapStyle} />
      <MapInvalidator />

      <Marker position={[vehicleLat, vehicleLng]} icon={vehicleIcon()}>
        <MapPopup vehicleName={vehicleName} lat={vehicleLat} lng={vehicleLng} />
      </Marker>

      {homeGeofence && (
        <Circle
          center={[homeGeofence.latitude, homeGeofence.longitude]}
          radius={homeGeofence.radius}
          pathOptions={{
            color: 'rgba(59, 130, 246, 0.6)',
            fillColor: 'rgba(59, 130, 246, 0.1)',
            fillOpacity: 0.2,
            weight: 2,
          }}
        />
      )}

      {eventPositions.length > 1 && <EventTrail positions={eventPositions} />}
    </MapContainer>
  );
}

function MapPopup({ vehicleName, lat, lng }: { vehicleName: string; lat: number; lng: number }) {
  const { t } = useTranslation();
  return (
    <Popup>
      <Text as="p" variant="body">
        {vehicleName || t('guard.vehicle', 'Vehicle')}
      </Text>
      <Text as="span" variant="caption">
        {lat.toFixed(6)}, {lng.toFixed(6)}
      </Text>
    </Popup>
  );
}

function EventTrail({ positions }: { positions: [number, number][] }) {
  return <Polyline positions={positions} pathOptions={{ color: '#ef4444', weight: 3, dashArray: '8 4' }} />;
}

function EventCard({
  event,
  onAcknowledge,
  isAcking,
}: {
  event: GuardEvent;
  onAcknowledge: (eventId: number) => void;
  isAcking: boolean;
}) {
  const { t } = useTranslation();
  const acknowledged = isGuardEventAcknowledged(event);
  const type = event.event_type ?? '';
  const [labelKey, labelFallback] = eventLabelKey(type);

  const Icon: LucideIcon = acknowledged
    ? CheckCircle2
    : type === 'manual_panic'
    ? Siren
    : type.includes('unlock')
    ? Unlock
    : type.includes('drive')
    ? Car
    : AlertTriangle;

  const iconTone = acknowledged
    ? 'text-[var(--text-muted)]'
    : type === 'manual_panic' || type.includes('drive')
    ? 'text-rose-300'
    : 'text-amber-300';

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 transition-colors',
        acknowledged
          ? 'border-[var(--border-subtle)] bg-white/[0.01]'
          : 'border-red-500/20 bg-red-500/[0.03]',
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconTone)} aria-hidden="true" />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={EVENT_BADGE_VARIANT[type] ?? 'info'} size="sm">
            {t(labelKey, labelFallback)}
          </Badge>
          <TimeStamp value={event.ts} className={typography.role.caption} />
        </div>

        {(event.from_state != null || event.to_state != null) && (
          <Text as="p" variant="caption">
            {event.from_state ?? '—'} → {event.to_state ?? '—'}
          </Text>
        )}

        {event.acknowledged_by && (
          <Text as="p" variant="caption">
            {t('guard.acknowledgedBy', 'Acknowledged by')}: {event.acknowledged_by}
          </Text>
        )}
      </div>

      {!acknowledged && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onAcknowledge(event.id)}
          disabled={isAcking}
          aria-label={t('guard.acknowledgeEvent', 'Acknowledge event')}
          className="shrink-0"
        >
          {t('guard.acknowledge', 'Ack')}
        </Button>
      )}
    </div>
  );
}
