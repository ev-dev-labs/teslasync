import { useQuery } from '@tanstack/react-query';
import { Car, Battery, Gauge, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { useSettings } from '@/hooks/useSettings';
import { getVehicleState } from '@/api/vehicles';
import type { Vehicle } from '@/api/types';
import type { VehicleState } from '@/api/types';

interface FleetSummaryProps {
  vehicles: Vehicle[];
}

export function FleetSummary({ vehicles }: FleetSummaryProps) {
  const { t } = useTranslation('vehicles');
  const { convertDistance, distanceUnit } = useSettings();

  const { data: allStates } = useQuery({
    queryKey: ['fleet-vehicle-states', vehicles.map(v => v.id).sort()],
    queryFn: async () => {
      const entries = await Promise.all(
        vehicles.map(async (v) => {
          try {
            const data = await getVehicleState(v.id);
            return data?.state ?? null;
          } catch {
            return null;
          }
        }),
      );
      return entries;
    },
    enabled: vehicles.length > 0,
    refetchInterval: 30_000,
  });

  const states = (allStates ?? []).filter(
    (s): s is VehicleState => s !== null && s !== undefined,
  );
  const avgBattery =
    states.length > 0
      ? states.reduce((sum, st) => sum + (st.battery_level ?? 0), 0) / states.length
      : 0;
  const totalRange = states.reduce((sum, st) => sum + (st.rated_range ?? 0), 0);
  const chargingCount = states.filter(st => st.is_charging).length;
  const onlineCount = states.length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-200">
        <Car className="h-5 w-5 text-cyan-400 mx-auto mb-2" />
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          <AnimatedNumber value={vehicles.length} />
        </p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {t('fleet.vehicles', 'Vehicles')}
        </p>
      </GlassPanel>

      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-200">
        <Battery className="h-5 w-5 text-green-500 mx-auto mb-2" />
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          <AnimatedNumber value={Math.round(avgBattery)} suffix="%" />
        </p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {t('fleet.avgBattery', 'Avg Battery')}
        </p>
      </GlassPanel>

      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-200">
        <Gauge className="h-5 w-5 text-purple-400 mx-auto mb-2" />
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          <AnimatedNumber value={Math.round(convertDistance(totalRange))} />
        </p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {t('fleet.totalRange', 'Total Range')} {distanceUnit}
        </p>
      </GlassPanel>

      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-200">
        <Zap className="h-5 w-5 text-amber-400 mx-auto mb-2" />
        <p className="text-2xl font-bold text-green-500">
          <AnimatedNumber value={chargingCount} />{' '}
          <span className="text-sm text-gray-500 dark:text-gray-400">/ {onlineCount}</span>
        </p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {t('fleet.chargingOnline', 'Charging / Online')}
        </p>
      </GlassPanel>
    </div>
  );
}
