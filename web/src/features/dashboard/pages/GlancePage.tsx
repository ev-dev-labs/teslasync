import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Battery,
  Thermometer,
  Lock,
  Unlock,
  MapPin,
  Wind,
  Volume2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, GlassPanel } from '@/components/ui';
import { Button } from '@/components/ui';
import { RadialGauge } from '@/components/charts';
import { FreshnessIndicator, MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { PageContainer } from '@/components/layout';
import { useVehicles, useVehicleState, useLocationSnapshotLatest } from '@/api/hooks/useVehicles';
import { useVehicleCommand } from '@/api/hooks/useVehicleCommand';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { batteryColor, COLOR } from '@/lib/colors';

/** Derive a user-friendly location label from the location snapshot */
function getLocationLabel(
  location: { located_at_home?: boolean; located_at_work?: boolean; located_at_favorite?: boolean; destination_name?: string } | null | undefined,
  t: (key: string, fallback: string) => string,
): string {
  if (!location) return '—';
  if (location.located_at_home) return t('glance.location.home', 'Home');
  if (location.located_at_work) return t('glance.location.work', 'Work');
  if (location.located_at_favorite) return t('glance.location.favorite', 'Saved');
  if (location.destination_name) return location.destination_name;
  return '—';
}

// ── Local sub-components ─────────────────────────────────────────────

interface QuickActionProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

function QuickAction({ icon: Icon, label, onClick, disabled, loading }: QuickActionProps) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      loading={loading}
      aria-label={label}
      className="flex flex-col items-center gap-1 h-auto p-3 rounded-xl bg-[var(--surface-2)]
        border border-white/[0.06] hover:bg-[var(--surface-2)] min-w-[64px]"
    >
      {!loading && <Icon className="h-5 w-5 text-[var(--theme-primary)]" />}
      <span className="text-[10px] text-[var(--text-secondary)]">{label}</span>
    </Button>
  );
}

// ── Main page ────────────────────────────────────────────────────────

