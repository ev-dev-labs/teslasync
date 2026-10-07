import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { fetchVehicleState } from '@/api/hooks/useVehicles';
import { batteryColor } from '@/lib/colors';
import type { Vehicle, VehicleState } from '@/api/types';

interface BatteryComparisonProps {
  vehicles: Vehicle[];
}

interface FleetBatteryEntry {
  vehicle: Vehicle;
  state: VehicleState | null;
}

/** Coerce an arbitrary battery reading into a safe 0–100 percentage. */
function clampPercent(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function BatteryComparison({ vehicles }: BatteryComparisonProps) {
  const { t } = useTranslation('vehicles');
  const { formatDistance } = useUnits();

  const { data: allStates, isLoading, refetch } = useQuery({
    queryKey: ['fleet-battery-states', vehicles.map((v) => v.id).sort((a, b) => a - b)],
    queryFn: async () => {
      const entries = await Promise.all(
        vehicles.map(async (v): Promise<FleetBatteryEntry> => {
          try {
            const data = await fetchVehicleState(v.id);
            return { vehicle: v, state: data?.state ?? null };
          } catch {
            return { vehicle: v, state: null };
          }
        }),
      );
      return entries;
    },
    enabled: vehicles.length > 0,
    refetchInterval: 30_000,
  });

  // Nothing to compare when the caller passes no vehicles — render nothing so
  // the parent layout doesn't reserve space for an inert widget.
  if (vehicles.length === 0) return null;

  const bars = (allStates ?? []).filter(
    (q): q is { vehicle: Vehicle; state: VehicleState } => q.state !== null,
  );

  return (
    <GlassPanel className="p-5">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4 text-cyan-400" aria-hidden="true" />
        {t('fleet.batteryStatus', 'Fleet Battery Status')}
      </h3>
      {isLoading ? (
        <div className="space-y-3" data-testid="battery-comparison-loading">
          <Skeleton lines={Math.min(vehicles.length, 4)} height={12} />
        </div>
      ) : bars.length === 0 ? (
        <EmptyState
          message={t('fleet.noBatteryData', 'No battery data available for the current fleet.')}
          action={{ label: t('common.retry', 'Retry'), onClick: () => void refetch() }}
        />
      ) : (
        <div className="space-y-3">
          {bars.map(({ vehicle, state }) => {
            const label =
              vehicle.display_name || vehicle.vin || t('fleet.unknownVehicle', 'Unknown vehicle');
            const level = clampPercent(state.battery_level);
            const color = batteryColor(level);
            const range = formatDistance(state.rated_range ?? 0);
            return (
              <div key={vehicle.id} className="flex items-center gap-3">
                <span
                  className="text-xs text-[var(--text-secondary)] w-24 truncate"
                  title={label}
                >
                  {label}
                </span>
                <div
                  className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden"
                  role="progressbar"
                  aria-valuenow={level}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${label} ${t('fleet.batteryLevel', 'battery level')}`}
                >
                  <div
                    className="h-full rounded-full transition-all duration-slow"
                    style={{
                      width: `${level}%`,
                      background: `linear-gradient(90deg, ${color}80, ${color})`,
                      boxShadow: `0 0 10px ${color}40`,
                    }}
                  />
                </div>
                <span className="text-xs font-medium text-[var(--text-primary)] w-10 text-right">
                  {level}%
                </span>
                <span className="text-2xs text-[var(--text-muted)] w-16 text-right">
                  {range}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}
