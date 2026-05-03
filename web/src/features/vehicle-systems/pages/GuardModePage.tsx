import { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/feedback/EmptyState';
import { AlertBanner } from '@/components/feedback/AlertBanner';
import { FadeIn } from '@/components/motion/FadeIn';
import { MapContainer, Marker, Circle, Popup, Polyline, vehicleIcon } from '@/components/maps';
import { MapTileLayer, MapInvalidator } from '@/components/maps';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useGeofences } from '@/api/hooks/useLocations';
import {
  useGuardConfig,
  useGuardEvents,
  useSetGuardConfig,
  useGuardPanic,
  useAcknowledgeGuardEvent,
  type GuardEvent,
} from '@/api/hooks/useGuard';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { MapStyle } from '@/components/maps';

// ── Event type display helpers ──────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  vehicle_moved: '📍 Vehicle Moved',
  unauthorized_unlock: '🔓 Unauthorized Unlock',
  unauthorized_drive: '🚗 Unauthorized Drive',
  sentry_triggered: '👁️ Sentry Triggered',
  manual_panic: '🚨 Manual Panic',
  test_alert: '🔔 Test Alert',
};

const EVENT_BADGE_VARIANT: Record<string, 'danger' | 'warning' | 'info'> = {
  vehicle_moved: 'danger',
  unauthorized_unlock: 'danger',
  unauthorized_drive: 'danger',
  sentry_triggered: 'warning',
  manual_panic: 'danger',
  test_alert: 'info',
};

const SENSITIVITY_OPTIONS = [
  { value: 'low', label: 'Low — Movement > 1km' },
  { value: 'medium', label: 'Medium — Movement > 200m' },
  { value: 'high', label: 'High — Any movement' },
];

// ── Guard Mode Page ─────────────────────────────────────────────────────

