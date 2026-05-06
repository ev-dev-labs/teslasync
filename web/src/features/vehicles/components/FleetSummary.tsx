import { useQuery } from '@tanstack/react-query';
import { Car, Battery, Gauge, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fetchVehicleState } from '@/api/hooks/useVehicles';
import type { Vehicle } from '@/api/types';
import type { VehicleState } from '@/api/types';

interface FleetSummaryProps {
  vehicles: Vehicle[];
}

export function FleetSummary({ vehicles }: FleetSummaryProps) {
  const { t } = useTranslation('vehicles');
  const { unitPrefs } = useUnits();

  const { data: allStates } = useQuery({
    queryKey: ['fleet-vehicle-states', vehicles.map(v => v.id).sort()],
    queryFn: async () => {
      const entries = await Promise.all(
        vehicles.map(async (v) => {
          try {
            const data = await fetchVehicleState(v.id);
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
  // Sum is in SI metres (VehicleState.rated_range is metres). Convert at display.
  const totalRangeMeters = states.reduce((sum, st) => sum + (st.rated_range ?? 0), 0);
  const chargingCount = states.filter(st => st.is_charging).length;
  const onlineCount = states.length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-normal">
        <Car className="h-5 w-5 text-cyan-400 mx-auto mb-2" />
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          <AnimatedNumber value={vehicles.length} />
        </p>
        <p className="text-[10px] text-[var(--text-muted)] dark:text-[var(--text-muted)] uppercase tracking-wider">
          {t('fleet.vehicles', 'Vehicles')}
        </p>
      </GlassPanel>

      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-normal">
        <Battery className="h-5 w-5 text-green-500 mx-auto mb-2" />
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          <AnimatedNumber value={Math.round(avgBattery)} suffix="%" />
        </p>
        <p className="text-[10px] text-[var(--text-muted)] dark:text-[var(--text-muted)] uppercase tracking-wider">
          {t('fleet.avgBattery', 'Avg Battery')}
        </p>
      </GlassPanel>

      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-normal">
        <Gauge className="h-5 w-5 text-purple-400 mx-auto mb-2" />
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          <AnimatedNumber value={Math.round(convertDistanceFromSI(totalRangeMeters, unitPrefs.distance))} />
        </p>
        <p className="text-[10px] text-[var(--text-muted)] dark:text-[var(--text-muted)] uppercase tracking-wider">
          {t('fleet.totalRange', 'Total Range')} {unitPrefs.distance}
        </p>
      </GlassPanel>

      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-normal">
        <Zap className="h-5 w-5 text-amber-400 mx-auto mb-2" />
        <p className="text-2xl font-bold text-green-500">
          <AnimatedNumber value={chargingCount} />{' '}
          <span className="text-sm text-[var(--text-muted)] dark:text-[var(--text-muted)]">/ {onlineCount}</span>
        </p>
        <p className="text-[10px] text-[var(--text-muted)] dark:text-[var(--text-muted)] uppercase tracking-wider">
          {t('fleet.chargingOnline', 'Charging / Online')}
        </p>
      </GlassPanel>
    </div>
  );
}
