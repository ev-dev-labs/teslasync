import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { useSettings } from '@/hooks/useSettings';
import { fetchVehicleState } from '@/api/hooks/useVehicles';
import { fmtNumber } from '@/lib/numberFormat';
import { batteryColor } from '@/lib/colors';
import type { Vehicle, VehicleState } from '@/api/types';

interface BatteryComparisonProps {
  vehicles: Vehicle[];
}

export function BatteryComparison({ vehicles }: BatteryComparisonProps) {
  const { t } = useTranslation('vehicles');
  const { convertDistance, distanceUnit } = useSettings();

  const { data: allStates } = useQuery({
    queryKey: ['fleet-battery-states', vehicles.map(v => v.id).sort()],
    queryFn: async () => {
      const entries = await Promise.all(
        vehicles.map(async (v) => {
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

  const bars = (allStates ?? []).filter(
    (q): q is { vehicle: Vehicle; state: VehicleState } => q.state !== null,
  );

  if (bars.length === 0) return null;

  return (
    <GlassPanel className="p-5">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4 text-cyan-400" />
        {t('fleet.batteryStatus', 'Fleet Battery Status')}
      </h3>
      <div className="space-y-3">
        {bars.map(({ vehicle, state }) => {
          const level = state.battery_level ?? 0;
          const color = batteryColor(level);
          return (
            <div key={vehicle.id} className="flex items-center gap-3">
              <span className="text-xs text-gray-600 dark:text-gray-300 w-24 truncate">
                {vehicle.display_name || vehicle.vin}
              </span>
              <div className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${level}%`,
                    background: `linear-gradient(90deg, ${color}80, ${color})`,
                    boxShadow: `0 0 10px ${color}40`,
                  }}
                />
              </div>
              <span className="text-xs font-medium text-gray-900 dark:text-white w-10 text-right">
                {level}%
              </span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400 w-16 text-right">
                {fmtNumber(convertDistance(state.rated_range ?? 0))} {distanceUnit}
              </span>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