export default function GuardModePage() {
  const { t } = useTranslation();
  usePageTitle(t('guard.title', 'Guard Mode'));

  // Vehicle selector
  const { data: vehicles } = useVehicles();
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const activeVehicleId = Number(selectedVehicleId || (vehicles?.[0]?.id ?? 0));
  const activeVehicle = vehicles?.find((v) => v.id === activeVehicleId);

  // Guard data
  const { data: guardConfig, isLoading: configLoading } = useGuardConfig(activeVehicleId);
  const { data: guardEvents, isLoading: eventsLoading } = useGuardEvents(activeVehicleId);
  const { data: vehicleState } = useVehicleState(activeVehicleId, { refetchInterval: guardConfig?.enabled ? 5_000 : 30_000 });
  const { data: geofences } = useGeofences();

  // Mutations
  const setConfig = useSetGuardConfig();
  const panic = useGuardPanic();
  const ackEvent = useAcknowledgeGuardEvent();

  // Local state
  const [panicDialogOpen, setPanicDialogOpen] = useState(false);
  const [sensitivity, setSensitivity] = useState<string>('');
  const [homeGeofenceId, setHomeGeofenceId] = useState<string>('');
  const [autoPanic, setAutoPanic] = useState(false);

  // Sync local state from config
  const effectiveSensitivity = sensitivity || guardConfig?.sensitivity || 'medium';
  const effectiveHomeGeofenceId = homeGeofenceId || (guardConfig?.home_geofence_id != null ? String(guardConfig.home_geofence_id) : '');

  // Derived data
  const isArmed = guardConfig?.enabled ?? false;
  const events = guardEvents ?? [];
  const unacknowledgedCount = events.filter((e) => !e.acknowledged).length;
  const latestEvent = events[0] ?? null;
  const isTriggered = latestEvent != null && !latestEvent.acknowledged && latestEvent.event_type !== 'test_alert';

  const state = vehicleState?.state ?? vehicleState;
  const vehicleLat = (state as Record<string, unknown>)?.latitude as number | undefined;
  const vehicleLng = (state as Record<string, unknown>)?.longitude as number | undefined;
  const hasLocation = vehicleLat != null && vehicleLng != null && vehicleLat !== 0 && vehicleLng !== 0;

  const homeGeofence = geofences?.find((g) => String(g.id) === effectiveHomeGeofenceId);

  const geofenceOptions = useMemo(
    () => [
      { value: '', label: t('guard.noGeofence', '— No home geofence —') },
      ...(geofences ?? []).map((g) => ({ value: String(g.id), label: g.name })),
    ],
    [geofences, t],
  );

  // ── Handlers ────────────────────────────────────────────────────────

  const handleToggleGuard = () => {
    if (activeVehicleId <= 0) return;
    setConfig.mutate({
      vehicleId: activeVehicleId,
      enabled: !isArmed,
      home_geofence_id: effectiveHomeGeofenceId ? Number(effectiveHomeGeofenceId) : null,
      sensitivity: effectiveSensitivity,
      auto_panic: autoPanic,
    });
  };

  const handleSaveSettings = () => {
    if (activeVehicleId <= 0) return;
    setConfig.mutate({
      vehicleId: activeVehicleId,
      enabled: isArmed,
      home_geofence_id: effectiveHomeGeofenceId ? Number(effectiveHomeGeofenceId) : null,
      sensitivity: effectiveSensitivity,
      auto_panic: autoPanic,
    });
  };

  const handlePanic = () => {
    setPanicDialogOpen(false);
    if (activeVehicleId > 0) {
      panic.mutate(activeVehicleId);
    }
  };

  const handleAcknowledge = (eventId: number) => {
    if (activeVehicleId > 0) {
      ackEvent.mutate({ vehicleId: activeVehicleId, eventId });
    }
  };

  const isLoading = configLoading || eventsLoading;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <PageContainer
      title={t('guard.title', 'Guard Mode')}
      subtitle={t('guard.subtitle', 'Anti-theft monitoring and emergency response')}
      loading={isLoading}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={vehicles.map((v) => ({ value: String(v.id), label: v.display_name || v.vin }))}
            value={String(activeVehicleId)}
            onChange={(e) => setSelectedVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      {/* Triggered alert banner */}
      {isTriggered && latestEvent && (
        <AlertBanner variant="danger" title={t('guard.alertTriggered', 'Guard Alert Triggered!')} icon={<ShieldAlert className="h-5 w-5" />}>
          <p className="text-sm">
            {EVENT_LABELS[latestEvent.event_type] ?? latestEvent.event_type}
            {' — '}
            {formatDateTime(latestEvent.created_at)}
          </p>
          {latestEvent.latitude != null && latestEvent.longitude != null && (
            <a
              href={`https://maps.google.com/?q=${latestEvent.latitude},${latestEvent.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-red-300 hover:text-red-200 mt-1"
            >
              <MapPin className="h-3 w-3" /> {t('guard.viewOnMap', 'View on Google Maps')}
            </a>
          )}
        </AlertBanner>
      )}

      {/* Row 1: Guard toggle + Status + Panic */}
      <FadeIn>
        <Grid cols={{ default: 1, md: 3 }} gap={4}>
          {/* Guard Mode Toggle */}
          <GlassPanel
            className={cn(
              'p-6 flex flex-col items-center justify-center gap-4 text-center transition-all duration-500',
              isArmed && !isTriggered && 'ring-2 ring-emerald-500/30',
              isTriggered && 'ring-2 ring-red-500/50 animate-pulse',
            )}
          >
            <div className={cn(
              'w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300',
              isArmed && !isTriggered && 'bg-emerald-500/20 text-emerald-400',
              isTriggered && 'bg-red-500/20 text-red-400',
              !isArmed && 'bg-[var(--surface-2)] text-[var(--text-muted)]',
            )}>
              {isTriggered ? (
                <ShieldAlert className="h-10 w-10" />
              ) : isArmed ? (
                <ShieldCheck className="h-10 w-10" />
              ) : (
                <ShieldOff className="h-10 w-10" />
              )}
            </div>
            <h3 className="text-lg font-bold text-[var(--text-primary)]">
              {isTriggered
                ? t('guard.triggered', 'TRIGGERED')
                : isArmed
                ? t('guard.armed', 'Armed')
                : t('guard.disarmed', 'Disarmed')}
            </h3>
            <Toggle
              label={t('guard.enableGuard', 'Guard Mode')}
              checked={isArmed}
              onChange={handleToggleGuard}
            />
            {setConfig.isPending && (
              <span className="text-xs text-[var(--text-muted)]">{t('guard.updating', 'Updating...')}</span>
            )}
          </GlassPanel>

          {/* Status Card */}
          <GlassPanel className="p-6 space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              {t('guard.status', 'Status')}
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-[var(--text-muted)]" />
                <span className="text-[var(--text-secondary)]">
                  {isArmed && guardConfig?.updated_at
                    ? t('guard.armedSince', 'Armed since {{time}}', { time: formatDateTime(guardConfig.updated_at) })
                    : t('guard.notArmed', 'Not armed')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Lock className="h-4 w-4 text-[var(--text-muted)]" />
                <span className="text-[var(--text-secondary)]">
                  {(state as Record<string, unknown>)?.is_locked
                    ? t('guard.locked', 'Vehicle locked')
                    : t('guard.unlocked', 'Vehicle unlocked')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Eye className="h-4 w-4 text-[var(--text-muted)]" />
                <span className="text-[var(--text-secondary)]">
                  {(state as Record<string, unknown>)?.sentry_mode
                    ? t('guard.sentryOn', 'Sentry mode active')
                    : t('guard.sentryOff', 'Sentry mode off')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-[var(--text-muted)]" />
                <span className="text-[var(--text-secondary)]">
                  {unacknowledgedCount > 0
                    ? t('guard.unackEvents', '{{count}} unacknowledged event(s)', { count: unacknowledgedCount })
                    : t('guard.noEvents', 'No active alerts')}
                </span>
              </div>
            </div>
          </GlassPanel>

          {/* PANIC Button */}
          <GlassPanel className="p-6 flex flex-col items-center justify-center gap-4">
            <Siren className="h-10 w-10 text-red-400" />
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              {t('guard.emergency', 'Emergency')}
            </h3>
            <Button
              onClick={() => setPanicDialogOpen(true)}
              disabled={panic.isPending || activeVehicleId <= 0}
              className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl transition-all hover:shadow-lg hover:shadow-red-500/25"
            >
              {panic.isPending
                ? t('guard.panicking', 'Sending...')
                : t('guard.panicButton', '🚨 PANIC')}
            </Button>
            <p className="text-xs text-[var(--text-muted)] text-center">
              {t('guard.panicDesc', 'Flash lights, honk horn, lock doors, enable sentry, and notify all channels')}
            </p>
          </GlassPanel>
        </Grid>
      </FadeIn>

      {/* Row 2: Settings */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            {t('guard.settings', 'Guard Settings')}
          </h3>
          <Grid cols={{ default: 1, md: 3 }} gap={4}>
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">{t('guard.homeGeofence', 'Home Geofence')}</label>
              <Select
                options={geofenceOptions}
                value={effectiveHomeGeofenceId}
                onChange={(e) => setHomeGeofenceId(e.target.value)}
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {t('guard.homeGeofenceHelp', 'Vehicle will trigger alert if it leaves this area')}
              </p>
            </div>
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">{t('guard.sensitivity', 'Sensitivity')}</label>
              <Select
                options={SENSITIVITY_OPTIONS}
                value={effectiveSensitivity}
                onChange={(e) => setSensitivity(e.target.value)}
              />
            </div>
            <div className="flex flex-col justify-between">
              <div>
                <Toggle
                  label={t('guard.autoPanic', 'Auto-Panic on Trigger')}
                  checked={autoPanic || guardConfig?.auto_panic || false}
                  onChange={setAutoPanic}
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {t('guard.autoPanicHelp', 'Automatically execute panic actions when guard is triggered')}
                </p>
              </div>
              <Button
                onClick={handleSaveSettings}
                disabled={setConfig.isPending}
                className="mt-3"
              >
                {t('guard.saveSettings', 'Save Settings')}
              </Button>
            </div>
          </Grid>
        </GlassPanel>
      </FadeIn>

      {/* Row 3: Live Map */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-0 overflow-hidden">
          <div className="p-4 pb-0">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              {t('guard.liveMap', 'Live Vehicle Location')}
            </h3>
          </div>
          <div className="h-[400px] mt-3">
            {hasLocation ? (
              <LiveMap
                vehicleLat={vehicleLat!}
                vehicleLng={vehicleLng!}
                vehicleName={activeVehicle?.display_name ?? ''}
                homeGeofence={homeGeofence ?? null}
                events={events}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <EmptyState icon={<MapPin className="h-8 w-8" />} message={t('guard.noLocation', 'No vehicle location available')} />
              </div>
            )}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Row 4: Event Timeline */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              {t('guard.eventTimeline', 'Event Timeline')}
            </h3>
            {unacknowledgedCount > 0 && (
              <Badge variant="danger" size="sm">
                {unacknowledgedCount} {t('guard.unack', 'unacknowledged')}
              </Badge>
            )}
          </div>

          {events.length > 0 ? (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {events.map((ev) => (
                <EventRow
                  key={ev.id}
                  event={ev}
                  onAcknowledge={handleAcknowledge}
                  isAcking={ackEvent.isPending}
                />
              ))}
            </div>
          ) : (
            <EmptyState icon={<Info className="h-8 w-8" />} message={t('guard.noEvents', 'No guard events yet')} />
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
        confirmLabel={t('guard.panicConfirmLabel', '🚨 ACTIVATE PANIC')}
        variant="danger"
        onConfirm={handlePanic}
        onCancel={() => setPanicDialogOpen(false)}
      />
    </PageContainer>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

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

  // Position trail from events with locations
  const eventPositions = useMemo(
    () =>
      events
        .filter((e) => e.latitude != null && e.longitude != null)
        .map((e) => [e.latitude!, e.longitude!] as [number, number])
        .reverse(),
    [events],
  );

  return (
    <MapContainer center={[vehicleLat, vehicleLng]} zoom={15} scrollWheelZoom className="h-full w-full z-0">
      <MapTileLayer style={mapStyle} />
      <MapInvalidator />

      {/* Vehicle marker */}
      <Marker position={[vehicleLat, vehicleLng]} icon={vehicleIcon()}>
        <MapPopup vehicleName={vehicleName} lat={vehicleLat} lng={vehicleLng} />
      </Marker>

      {/* Home geofence circle */}
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

      {/* Event trail */}
      {eventPositions.length > 1 && (
        <EventTrail positions={eventPositions} />
      )}
    </MapContainer>
  );
}

function MapPopup({ vehicleName, lat, lng }: { vehicleName: string; lat: number; lng: number }) {
  return (
    <Popup>
      <div className="text-sm">
        <strong>{vehicleName || 'Vehicle'}</strong>
        <br />
        <span className="text-xs text-[var(--text-muted)]">
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </span>
      </div>
    </Popup>
  );
}

function EventTrail({ positions }: { positions: [number, number][] }) {
  return (
    <Polyline
      positions={positions}
      pathOptions={{ color: '#ef4444', weight: 3, dashArray: '8 4' }}
    />
  );
}

function EventRow({
  event,
  onAcknowledge,
  isAcking,
}: {
  event: GuardEvent;
  onAcknowledge: (eventId: number) => void;
  isAcking: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border transition-colors',
        event.acknowledged
          ? 'border-[var(--border-subtle)] bg-white/[0.01]'
          : 'border-red-500/20 bg-red-500/[0.03]',
      )}
    >
      <div className="shrink-0 mt-0.5">
        {event.acknowledged ? (
          <CheckCircle2 className="h-5 w-5 text-[var(--text-muted)]" />
        ) : event.event_type === 'manual_panic' ? (
          <Siren className="h-5 w-5 text-red-400" />
        ) : (event.event_type ?? '').includes('unlock') ? (
          <Unlock className="h-5 w-5 text-amber-400" />
        ) : (event.event_type ?? '').includes('drive') ? (
          <Car className="h-5 w-5 text-red-400" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-amber-400" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant={EVENT_BADGE_VARIANT[event.event_type] ?? 'info'}
            size="sm"
          >
            {EVENT_LABELS[event.event_type] ?? event.event_type}
          </Badge>
          <span className="text-xs text-[var(--text-muted)]">{formatDateTime(event.created_at)}</span>
        </div>

        {event.latitude != null && event.longitude != null && (
          <a
            href={`https://maps.google.com/?q=${event.latitude},${event.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 mt-1"
          >
            <MapPin className="h-3 w-3" />
            {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}
          </a>
        )}

        {event.notified_channels && event.notified_channels.length > 0 && (
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('guard.notified', 'Notified')}: {event.notified_channels.join(', ')}
          </p>
        )}
      </div>

      <div className="shrink-0">
        {!event.acknowledged && (
          <Button
            onClick={() => onAcknowledge(event.id)}
            disabled={isAcking}
            className="text-xs px-2 py-1"
          >
            {t('guard.acknowledge', 'Ack')}
          </Button>
        )}
      </div>
    </div>
  );
}
