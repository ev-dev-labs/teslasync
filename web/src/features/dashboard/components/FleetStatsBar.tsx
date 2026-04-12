import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { MiniChart } from '@/components/charts/MiniChart';
import type { FleetAnalytics, Drive, ChargingSession } from '../types';

interface FleetStatsBarProps {
  analytics: FleetAnalytics | undefined;
  vehicleCount: number;
  onlineCount: number;
  unreadAlerts: number;
  recentDrives: Drive[] | undefined;
  recentCharges: ChargingSession[] | undefined;
  convertDistance: (km: number) => number;
  convertEfficiency: (whKm: number) => number;
  distanceUnit: string;
  efficiencyUnit: string;
}

export function FleetStatsBar({
  analytics, vehicleCount, onlineCount, unreadAlerts,
  recentDrives, recentCharges,
  convertDistance, convertEfficiency, distanceUnit, efficiencyUnit,
}: FleetStatsBarProps) {
  const { t } = useTranslation('dashboard');
  const totalDistance = analytics?.total_distance_km ?? 0;
  const totalEnergy = analytics?.total_energy_kwh ?? 0;

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <GlassPanel className="p-3 sm:p-4 text-center flex flex-col justify-center">
        <p className="metric-label mb-1 text-[10px] sm:text-xs">{t('fleet.size', 'Fleet Size')}</p>
        <p className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
          <AnimatedNumber value={vehicleCount} />
        </p>
        <p className="text-[10px] text-gray-600 mt-1">
          {onlineCount} {t('fleet.online', 'online')}
        </p>
      </GlassPanel>

      <GlassPanel className="p-3 sm:p-4 text-center flex flex-col justify-center">
        <p className="metric-label mb-1 text-[10px] sm:text-xs">{t('fleet.distance', 'Distance (30d)')}</p>
        <p className="text-xl sm:text-2xl font-bold text-neon-cyan">
          <AnimatedNumber value={convertDistance(totalDistance)} suffix={` ${distanceUnit}`} />
        </p>
        <MiniChart data={recentDrives?.map((d) => d.distance).reverse() ?? [0]} color="#00f0ff" height={24} width={60} />
      </GlassPanel>

      <GlassPanel className="p-3 sm:p-4 text-center flex flex-col justify-center">
        <p className="metric-label mb-1 text-[10px] sm:text-xs">{t('fleet.energy', 'Energy (30d)')}</p>
        <p className="text-xl sm:text-2xl font-bold text-neon-green">
          <AnimatedNumber value={totalEnergy} decimals={1} suffix=" kWh" />
        </p>
        <MiniChart data={recentCharges?.map((s) => s.charge_energy_added).reverse() ?? [0]} color="#10b981" height={24} width={60} />
      </GlassPanel>

      <GlassPanel className="p-3 sm:p-4 text-center flex flex-col justify-center">
        <p className="metric-label mb-1 text-[10px] sm:text-xs">{t('fleet.efficiency', 'Efficiency')}</p>
        <p className="text-xl sm:text-2xl font-bold text-neon-amber">
          <AnimatedNumber value={convertEfficiency(analytics?.avg_efficiency_wh_km ?? 0)} suffix={` ${efficiencyUnit}`} />
        </p>
        <p className="text-[10px] text-gray-600 mt-1">{t('fleet.average', 'fleet average')}</p>
      </GlassPanel>

      <GlassPanel className="p-3 sm:p-4 text-center flex flex-col justify-center">
        <p className="metric-label mb-1 text-[10px] sm:text-xs">{t('fleet.alerts', 'Alerts')}</p>
        <p className="text-xl sm:text-2xl font-bold" style={{ color: unreadAlerts > 0 ? '#ef4444' : '#10b981' }}>
          <AnimatedNumber value={unreadAlerts} />
        </p>
        <p className="text-[10px] text-gray-600 mt-1">{t('fleet.unread', 'unread')}</p>
      </GlassPanel>
    </div>
  );
}
