import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { MiniChart } from '@/components/charts/MiniChart';
import { StaggerContainer, StaggerItem } from '@/components/motion';
import type { FleetAnalytics, Drive, ChargingSession } from '../types';

interface FleetStatsBarProps {
  analytics: FleetAnalytics | undefined;
  vehicleCount: number;
  onlineCount: number;
  unreadAlerts: number;
  recentDrives: Drive[] | undefined;
  recentCharges: ChargingSession[] | undefined;
  toDistanceDisplay: (km: number) => number;
  toEfficiencyDisplay: (whKm: number) => number;
  distanceUnit: string;
  efficiencyUnit: string;
}

export function FleetStatsBar({
  analytics, vehicleCount, onlineCount, unreadAlerts,
  recentDrives, recentCharges,
  toDistanceDisplay, toEfficiencyDisplay, distanceUnit, efficiencyUnit,
}: FleetStatsBarProps) {
  const { t } = useTranslation('dashboard');
  const totalDistance = analytics?.total_distance_km ?? 0;
  const totalEnergy = analytics?.total_energy_kwh ?? 0;

  return (
    <StaggerContainer className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <StaggerItem>
        <GlassPanel className="p-3 sm:p-4 text-center flex flex-col justify-center h-full">
          <p className="metric-label mb-1 text-[10px] sm:text-xs">{t('fleet.size', 'Fleet Size')}</p>
          <p className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
            <AnimatedNumber value={vehicleCount} />
          </p>
          <p className="text-[10px] text-gray-600 mt-1">
            {onlineCount} {t('fleet.online', 'online')}
          </p>
        </GlassPanel>
      </StaggerItem>

      <StaggerItem>
        <GlassPanel className="p-3 sm:p-4 text-center flex flex-col justify-center h-full">
          <p className="metric-label mb-1 text-[10px] sm:text-xs">{t('fleet.distance', 'Distance (30d)')}</p>
          <p className="text-xl sm:text-2xl font-bold text-cyan-300">
            <AnimatedNumber value={toDistanceDisplay(totalDistance)} suffix={` ${distanceUnit}`} />
          </p>
          <MiniChart data={recentDrives?.map((d) => d.distance_m).reverse() ?? [0]} color="#00f0ff" height={24} width={60} />
        </GlassPanel>
      </StaggerItem>

      <StaggerItem>
        <GlassPanel className="p-3 sm:p-4 text-center flex flex-col justify-center h-full">
          <p className="metric-label mb-1 text-[10px] sm:text-xs">{t('fleet.energy', 'Energy (30d)')}</p>
          <p className="text-xl sm:text-2xl font-bold text-emerald-300">
            <AnimatedNumber value={totalEnergy} decimals={1} suffix=" kWh" />
          </p>
          <MiniChart data={recentCharges?.map((s) => s.total_energy_added_wh).reverse() ?? [0]} color="#10b981" height={24} width={60} />
        </GlassPanel>
      </StaggerItem>

      <StaggerItem>
        <GlassPanel className="p-3 sm:p-4 text-center flex flex-col justify-center h-full">
          <p className="metric-label mb-1 text-[10px] sm:text-xs">{t('fleet.efficiency', 'Efficiency')}</p>
          <p className="text-xl sm:text-2xl font-bold text-amber-300">
            <AnimatedNumber value={toEfficiencyDisplay(analytics?.avg_efficiency_wh_km ?? 0)} suffix={` ${efficiencyUnit}`} />
          </p>
          <p className="text-[10px] text-gray-600 mt-1">{t('fleet.average', 'fleet average')}</p>
        </GlassPanel>
      </StaggerItem>

      <StaggerItem>
        <GlassPanel className="p-3 sm:p-4 text-center flex flex-col justify-center h-full">
          <p className="metric-label mb-1 text-[10px] sm:text-xs">{t('fleet.alerts', 'Alerts')}</p>
          <p className={cn("text-xl sm:text-2xl font-bold", unreadAlerts > 0 ? "text-red-500" : "text-emerald-500")}>
            <AnimatedNumber value={unreadAlerts} />
          </p>
          <p className="text-[10px] text-gray-600 mt-1">{t('fleet.unread', 'unread')}</p>
        </GlassPanel>
      </StaggerItem>
    </StaggerContainer>
  );
}
