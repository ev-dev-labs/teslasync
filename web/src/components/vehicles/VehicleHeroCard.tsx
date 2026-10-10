import { forwardRef, useEffect, useState, type HTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isFiniteNumber } from '@/lib/numberFormat';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { BUTTON_BASE, BUTTON_VARIANTS } from '@/components/ui/Button';
import { LinearGauge } from '@/components/charts/LinearGauge';
import { ambientTemperatureGaugeRange } from '@/components/charts/temperatureGaugeRange';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { StatCard } from '@/components/data-display/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Heading, Text } from '@/components/ui/Typography';
import { Grid } from '@/components/layout/Grid';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FSM_REGISTRY } from '@/types/fsm';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertPowerFromSI, convertTempFromSI } from '@/lib/unitConversion';
import type { VehicleStatus } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { typography } from '@/lib/tokens';
import type { DataState } from '@/api/dataState';
import { resolveVehicleStateFreshness, type VehicleStateFreshness } from '@/api/hooks/useVehicles';
import { useDateFormat } from '@/hooks/useDateFormat';
import { DataProvenanceBadge } from '@/components/data-display/DataProvenanceBadge';
import { SourceContent, type SourceState } from '@/components/layout/layout-reference/SourceContent';
import { StaleRefreshWarning } from '@/components/feedback/StaleRefreshWarning';

export interface VehicleHeroCardProps extends HTMLAttributes<HTMLDivElement> {
  vehicle: {
    id: number;
    display_name: string;
    model: string;
    vin: string;
    state: string;
  };
  vehicleState?: {
    battery_level?: number | null;
    rated_range?: number | null;
    inside_temp?: number | null;
    outside_temp?: number | null;
    odometer?: number | null;
    is_charging?: boolean | null;
    is_locked?: boolean | null;
    sentry_mode?: boolean | null;
    software_version?: string | null;
    /** Signed pack power in watts (SI). */
    power?: number | null;
    state?: string | null;
  } | null;
  /**
   * Optional URL for the user-uploaded hero photo. Passed in as a prop so
   * dashboards rendering many hero cards do not trigger one query per card.
   */
  photoUrl?: string | null;
  dataState?: DataState<unknown>;
  observation?: {
    observedAt: number | null;
    freshness: VehicleStateFreshness;
  } | null;
  className?: string;
}

/** Stable grid layout for the detail stat cards — hoisted so the object
 *  reference is identical across renders and never re-triggers <Grid>. */
const STAT_GRID_COLS = { default: 2, md: 4 } as const;
const NAV_LINK_CLASS = cn(
  BUTTON_BASE,
  typography.size.sm,
  'min-h-11 min-w-11 max-w-full break-words px-4 py-2',
);

/**
 * Coerce an arbitrary state string to a known {@link VehicleStatus}.
 * Uses an own-property check rather than the `in` operator so inherited
 * object keys (`toString`, `constructor`, …) fail closed to `offline`
 * instead of being mistaken for real vehicle states.
 */
function toStatus(state: string): VehicleStatus {
  return Object.prototype.hasOwnProperty.call(FSM_REGISTRY.vehicle.states, state)
    ? (state as VehicleStatus)
    : 'offline';
}

