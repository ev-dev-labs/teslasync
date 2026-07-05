import { useTranslation } from 'react-i18next';
import {
  Route, Clock, Gauge, TrendingUp, Battery, Zap,
  Navigation, DollarSign, TrendingDown,
} from 'lucide-react';
import { AnimatedNumber } from '@/components/data-display';
import { StaggerContainer, StaggerItem } from '@/components/motion';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import { IconStatCard } from './IconStatCard';
import { formatDuration } from './helpers';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

interface DriveStatCardsProps {
  drive: DriveDetail;
  stats: DriveStats;
}

/**
 * Render a battery state-of-charge percentage. A missing reading
 * (null/undefined) must surface as the neutral em-dash placeholder — never a
 * fabricated "0%", which would read as a fully-drained pack rather than
 * "unknown". A genuine 0 still renders "0%".
 */
function formatBatteryPct(pct: number | null | undefined): string {
  return pct == null ? '—' : `${fmtInt(pct)}%`;
}

export function DriveStatCards({ drive, stats }: DriveStatCardsProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { formatEnergyCost, formatCurrency, costPerDistanceUnit } = useFormatting();

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;

  const distanceM = drive.distanceM;
  const distanceDisplay = convertDistanceFromSI(distanceM, distanceUnit);
  // Guard against a non-finite duration (a live/partial drive can report a
  // missing durationS) so the card never renders "NaNm".
  const durationMin = Number.isFinite(drive.durationS) ? drive.durationS / 60 : 0;
  const socLabel = `${formatBatteryPct(drive.startBatteryPct)} → ${formatBatteryPct(drive.endBatteryPct)}`;

  const energyKwh = stats.energyWh / 1000;
  const hasEnergy = stats.energyWh > 0;
  const hasCostPerDistance = hasEnergy && distanceM > 0;
  const costPerUnit = hasCostPerDistance
    ? costPerDistanceUnit(energyKwh, distanceM) ?? 0
    : 0;

  return (
    <>
      <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StaggerItem><IconStatCard icon={Route} color="#00f0ff" value={<AnimatedNumber value={distanceDisplay} decimals={1} suffix={` ${distanceUnit}`} />} label={t('driveDetail.distance', 'Distance')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Clock} color="#f59e0b" value={formatDuration(durationMin)} label={t('driveDetail.duration', 'Duration')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Gauge} color="#a855f7" value={<AnimatedNumber value={stats.maxSpd} suffix={` ${speedUnit}`} />} label={t('driveDetail.maxSpeed', 'Max Speed')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={TrendingUp} color="#10b981" value={<AnimatedNumber value={stats.avgSpd} suffix={` ${speedUnit}`} />} label={t('driveDetail.avgSpeed', 'Avg Speed')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Battery} color="#10b981" value={socLabel} label={t('driveDetail.soc', 'SOC')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Zap} color="#f59e0b" value={fmtWithUnit(stats.powerMax, 'kW')} label={t('driveDetail.maxPower', 'Max Power')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Navigation} color="#10b981" value={<AnimatedNumber value={Math.round(stats.elevGain)} suffix=" m ↑" />} label={t('driveDetail.elevGain', 'Elev. Gain')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Navigation} color="#ef4444" value={<AnimatedNumber value={Math.round(stats.elevLoss)} suffix=" m ↓" />} label={t('driveDetail.elevLoss', 'Elev. Loss')} /></StaggerItem>
        {hasEnergy && (
          <StaggerItem><IconStatCard icon={DollarSign} color="#10b981" value={formatEnergyCost(energyKwh)} label={t('driveDetail.tripCost', 'Trip Cost')} /></StaggerItem>
        )}
        {hasCostPerDistance && (
          <StaggerItem><IconStatCard icon={TrendingDown} color="#06b6d4" value={formatCurrency(costPerUnit, 3)} label={t('driveDetail.costPerUnit', { unit: distanceUnit, defaultValue: 'Cost / {{unit}}' })} /></StaggerItem>
        )}
      </StaggerContainer>

      {/* Battery Heater Status — field removed from new API */}
    </>
  );
}
