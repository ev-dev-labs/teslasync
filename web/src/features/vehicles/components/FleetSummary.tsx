import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Car, Battery, Gauge, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fetchVehicleState } from '@/api/hooks/useVehicles';
import { asFiniteNumber } from '@/lib/typeGuards';
import type { Vehicle } from '@/api/types';
import type { VehicleStateReadings } from '@/api/types';

interface FleetSummaryProps {
  vehicles: Vehicle[];
}

export function FleetSummary({ vehicles }: FleetSummaryProps) {
  const { t } = useTranslation('vehicles');
  const { unitPrefs } = useUnits();

  // Null-safety: a caller can pass hook data that is still `undefined` on the
  // first render — never call `.map`/`.length` on a possibly-undefined prop.
  const list = useMemo<Vehicle[]>(() => vehicles ?? [], [vehicles]);
  // Sorted id set → a query key that is stable across re-renders and only
  // changes when the fleet membership changes (not on mere re-order).
  const ids = useMemo(() => list.map((v) => v.id).sort((a, b) => a - b), [list]);

  const { data: allStates } = useQuery({
    queryKey: ['fleet-vehicle-states', ids],
    queryFn: async () => {
      const entries = await Promise.all(
        list.map(async (v) => {
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
    enabled: list.length > 0,
    refetchInterval: 30_000,
  });

  const { avgBattery, totalRangeMeters, chargingCount, onlineCount } = useMemo(() => {
    const states = (allStates ?? []).filter(
      (s): s is VehicleStateReadings => s !== null && s !== undefined,
    );
    const batteries = states.map((st) => asFiniteNumber(st.battery_level))
      .filter((level): level is number => level != null);
    const avg = batteries.length > 0
      ? batteries.reduce((sum, level) => sum + level, 0) / batteries.length
      : null;
    const ranges = states.map((st) => asFiniteNumber(st.rated_range));
    const rangeMeters = ranges.length > 0 && ranges.every((range) => range != null)
      ? ranges.reduce((sum, range) => sum + (range ?? 0), 0)
      : list.length === 0 ? 0 : null;
    return {
      avgBattery: avg,
      totalRangeMeters: rangeMeters,
      chargingCount: states.some((st) => st.is_charging == null)
        ? null : states.filter((st) => st.is_charging === true).length,
      onlineCount: states.some((st) => st.state == null) ? null : states.length,
    };
  }, [allStates, list.length]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-normal">
        <Car aria-hidden="true" className="h-5 w-5 text-cyan-400 mx-auto mb-2" />
        <p className="text-2xl font-bold text-[var(--text-primary)]">
          <AnimatedNumber value={list.length} />
        </p>
        <p className="text-2xs text-[var(--text-muted)] dark:text-[var(--text-muted)] tracking-wider">
          {t('fleet.vehicles', 'Vehicles')}
        </p>
      </GlassPanel>

      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-normal">
        <Battery aria-hidden="true" className="h-5 w-5 text-green-500 mx-auto mb-2" />
        <p className="text-2xl font-bold text-[var(--text-primary)]">
          {avgBattery == null ? '—' : <AnimatedNumber value={Math.round(avgBattery)} suffix="%" />}
        </p>
        <p className="text-2xs text-[var(--text-muted)] dark:text-[var(--text-muted)] tracking-wider">
          {t('fleet.avgBattery', 'Avg battery')}
        </p>
      </GlassPanel>

      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-normal">
        <Gauge aria-hidden="true" className="h-5 w-5 text-purple-400 mx-auto mb-2" />
        <p className="text-2xl font-bold text-[var(--text-primary)]">
          {totalRangeMeters == null ? '—' : <AnimatedNumber value={Math.round(convertDistanceFromSI(totalRangeMeters, unitPrefs.distance))} />}
        </p>
        <p className="text-2xs text-[var(--text-muted)] dark:text-[var(--text-muted)] tracking-wider">
          {t('fleet.totalRange', 'Total range')} {unitPrefs.distance}
        </p>
      </GlassPanel>

      <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-normal">
        <Zap aria-hidden="true" className="h-5 w-5 text-amber-400 mx-auto mb-2" />
        <p className="text-2xl font-bold text-green-500">
          {chargingCount == null ? '—' : <AnimatedNumber value={chargingCount} />}{' '}
          <span className="text-sm text-[var(--text-muted)] dark:text-[var(--text-muted)]">/ {onlineCount ?? '—'}</span>
        </p>
        <p className="text-2xs text-[var(--text-muted)] dark:text-[var(--text-muted)] tracking-wider">
          {t('fleet.chargingOnline', 'Charging / online')}
        </p>
      </GlassPanel>
    </div>
  );
}
