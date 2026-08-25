import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Battery,
  BatteryCharging,
  Thermometer,
  ThermometerSun,
  Gauge,
  Lock,
  Unlock,
  MapPin,
  Navigation,
  Route,
  Shield,
  ShieldCheck,
  Wind,
  Volume2,
  Zap,
  Clock,
  RefreshCw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import {
  Badge,
  Button,
  GlassPanel,
  Select,
  SectionTitle,
  PanelTitle,
  Subhead,
  Text,
  Caption,
} from '@/components/ui';
import { LinearGauge } from '@/components/charts';
import { FreshnessIndicator, MetricCard } from '@/components/data-display';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { PageContainer } from '@/components/layout';
import {
  useVehicles,
  useVehicleState,
  useLocationSnapshotLatest,
} from '@/api/hooks/useVehicles';
import { useVehicleCommand } from '@/api/hooks/useVehicleCommand';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { fmtNumber } from '@/lib/numberFormat';
import { batteryColor, COLOR } from '@/lib/colors';
import { cn } from '@/lib/cn';
import type { NeonColor } from '@/lib/tokens';
import type { LocationSnapshot } from '@/api/types';

type TFn = (key: string, fallback: string) => string;

/** Derive a user-friendly location label from the location snapshot. */
export function getLocationLabel(location: LocationSnapshot | null | undefined, t: TFn): string {
  if (!location) return '—';
  if (location.located_at_home) return t('glance.location.home', 'Home');
  if (location.located_at_work) return t('glance.location.work', 'Work');
  if (location.located_at_favorite) return t('glance.location.favorite', 'Saved');
  if (location.destination_name) return location.destination_name;
  return '—';
}

/** Map a battery percentage onto a shared neon accent for the KPI card. */
export function batteryNeon(level: number | null | undefined): NeonColor {
  if (level == null) return 'cyan';
  if (level > 60) return 'green';
  if (level > 25) return 'amber';
  return 'red';
}

// ── Local presentational sub-components ──────────────────────────────

interface QuickActionProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

/** Large, touch-friendly command button for the Controls band. */
function QuickAction({ icon: Icon, label, onClick, disabled, loading }: QuickActionProps) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      loading={loading}
      aria-label={label}
      className="flex min-h-[4.5rem] min-w-[5.5rem] flex-1 flex-col items-center justify-center gap-1.5
        rounded-xl border border-white/[0.06] bg-[var(--surface-2)] p-3 hover:border-white/[0.12]"
    >
      {!loading && <Icon className="h-5 w-5 text-[var(--theme-primary)]" aria-hidden="true" />}
      <Caption>{label}</Caption>
    </Button>
  );
}

interface DetailRowProps {
  icon: LucideIcon;
  label: string;
  value: string;
}

/** Icon + label on the left, primary-coloured value on the right. */
function DetailRow({ icon: Icon, label, value }: DetailRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        <Caption className="truncate">{label}</Caption>
      </span>
      <Text variant="body" className="shrink-0 tabular-nums">{value}</Text>
    </div>
  );
}

interface StatusRowProps {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}