export default function GlancePage() {
  const { t } = useTranslation();
  const title = t('glance.title', 'Quick Glance');
  usePageTitle(title);

  const [searchParams] = useSearchParams();
  const vehicleIdParam = searchParams.get('vehicle_id');

  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useVehicles();

  // Support ?vehicle_id= query param; fall back to first vehicle
  const vehicle = useMemo(() => {
    if (!vehicles?.length) return null;
    if (vehicleIdParam) {
      const found = vehicles.find((v) => String(v.id) === vehicleIdParam);
      if (found) return found;
    }
    return vehicles[0];
  }, [vehicles, vehicleIdParam]);

  const vehicleId = vehicle?.id ?? 0;

  const { data: stateData, dataUpdatedAt } = useVehicleState(vehicleId, {
    refetchInterval: 10_000,
  });
  const state = stateData?.state;

  const { data: location } = useLocationSnapshotLatest(vehicleId, 30_000);

  const { convertDistance, convertTemp, distanceUnit, tempUnit } = useSettings();
  const sendCommand = useVehicleCommand();

  const isOnline = state?.state === 'online' || state?.state === 'parked';
  const canSendCommands = isOnline && !sendCommand.isPending;

  const locationLabel = getLocationLabel(location, t);

  // Use the query's dataUpdatedAt as a proxy for "when we last got data"
  const freshnessTimestamp = useMemo(
    () => (dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : null),
    [dataUpdatedAt],
  );

  return (
    <PageContainer
      title={title}
      loading={vehiclesLoading}
      error={vehiclesError}
      className="min-h-screen"
    >
      {!vehicle ? (
        <GlassPanel className="p-8">
          <EmptyState
            icon={<Battery className="h-8 w-8" />}
            message={t('glance.noVehicle', 'No vehicle found')}
          />
        </GlassPanel>
      ) : (
        <div className="flex min-h-[calc(100vh-12rem)] flex-col items-center justify-center p-6">
          <FadeIn>
            {/* Vehicle name + status */}
            <div className="flex flex-col items-center gap-2 mb-6">
              <h1 className="text-xl font-semibold text-[var(--text-primary)]">
                {vehicle.display_name || vehicle.model || t('glance.defaultName', 'Tesla')}
              </h1>
              <Badge
                variant={isOnline ? 'success' : 'neutral'}
                dot
              >
                {state?.state ?? t('glance.unknown', 'Unknown')}
              </Badge>
            </div>

            {/* Big battery ring */}
            <div className="flex justify-center my-8 relative">
              <RadialGauge
                value={state?.battery_level ?? 0}
                max={100}
                label={t('glance.battery', 'Battery')}
                unit="%"
                size={180}
                color={state?.battery_level != null ? batteryColor(state.battery_level) : COLOR.MUTED}
              />
            </div>

            {/* Key metrics grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xs mx-auto">
              <MetricCard
                label={t('glance.range', 'Range')}
                value={
                  state?.rated_range != null
                    ? `${fmtNumber(convertDistance(state.rated_range), 0)} ${distanceUnit}`
                    : '—'
                }
                icon={<Battery className="h-4 w-4" />}
                color="green"
                className="bg-[var(--surface-2)] border-white/[0.06]"
              />
              <MetricCard
                label={t('glance.temp', 'Interior')}
                value={
                  state?.inside_temp != null
                    ? `${fmtNumber(convertTemp(state.inside_temp), 1)}${tempUnit}`
                    : '—'
                }
                icon={<Thermometer className="h-4 w-4" />}
                color="amber"
                className="bg-[var(--surface-2)] border-white/[0.06]"
              />
              <MetricCard
                label={t('glance.security', 'Security')}
                value={
                  state?.is_locked
                    ? t('glance.locked', 'Locked')
                    : t('glance.unlocked', 'Unlocked')
                }
                icon={state?.is_locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                color={state?.is_locked ? 'green' : 'red'}
                className="bg-[var(--surface-2)] border-white/[0.06]"
              />
              <MetricCard
                label={t('glance.locationLabel', 'Location')}
                value={locationLabel}
                icon={<MapPin className="h-4 w-4" />}
                color="cyan"
                className="bg-[var(--surface-2)] border-white/[0.06]"
              />
            </div>

            {/* Quick actions */}
            <div className="flex justify-center gap-3 mt-8">
              <QuickAction
                icon={state?.is_locked ? Unlock : Lock}
                label={
                  state?.is_locked
                    ? t('glance.action.unlock', 'Unlock')
                    : t('glance.action.lock', 'Lock')
                }
                disabled={!canSendCommands}
                loading={sendCommand.isPending && sendCommand.variables?.command === 'lock'}
                onClick={() =>
                  sendCommand.mutate({
                    vehicleId,
                    command: state?.is_locked ? 'unlock' : 'lock',
                  })
                }
              />
              <QuickAction
                icon={Wind}
                label={
                  state?.is_climate_on
                    ? t('glance.action.climateOff', 'Climate Off')
                    : t('glance.action.climateOn', 'Climate On')
                }
                disabled={!canSendCommands}
                loading={sendCommand.isPending && (sendCommand.variables?.command === 'climate_on' || sendCommand.variables?.command === 'climate_off')}
                onClick={() =>
                  sendCommand.mutate({
                    vehicleId,
                    command: state?.is_climate_on ? 'climate_off' : 'climate_on',
                  })
                }
              />
              <QuickAction
                icon={Volume2}
                label={t('glance.action.horn', 'Horn')}
                disabled={!canSendCommands}
                loading={sendCommand.isPending && sendCommand.variables?.command === 'honk_horn'}
                onClick={() =>
                  sendCommand.mutate({ vehicleId, command: 'honk_horn' })
                }
              />
            </div>

            {/* Freshness */}
            <div className="flex justify-center mt-6">
              <FreshnessIndicator timestamp={freshnessTimestamp} size="md" />
            </div>

            {/* Link to full app */}
            <div className="flex justify-center mt-4">
              <Link
                to="/"
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {t('glance.openApp', 'Open full app →')}
              </Link>
            </div>
          </FadeIn>
        </div>
      )}
    </PageContainer>
  );
}