export const VehicleHeroCard = forwardRef<HTMLDivElement, VehicleHeroCardProps>(
  ({ vehicle, vehicleState, photoUrl, dataState, observation, className, ...props }, ref) => {
    const { fmtInt, fmtNumber } = useNumberFormatting();
    const { t } = useTranslation();
    const { unitPrefs } = useUnits();
    const { formatRelative, formatDateTime } = useDateFormat();
    const [, setObservationTick] = useState(0);
    const vs = vehicleState;
    const observationDate = isFiniteNumber(observation?.observedAt)
      && Number.isFinite(new Date(observation.observedAt).getTime())
      ? new Date(observation.observedAt)
      : null;
    const observedAt = observationDate?.getTime() ?? null;
    useEffect(() => {
      if (observedAt == null) return;
      const timer = setInterval(() => setObservationTick((tick) => tick + 1), 30_000);
      return () => clearInterval(timer);
    }, [observedAt]);
    const streamFreshness = dataState != null && dataState.provenance !== 'live'
      && dataState.provenance !== 'cached'
      ? 'unknown'
      : resolveVehicleStateFreshness(observation?.freshness, observedAt);
    const sourceLabel = t('statusBar.connectionDiagnostics.telemetry', 'Telemetry stream');
    const hasTrustMetadata = dataState !== undefined || observation !== undefined;
    const showRefreshWarning = dataState != null && (vs != null || dataState.hasData) && (
      dataState.refreshError != null || dataState.isRefreshBlocked
      || dataState.status === 'partial' || dataState.status === 'unavailable'
    );
    // The reading prop, not the opaque request payload, owns usable content.
    const sourceState: SourceState = !vs && dataState?.fatalError
      ? 'error'
      : !vs && dataState?.status === 'initial'
        ? 'loading'
        : (vs || dataState?.hasData) && dataState?.status === 'stale' && !showRefreshWarning
          ? 'retained'
          : 'ready';

    /* Convert SI base units (meters, °C) to the user's display units. The state
     * endpoint returns odometer and rated_range in meters; always pull the
     * suffix from `unitPrefs` so labels track Settings, never hardcoded units. */
    const distanceLabel = unitPrefs.distance;        // 'mi' | 'km'
    const temperatureLabel = unitPrefs.temperature;  // '°F' | '°C'

    const batteryReading = isFiniteNumber(vs?.battery_level) ? vs.battery_level : null;
    const odometerDisplay = isFiniteNumber(vs?.odometer)
      ? fmtInt(Math.round(convertDistanceFromSI(vs.odometer, distanceLabel)))
      : '—';
    const rangeDisplay = isFiniteNumber(vs?.rated_range)
      ? Math.round(convertDistanceFromSI(vs.rated_range, distanceLabel))
      : null;
    const insideTempDisplay = isFiniteNumber(vs?.inside_temp)
      ? Math.round(convertTempFromSI(vs.inside_temp, temperatureLabel))
      : null;
    const outsideTempDisplay = isFiniteNumber(vs?.outside_temp)
      ? Math.round(convertTempFromSI(vs.outside_temp, temperatureLabel))
      : null;

    /* Range gauge max scales with display unit so the arc fills meaningfully
     * — Tesla long-range packs cap around 400 mi ≈ 644 km. */
    const rangeMax = distanceLabel === 'km' ? 644 : 400;
    /* Both ends are converted together: a degree scale has a non-zero origin,
     * so converting only the ceiling makes the same temperature sweep a
     * different arc in °F. The floor also sits below freezing so sub-zero
     * outside readings render instead of clamping to an empty ring. */
    const tempRange = ambientTemperatureGaugeRange((c) =>
      convertTempFromSI(c, temperatureLabel),
    );

    return (
      <GlassPanel
        ref={ref}
        role="group"
        aria-label={vehicle.display_name}
        hover
        className={cn('min-w-0 p-4 sm:p-6 space-y-6', className)}
        {...props}
      >
        {/* User-uploaded hero photo; absent photo preserves the gauges-only layout. */}
        {photoUrl ? (
          <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)]">
            <img
              src={photoUrl}
              alt={t('vehicleHero.photo.alt', '{{name}} photo', { name: vehicle.display_name })}
              className="block w-full max-h-72 object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : null}

        {/* Vehicle identity and status summary */}
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Heading level="section" className="min-w-0 break-words">
                {vehicle.display_name}
              </Heading>
              <StatusBadge status={toStatus(vehicleState?.state ?? vehicle.state ?? 'offline')} />
            </div>
            <Text as="p" size="xs" color="muted" className="break-all font-mono">
              {vehicle.vin}
            </Text>
          </div>
          <Badge variant="neutral" size="sm">
            {vehicle.model}
          </Badge>
        </div>

        {hasTrustMetadata ? (
          <div className="min-w-0 space-y-2 break-words" data-stream-freshness={streamFreshness}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Text as="span" variant="label" color="secondary">{sourceLabel}</Text>
              <DataProvenanceBadge
                provenance={dataState?.provenance ?? 'unknown'}
                status={streamFreshness === 'fresh' ? dataState?.status : 'stale'}
              />
              {streamFreshness !== 'fresh' ? (
                <Text as="span" variant="bodySm" color="secondary">
                  {streamFreshness === 'stale'
                    ? t('freshness.stale', 'Stale')
                    : t('common.unknown', 'Unknown')}
                </Text>
              ) : null}
              {dataState?.isRefreshBlocked ? (
                <Text as="span" variant="bodySm" color="secondary">
                  {t('carbon.source.status.paused', 'Paused')}
                </Text>
              ) : null}
            </div>
            <Text as="p" variant="bodySm" color="secondary" title={observationDate ? formatDateTime(observationDate) : undefined}>
              {observationDate
                ? t('dashboard.fleetPosture.scope.observed', 'Last real observation {{age}}', {
                    age: formatRelative(observationDate),
                  })
                : t('dashboard.fleetPosture.scope.noObservation', 'No verified observation time for this vehicle')}
            </Text>
            <Text as="p" variant="bodySm" color="muted">
              {t('vehicleHero.observationLimitation', 'Telemetry stream observation does not verify individual reading timestamps or completeness.')}
            </Text>
          </div>
        ) : null}

        {showRefreshWarning && dataState ? (
          <StaleRefreshWarning
            state={{ ...dataState, hasData: true }}
            label={sourceLabel}
          />
        ) : null}
        <SourceContent
          state={sourceState}
          label={sourceLabel}
          emptyMessage={t('vehicleHero.noState', 'Live telemetry unavailable')}
          errorMessage={t('dashboard.fleetPosture.scope.failedHelp', 'The live-state request failed. This is a fact about our pipeline, not about the vehicle.')}
          error={dataState?.fatalError}
          errorRecovery={dataState?.retry ? { onRetry: dataState.retry } : undefined}
        >
        {/* Live battery / range / temperature gauges plus the detail cards.
            When telemetry is absent we render an explicit placeholder instead
            of collapsing the section, so the panel is never a blank shell. */}
        {vs ? (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <LinearGauge
                preserveReadingAndScale
                value={batteryReading}
                max={100}
                label={t('vehicleHero.gauge.battery', 'Battery')}
                unit="%"
                tone={batteryReading == null ? undefined : batteryReading > 20 ? 'info' : 'danger'}
                size={100}
              />
              <LinearGauge
                preserveReadingAndScale
                value={rangeDisplay}
                max={rangeMax}
                label={t('vehicleHero.gauge.range', 'Range')}
                unit={distanceLabel}
                tone="neutral"
                size={100}
              />
              <LinearGauge
                preserveReadingAndScale
                value={insideTempDisplay}
                {...tempRange}
                label={t('vehicleHero.gauge.inside', 'Inside')}
                unit={temperatureLabel}
                tone="neutral"
                size={100}
              />
              <LinearGauge
                preserveReadingAndScale
                value={outsideTempDisplay}
                {...tempRange}
                label={t('vehicleHero.gauge.outside', 'Outside')}
                unit={temperatureLabel}
                tone="neutral"
                size={100}
              />
            </div>

            {/* Detail cards mirror the same display-unit conversions as the gauges */}
            <Grid cols={STAT_GRID_COLS} gap={3}>
              <StatCard label={t('vehicleHero.stat.insideTemp', 'Inside temp')} value={insideTempDisplay ?? '—'} unit={temperatureLabel} />
              <StatCard label={t('vehicleHero.stat.outsideTemp', 'Outside temp')} value={outsideTempDisplay ?? '—'} unit={temperatureLabel} />
              <StatCard
                label={t('vehicleHero.stat.odometer', 'Odometer')}
                value={odometerDisplay}
                unit={distanceLabel}
              />
              <StatCard
                label={t('vehicleHero.stat.range', 'Range')}
                value={rangeDisplay ?? '—'}
                unit={distanceLabel}
              />
              <StatCard
                label={t('vehicleHero.stat.status', 'Status')}
                value={vs.is_locked == null ? '—' : vs.is_locked ? t('vehicleHero.locked', 'Locked') : t('vehicleHero.unlocked', 'Unlocked')}
              />
              <StatCard
                label={t('vehicleHero.stat.sentry', 'Sentry')}
                value={vs.sentry_mode == null ? '—' : vs.sentry_mode ? t('common.on', 'On') : t('common.off', 'Off')}
              />
              <StatCard label={t('vehicleHero.stat.firmware', 'Firmware')} value={vs.software_version?.trim() || '—'} />
              <StatCard
                label={t('vehicleHero.stat.power', 'Power')}
                value={isFiniteNumber(vs.power) ? fmtNumber(convertPowerFromSI(vs.power, unitPrefs.power)) : '—'}
                unit={unitPrefs.power}
              />
            </Grid>
          </>
        ) : (
          <EmptyState
            icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
            message={t('vehicleHero.noState', 'Live telemetry unavailable')}
          />
        )}
        </SourceContent>

        {/* Navigation actions for the vehicle */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
          <Link
            to={`/vehicles/${vehicle.id}`}
            className={cn(
              NAV_LINK_CLASS,
              'border border-[var(--semantic-info-border)] bg-[var(--semantic-info-bg)] text-[var(--semantic-info)] hover:bg-[var(--control-bg-hover)] forced-colors:border-[ButtonBorder]',
            )}
          >
            {t('vehicleHero.action.details', 'Details')}
          </Link>
          <Link
            to={`/vehicles/${vehicle.id}/commands`}
            className={cn(NAV_LINK_CLASS, BUTTON_VARIANTS.secondary)}
          >
            {t('vehicleHero.action.commands', 'Commands')}
          </Link>
          <Link
            to={`/vehicles/${vehicle.id}/map`}
            className={cn(NAV_LINK_CLASS, BUTTON_VARIANTS.secondary)}
          >
            {t('vehicleHero.action.liveMap', 'Live map')}
          </Link>
        </div>
      </GlassPanel>
    );
  },
);
VehicleHeroCard.displayName = 'VehicleHeroCard';
