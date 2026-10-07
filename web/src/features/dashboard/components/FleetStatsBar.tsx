import { useMemo } from 'react';
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
  const avgEfficiency = analytics?.avg_efficiency_wh_km ?? 0;

  // Null-safe, memoised sparkline series. Guarding each row with `?? 0` keeps a
  // drive/charge that is missing its metric (undefined at runtime) from
  // poisoning MiniChart's Math.min/max with NaN and rendering an invisible
  // polyline. `.map()` returns a fresh array, so the in-place `.reverse()` is
  // safe and never mutates the caller's data.
  const driveSparkline = useMemo(
    () => recentDrives?.map((d) => d.distance_m ?? 0).reverse() ?? [0],
    [recentDrives],
  );
  const chargeSparkline = useMemo(
    () => recentCharges?.map((s) => s.total_energy_added_wh ?? 0).reverse() ?? [0],
    [recentCharges],
  );

  const sizeLabel = t('fleet.size', 'Fleet Size');
  const distanceLabel = t('fleet.distance', 'Distance (30d)');
  const energyLabel = t('fleet.energy', 'Energy (30d)');
  const efficiencyLabel = t('fleet.efficiency', 'Efficiency');
  const alertsLabel = t('fleet.alerts', 'Alerts');

  return (
    <StaggerContainer className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <StaggerItem>
        <GlassPanel role="group" aria-label={sizeLabel} className="p-3 sm:p-4 text-center flex flex-col justify-center h-full">
          <p className="metric-label mb-1 text-2xs sm:text-xs">{sizeLabel}</p>
          <p className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
            <AnimatedNumber value={vehicleCount} />
          </p>
          <p className="text-2xs text-[var(--text-muted)] mt-1">
            {onlineCount} {t('fleet.online', 'online')}
          </p>
        </GlassPanel>
      </StaggerItem>

      <StaggerItem>
        <GlassPanel role="group" aria-label={distanceLabel} className="p-3 sm:p-4 text-center flex flex-col justify-center h-full">
          <p className="metric-label mb-1 text-2xs sm:text-xs">{distanceLabel}</p>
          <p className="text-xl sm:text-2xl font-bold text-cyan-300">
            <AnimatedNumber value={toDistanceDisplay(totalDistance)} suffix={` ${distanceUnit}`} />
          </p>
          <MiniChart data={driveSparkline} color="#00f0ff" height={24} width={60} />
        </GlassPanel>
      </StaggerItem>

      <StaggerItem>
        <GlassPanel role="group" aria-label={energyLabel} className="p-3 sm:p-4 text-center flex flex-col justify-center h-full">
          <p className="metric-label mb-1 text-2xs sm:text-xs">{energyLabel}</p>
          <p className="text-xl sm:text-2xl font-bold text-emerald-300">
            <AnimatedNumber value={totalEnergy} decimals={1} suffix=" kWh" />
          </p>
          <MiniChart data={chargeSparkline} color="#10b981" height={24} width={60} />
        </GlassPanel>
      </StaggerItem>

      <StaggerItem>
        <GlassPanel role="group" aria-label={efficiencyLabel} className="p-3 sm:p-4 text-center flex flex-col justify-center h-full">
          <p className="metric-label mb-1 text-2xs sm:text-xs">{efficiencyLabel}</p>
          <p className="text-xl sm:text-2xl font-bold text-amber-300">
            <AnimatedNumber value={toEfficiencyDisplay(avgEfficiency)} suffix={` ${efficiencyUnit}`} />
          </p>
          <p className="text-2xs text-[var(--text-muted)] mt-1">{t('fleet.average', 'fleet average')}</p>
        </GlassPanel>
      </StaggerItem>

      <StaggerItem>
        <GlassPanel role="group" aria-label={alertsLabel} className="p-3 sm:p-4 text-center flex flex-col justify-center h-full">
          <p className="metric-label mb-1 text-2xs sm:text-xs">{alertsLabel}</p>
          <p className={cn("text-xl sm:text-2xl font-bold", unreadAlerts > 0 ? "text-red-500" : "text-emerald-500")}>
            <AnimatedNumber value={unreadAlerts} />
          </p>
          <p className="text-2xs text-[var(--text-muted)] mt-1">{t('fleet.unread', 'unread')}</p>
        </GlassPanel>
      </StaggerItem>
    </StaggerContainer>
  );
}
