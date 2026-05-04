import { forwardRef, type HTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/numberFormat';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { StatCard } from '@/components/data-display/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Grid } from '@/components/layout/Grid';
import { FSM_REGISTRY } from '@/types/fsm';
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
  className?: string;
}

function toStatus(state: string): VehicleStatus {
  return state in FSM_REGISTRY.vehicle.states ? (state as VehicleStatus) : 'offline';
}

export const VehicleHeroCard = forwardRef<HTMLDivElement, VehicleHeroCardProps>(
  ({ vehicle, vehicleState, className, ...props }, ref) => {
    const { t } = useTranslation();
    const vs = vehicleState;

    return (
      <GlassPanel
        ref={ref}
        glow="cyan"
        hover
        className={cn('p-6 space-y-6', className)}
        {...props}
      >
        {/* Header */}
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

        {/* Radial gauges */}
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
              value={Math.round(vs.rated_range)}
              max={400}
              label={t('vehicleHero.gauge.range', 'Range')}
              unit="mi"
              color="#4ade80"
              size={100}
            />
            <RadialGauge
              value={Math.round(vs.inside_temp)}
              max={150}
              label={t('vehicleHero.gauge.inside', 'Inside')}
              unit="°F"
              color="#f59e0b"
              size={100}
            />
            <RadialGauge
              value={Math.round(vs.outside_temp)}
              max={150}
              label={t('vehicleHero.gauge.outside', 'Outside')}
              unit="°F"
              color="#a78bfa"
              size={100}
            />
          </div>
        )}

        {/* Detail cards */}
        {vs && (
          <Grid cols={{ default: 2, md: 4 }} gap={3}>
            <StatCard label={t('vehicleHero.stat.insideTemp', 'Inside Temp')} value={Math.round(vs.inside_temp)} unit="°F" />
            <StatCard label={t('vehicleHero.stat.outsideTemp', 'Outside Temp')} value={Math.round(vs.outside_temp)} unit="°F" />
            <StatCard
              label={t('vehicleHero.stat.odometer', 'Odometer')}
              value={vs.odometer.toLocaleString()}
              unit="mi"
            />
            <StatCard
              label={t('vehicleHero.stat.range', 'Range')}
              value={Math.round(vs.rated_range)}
              unit="mi"
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

        {/* Action buttons */}
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
