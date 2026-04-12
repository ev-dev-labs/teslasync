import { forwardRef, type HTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { StatusBadge } from '@/components/ui';
import { StatCard } from '@/components/data-display/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Grid } from '@/components/layout/Grid';

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
  } | null;
  className?: string;
}

type VehicleStatus = 'online' | 'offline' | 'asleep' | 'driving' | 'charging' | 'updating';

const VALID_STATUSES: ReadonlySet<string> = new Set<VehicleStatus>([
  'online', 'offline', 'asleep', 'driving', 'charging', 'updating',
]);

function toStatus(state: string): VehicleStatus {
  return VALID_STATUSES.has(state) ? (state as VehicleStatus) : 'offline';
}

export const VehicleHeroCard = forwardRef<HTMLDivElement, VehicleHeroCardProps>(
  ({ vehicle, vehicleState, className, ...props }, ref) => {
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
              <StatusBadge status={toStatus(vehicle.state)} />
            </div>
            <p className="text-xs font-mono text-gray-500 dark:text-gray-400">
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
              label="Battery"
              unit="%"
              color={vs.battery_level > 20 ? '#22d3ee' : '#ef4444'}
              size={100}
            />
            <RadialGauge
              value={Math.round(vs.rated_range)}
              max={400}
              label="Range"
              unit="mi"
              color="#4ade80"
              size={100}
            />
            <RadialGauge
              value={Math.round(vs.inside_temp)}
              max={150}
              label="Inside"
              unit="°F"
              color="#f59e0b"
              size={100}
            />
            <RadialGauge
              value={Math.round(vs.outside_temp)}
              max={150}
              label="Outside"
              unit="°F"
              color="#a78bfa"
              size={100}
            />
          </div>
        )}

        {/* Detail cards */}
        {vs && (
          <Grid cols={{ default: 2, md: 4 }} gap={3}>
            <StatCard label="Inside Temp" value={Math.round(vs.inside_temp)} unit="°F" />
            <StatCard label="Outside Temp" value={Math.round(vs.outside_temp)} unit="°F" />
            <StatCard
              label="Odometer"
              value={vs.odometer.toLocaleString()}
              unit="mi"
            />
            <StatCard
              label="Range"
              value={Math.round(vs.rated_range)}
              unit="mi"
            />
            <StatCard
              label="Status"
              value={vs.is_locked ? 'Locked' : 'Unlocked'}
            />
            <StatCard
              label="Sentry"
              value={vs.sentry_mode ? 'On' : 'Off'}
            />
            <StatCard label="Firmware" value={vs.software_version} />
            <StatCard label="Power" value={vs.power} unit="kW" />
          </Grid>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3 pt-2 border-t border-white/10">
          <Link
            to={`/vehicles/${vehicle.id}`}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20',
            )}
          >
            Details
          </Link>
          <Link
            to={`/vehicles/${vehicle.id}/commands`}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-white/5 text-gray-300 hover:bg-white/10',
            )}
          >
            Commands
          </Link>
          <Link
            to={`/vehicles/${vehicle.id}/map`}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-white/5 text-gray-300 hover:bg-white/10',
            )}
          >
            Live Map
          </Link>
        </div>
      </GlassPanel>
    );
  },
);
VehicleHeroCard.displayName = 'VehicleHeroCard';
