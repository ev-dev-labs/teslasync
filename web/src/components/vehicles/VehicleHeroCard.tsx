import { forwardRef, type HTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { StatCard } from '@/components/data-display/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Grid } from '@/components/layout/Grid';
import { FSM_REGISTRY } from '@/types/fsm';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';
import type { VehicleStatus } from '@/api/types';

export interface VehicleHeroCardProps extends HTMLAttributes<HTMLDivElement> {
  vehicle: {
    id: number;
    display_name: string;
    model: string;
    vin: string;
    state: string;
  };
  vehicleState?: {
    battery_level: number;
    rated_range: number;
    inside_temp: number;
    outside_temp: number;
    odometer: number;
    is_charging: boolean;
    is_locked: boolean;
    sentry_mode: boolean;
    software_version: string;
    power: number;
    state?: string;
  } | null;
  /**
   * Optional URL for the user-uploaded hero photo. Passed in as a prop so
   * dashboards rendering many hero cards do not trigger one query per card.
   */
  photoUrl?: string | null;
  className?: string;
}

function toStatus(state: string): VehicleStatus {
  return state in FSM_REGISTRY.vehicle.states ? (state as VehicleStatus) : 'offline';
}

export const VehicleHeroCard = forwardRef<HTMLDivElement, VehicleHeroCardProps>(
  ({ vehicle, vehicleState, photoUrl, className, ...props }, ref) => {
    const { t } = useTranslation();
    const { unitPrefs } = useUnits();
    const vs = vehicleState;

    /* Convert SI base units (meters, °C) to the user's display units. The state
     * endpoint returns odometer and rated_range in meters; always pull the
     * suffix from `unitPrefs` so labels track Settings, never hardcoded units. */
    const distanceLabel = unitPrefs.distance;        // 'mi' | 'km'
    const temperatureLabel = unitPrefs.temperature;  // '°F' | '°C'

    const odometerDisplay = vs
      ? fmtInt(Math.round(convertDistanceFromSI(vs.odometer ?? 0, distanceLabel)))
      : '—';
    const rangeDisplay = vs
      ? Math.round(convertDistanceFromSI(vs.rated_range ?? 0, distanceLabel))
      : 0;
    const insideTempDisplay = vs ? Math.round(convertTempFromSI(vs.inside_temp ?? 0, temperatureLabel)) : 0;
    const outsideTempDisplay = vs ? Math.round(convertTempFromSI(vs.outside_temp ?? 0, temperatureLabel)) : 0;

    /* Range gauge max scales with display unit so the arc fills meaningfully
     * — Tesla long-range packs cap around 400 mi ≈ 644 km. */
    const rangeMax = distanceLabel === 'km' ? 644 : 400;
    const tempMax = temperatureLabel === '°C' ? 50 : 122;

    return (
      <GlassPanel
        ref={ref}
        glow="cyan"
        hover
        className={cn('p-6 space-y-6', className)}
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
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {vehicle.display_name}
              </h2>
              <StatusBadge status={toStatus(vehicleState?.state ?? vehicle.state ?? 'offline')} />
            </div>
            <p className="text-xs font-mono text-[var(--text-muted)] dark:text-[var(--text-muted)]">
              {vehicle.vin}
            </p>
          </div>
          <Badge variant="neutral" size="sm">
            {vehicle.model}
          </Badge>
        </div>

        {/* Current battery, range, and temperature gauges */}
        {vs && (
          <div className="flex flex-wrap items-center justify-center gap-6">
            <RadialGauge
              value={vs.battery_level}
              max={100}
              label={t('vehicleHero.gauge.battery', 'Battery')}
              unit="%"
              color={vs.battery_level > 20 ? '#22d3ee' : '#ef4444'}
              size={100}
            />
            <RadialGauge
              value={rangeDisplay}
              max={rangeMax}
              label={t('vehicleHero.gauge.range', 'Range')}
              unit={distanceLabel}
              color="#4ade80"
              size={100}
            />
            <RadialGauge
              value={insideTempDisplay}
              max={tempMax}
              label={t('vehicleHero.gauge.inside', 'Inside')}
              unit={temperatureLabel}
              color="#f59e0b"
              size={100}
            />
            <RadialGauge
              value={outsideTempDisplay}
              max={tempMax}
              label={t('vehicleHero.gauge.outside', 'Outside')}
              unit={temperatureLabel}
              color="#a78bfa"
              size={100}
            />
          </div>
        )}

        {/* Detail cards mirror the same display-unit conversions as the gauges */}
        {vs && (
          <Grid cols={{ default: 2, md: 4 }} gap={3}>
            <StatCard label={t('vehicleHero.stat.insideTemp', 'Inside Temp')} value={insideTempDisplay} unit={temperatureLabel} />
            <StatCard label={t('vehicleHero.stat.outsideTemp', 'Outside Temp')} value={outsideTempDisplay} unit={temperatureLabel} />
            <StatCard
              label={t('vehicleHero.stat.odometer', 'Odometer')}
              value={odometerDisplay}
              unit={distanceLabel}
            />
            <StatCard
              label={t('vehicleHero.stat.range', 'Range')}
              value={rangeDisplay}
              unit={distanceLabel}
            />
            <StatCard
              label={t('vehicleHero.stat.status', 'Status')}
              value={vs.is_locked ? t('vehicleHero.locked', 'Locked') : t('vehicleHero.unlocked', 'Unlocked')}
            />
            <StatCard
              label={t('vehicleHero.stat.sentry', 'Sentry')}
              value={vs.sentry_mode ? t('common.on', 'On') : t('common.off', 'Off')}
            />
            <StatCard label={t('vehicleHero.stat.firmware', 'Firmware')} value={vs.software_version} />
            <StatCard label={t('vehicleHero.stat.power', 'Power')} value={fmtNumber(vs.power)} unit="kW" />
          </Grid>
        )}

        {/* Navigation actions for the vehicle */}
        <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
          <Link
            to={`/vehicles/${vehicle.id}`}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20',
            )}
          >
            {t('vehicleHero.action.details', 'Details')}
          </Link>
          <Link
            to={`/vehicles/${vehicle.id}/commands`}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]',
            )}
          >
            {t('vehicleHero.action.commands', 'Commands')}
          </Link>
          <Link
            to={`/vehicles/${vehicle.id}/map`}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]',
            )}
          >
            {t('vehicleHero.action.liveMap', 'Live Map')}
          </Link>
        </div>
      </GlassPanel>
    );
  },
);
VehicleHeroCard.displayName = 'VehicleHeroCard';