/** Icon + label on the left, a status <Badge> (or similar) on the right. */
function StatusRow({ icon: Icon, label, children }: StatusRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        <Caption className="truncate">{label}</Caption>
      </span>
      {children}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────

export default function GlancePage() {
  const { t } = useTranslation();
  const title = t('glance.title', 'Quick Glance');
  usePageTitle(title);

  const {
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = useVehicles();
  const {
    vehicle,
    vehicleId: selectedVehicleId,
    vehicles,
    setVehicleId,
  } = useSelectedVehicle();
  const vehicleId = selectedVehicleId ?? 0;

  const stateQuery = useVehicleState(vehicleId, { refetchInterval: 10_000 });
  const {
    data: stateData,
    dataUpdatedAt,
    isLoading: stateLoading,
    isError: stateIsError,
    error: stateError,
    refetch,
  } = stateQuery;
  const state = stateData?.state;

  const { data: location } = useLocationSnapshotLatest(vehicleId, 30_000);

  const { formatDistance, formatSpeed, formatTemperature } = useUnits();
  const sendCommand = useVehicleCommand();

  const isOnline = state?.state === 'online' || state?.state === 'parked';
  const canSendCommands = isOnline && !sendCommand.isPending;
  const locationLabel = getLocationLabel(location, t);
  const vehicleName =
    vehicle?.display_name || vehicle?.model || t('glance.defaultName', 'Tesla');

  // Use the query's dataUpdatedAt as a proxy for "when we last got data".
  const freshnessTimestamp = useMemo(
    () => (dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : null),
    [dataUpdatedAt],
  );

  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.model || v.vin,
      })),
    [vehicles],
  );

  const onPickVehicle = (id: string) => {
    const next = Number(id);
    setVehicleId(Number.isInteger(next) && next > 0 ? next : null);
  };

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {vehicleOptions.length > 1 && (
        <Select
          options={vehicleOptions}
          value={String(vehicleId || '')}
          onChange={(e) => onPickVehicle(e.target.value)}
          aria-label={t('glance.selectVehicle', 'Select vehicle')}
        />
      )}
      <Button
        variant="ghost"
        onClick={() => refetch()}
        disabled={vehicleId === 0}
        aria-label={t('common.refresh', 'Refresh')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  // Shared placeholder for state-bound panels — self-sufficient per section.
  const renderPanelState = (skeletonHeight: number, emptyMessage: string) => {
    if (stateLoading) return <Skeleton height={skeletonHeight} />;
    if (stateIsError) return <QueryError error={stateError} onRetry={() => refetch()} />;
    return (
      <EmptyState /* no-action: transient empty state — vehicle has not emitted live telemetry yet */
        icon={<Battery className="h-8 w-8" />}
        message={emptyMessage}
      />
    );
  };

  return (
    <PageContainer
      title={title}
      subtitle={t('glance.subtitle', 'A quick, live snapshot of your vehicle')}
      actions={vehicle ? actions : undefined}
      loading={vehiclesLoading}
      error={vehiclesError as Error | null}
      query={vehicleId > 0 ? stateQuery : undefined}
    >
      {!vehicle ? (
        <GlassPanel className="p-8">
          <EmptyState
            icon={<Battery className="h-8 w-8" />}
            title={t('glance.noVehicleTitle', 'No vehicle available')}
            message={t(
              'glance.noVehicle',
              'Register or sync a Tesla vehicle before opening the live glance workspace.',
            )}
            description={t(
              'glance.noVehicleDescription',
              'Vehicle status, charging, climate, security, and location evidence will appear after the first telemetry check-in.',
            )}
            actionTo={{
              label: t('glance.manageVehicles', 'Manage vehicles'),
              to: '/vehicles',
            }}
          />
        </GlassPanel>
      ) : (
        <>
          {/* 1 — Overview KPI band: full-width responsive metric grid */}
          <FadeIn>
            <section
              aria-label={t('glance.overviewAria', 'Vehicle overview')}
              className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-6"
            >
              {stateLoading && !state ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} height={92} />
                ))
              ) : (
                <>
                  <MetricCard
                    label={t('glance.battery', 'Battery')}
                    value={state ? `${fmtNumber(state.battery_level ?? 0, 0)}%` : '—'}
                    icon={<Battery className="h-5 w-5" />}
                    color={batteryNeon(state?.battery_level)}
                  />
                  <MetricCard
                    label={t('glance.range', 'Range')}
                    value={state ? formatDistance(state.rated_range ?? 0, { precision: 0 }) : '—'}
                    icon={<Gauge className="h-5 w-5" />}
                    color="green"
                  />
                  <MetricCard
                    label={t('glance.temp', 'Interior')}
                    value={state ? formatTemperature(state.inside_temp) : '—'}
                    icon={<Thermometer className="h-5 w-5" />}
                    color="amber"
                  />
                  <MetricCard
                    label={t('glance.outsideTemp', 'Exterior')}
                    value={state ? formatTemperature(state.outside_temp) : '—'}
                    icon={<ThermometerSun className="h-5 w-5" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('glance.odometer', 'Odometer')}
                    value={state ? formatDistance(state.odometer ?? 0, { precision: 0 }) : '—'}
                    icon={<Route className="h-5 w-5" />}
                    color="purple"
                  />
                  <MetricCard
                    label={t('glance.speed', 'Speed')}
                    value={state ? formatSpeed(state.speed ?? 0, { precision: 0 }) : '—'}
                    icon={<Navigation className="h-5 w-5" />}
                    color="blue"
                  />
                </>
              )}
            </section>
          </FadeIn>

          {/* 2 — Live status bento: hero battery + charging/climate + security/location */}
          <FadeIn delay={0.1}>
            <section
              aria-label={t('glance.liveStatusAria', 'Live status')}
              className="space-y-3"
            >
              <SectionTitle>{t('glance.liveStatus', 'Live status')}</SectionTitle>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {/* Hero — vehicle identity + battery ring */}
                <GlassPanel className="p-4 sm:p-5 md:col-span-2 xl:col-span-1">
                  <div className="flex items-center justify-between gap-3">
                    <PanelTitle className="truncate">{vehicleName}</PanelTitle>
                    <Badge variant={isOnline ? 'success' : 'neutral'} dot>
                      {state?.state ?? t('glance.unknown', 'Unknown')}
                    </Badge>
                  </div>
                  {!state ? (
                    <div className="mt-4">
                      {renderPanelState(220, t('glance.noState', 'No live data for this vehicle yet'))}
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-col items-center">
                      <div className="relative flex w-full justify-center">
                        <LinearGauge
                          value={state.battery_level ?? 0}
                          max={100}
                          label={t('glance.battery', 'Battery')}
                          unit="%"
                          size={180}
                          className="max-w-xs"
                          color={
                            state.battery_level != null
                              ? batteryColor(state.battery_level)
                              : COLOR.MUTED
                          }
                        />
                      </div>
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                        <Badge variant="neutral" size="sm">
                          <Battery className="h-3.5 w-3.5" aria-hidden="true" />
                          {formatDistance(state.rated_range ?? 0, { precision: 0 })}
                        </Badge>
                        {state.is_charging && (
                          <Badge variant="info" size="sm" dot>
                            {t('glance.charging.active', 'Charging')}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-4 flex justify-center">
                        <FreshnessIndicator timestamp={freshnessTimestamp} size="md" />
                      </div>
                    </div>
                  )}
                </GlassPanel>

                {/* Charging & climate */}
                <GlassPanel className="p-4 sm:p-5">
                  <PanelTitle className="mb-3 flex items-center gap-2">
                    <BatteryCharging className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                    {t('glance.chargingClimate', 'Charging & climate')}
                  </PanelTitle>
                  {!state ? (
                    renderPanelState(200, t('glance.noState', 'No live data for this vehicle yet'))
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <Subhead>{t('glance.charging.title', 'Charging')}</Subhead>
                          <Badge
                            variant={state.is_charging ? 'info' : 'neutral'}
                            dot
                            size="sm"
                          >
                            {state.is_charging
                              ? t('glance.charging.active', 'Charging')
                              : t('glance.charging.idle', 'Idle')}
                          </Badge>
                        </div>
                        {state.is_charging ? (
                          <>
                            <DetailRow
                              icon={Zap}
                              label={t('glance.charging.power', 'Charger power')}
                              value={`${fmtNumber(state.charger_power ?? 0)} kW`}
                            />
                            <DetailRow
                              icon={BatteryCharging}
                              label={t('glance.charging.rate', 'Charge rate')}
                              value={`${formatDistance(state.charge_rate ?? 0, { precision: 0 })}/h`}
                            />
                            <DetailRow
                              icon={Clock}
                              label={t('glance.charging.timeToFull', 'Time to full')}
                              value={
                                (state.time_to_full_charge ?? 0) > 0
                                  ? `${fmtNumber(state.time_to_full_charge, 1)} h`
                                  : '—'
                              }
                            />
                          </>
                        ) : (
                          <Text variant="bodySm">
                            {t('glance.charging.notCharging', 'Not currently charging')}
                          </Text>
                        )}
                      </div>
                      <div className="space-y-1 border-t border-white/[0.06] pt-3">
                        <div className="flex items-center justify-between gap-2">
                          <Subhead>{t('glance.climate.title', 'Climate')}</Subhead>
                          <Badge
                            variant={state.is_climate_on ? 'success' : 'neutral'}
                            dot
                            size="sm"
                          >
                            {state.is_climate_on
                              ? t('glance.climate.on', 'On')
                              : t('glance.climate.off', 'Off')}
                          </Badge>
                        </div>
                        <DetailRow
                          icon={Thermometer}
                          label={t('glance.temp', 'Interior')}
                          value={formatTemperature(state.inside_temp)}
                        />
                        <DetailRow
                          icon={ThermometerSun}
                          label={t('glance.outsideTemp', 'Exterior')}
                          value={formatTemperature(state.outside_temp)}
                        />
                      </div>
                    </div>
                  )}
                </GlassPanel>

                {/* Security & location */}
                <GlassPanel className="p-4 sm:p-5">
                  <PanelTitle className="mb-3 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                    {t('glance.securityLocation', 'Security & location')}
                  </PanelTitle>
                  {!state ? (
                    renderPanelState(200, t('glance.noState', 'No live data for this vehicle yet'))
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <Subhead>{t('glance.security', 'Security')}</Subhead>
                        <StatusRow
                          icon={state.is_locked ? Lock : Unlock}
                          label={t('glance.lockStatus', 'Doors')}
                        >
                          <Badge
                            variant={state.is_locked ? 'success' : 'warning'}
                            dot
                            size="sm"
                          >
                            {state.is_locked
                              ? t('glance.locked', 'Locked')
                              : t('glance.unlocked', 'Unlocked')}
                          </Badge>
                        </StatusRow>
                        <StatusRow
                          icon={state.sentry_mode ? ShieldCheck : Shield}
                          label={t('glance.sentry', 'Sentry mode')}
                        >
                          <Badge
                            variant={state.sentry_mode ? 'info' : 'neutral'}
                            dot
                            size="sm"
                          >
                            {state.sentry_mode
                              ? t('common.on', 'On')
                              : t('common.off', 'Off')}
                          </Badge>
                        </StatusRow>
                      </div>
                      <div className="space-y-1 border-t border-white/[0.06] pt-3">
                        <Subhead>{t('glance.locationLabel', 'Location')}</Subhead>
                        <DetailRow
                          icon={MapPin}
                          label={t('glance.place', 'Place')}
                          value={locationLabel}
                        />
                        {location?.destination_name && (
                          <DetailRow
                            icon={Navigation}
                            label={t('glance.destination', 'Destination')}
                            value={location.destination_name}
                          />
                        )}
                        {(location?.minutes_to_arrival ?? 0) > 0 && (
                          <DetailRow
                            icon={Route}
                            label={t('glance.eta', 'ETA')}
                            value={`${fmtNumber(location?.minutes_to_arrival ?? 0, 0)} ${t('glance.minutesShort', 'min')}`}
                          />
                        )}
                      </div>
                      <Caption className="block border-t border-white/[0.06] pt-3">
                        {t('glance.software', 'Software')}: {state.software_version || '—'}
                      </Caption>
                    </div>
                  )}
                </GlassPanel>
              </div>
            </section>
          </FadeIn>

          {/* 3 — Controls: full-width quick-action band */}
          <FadeIn delay={0.2}>
            <section
              aria-label={t('glance.controlsAria', 'Controls')}
              className="space-y-3"
            >
              <SectionTitle>{t('glance.controls', 'Controls')}</SectionTitle>
              <GlassPanel className="p-4 sm:p-5">
                {!isOnline && (
                  <Text variant="bodySm" className={cn('mb-3 block')}>
                    {t('glance.offlineHint', 'Commands are available when the vehicle is online.')}
                  </Text>
                )}
                <div className="flex flex-wrap gap-3">
                  <QuickAction
                    icon={state?.is_locked ? Unlock : Lock}
                    label={
                      state?.is_locked
                        ? t('glance.action.unlock', 'Unlock')
                        : t('glance.action.lock', 'Lock')
                    }
                    disabled={!canSendCommands}
                    loading={
                      sendCommand.isPending &&
                      (sendCommand.variables?.command === 'lock' ||
                        sendCommand.variables?.command === 'unlock')
                    }
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
                    loading={
                      sendCommand.isPending &&
                      (sendCommand.variables?.command === 'climate_on' ||
                        sendCommand.variables?.command === 'climate_off')
                    }
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
                    loading={
                      sendCommand.isPending &&
                      sendCommand.variables?.command === 'honk_horn'
                    }
                    onClick={() => sendCommand.mutate({ vehicleId, command: 'honk_horn' })}
                  />
                </div>
              </GlassPanel>
            </section>
          </FadeIn>

          {/* 4 — Footer: link to full app */}
          <div className="flex justify-center pt-1">
            <Link
              to="/"
              className="transition-colors hover:text-[var(--text-secondary)]"
            >
              <Caption>{t('glance.openApp', 'Open full app →')}</Caption>
            </Link>
          </div>
        </>
      )}
    </PageContainer>
  );
}
