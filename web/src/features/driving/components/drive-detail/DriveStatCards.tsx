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

export function DriveStatCards({ drive, stats }: DriveStatCardsProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const { formatEnergyCost, currencySymbol, costPerDistanceUnit } = useFormatting();

  return (
    <>
      <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StaggerItem><IconStatCard icon={Route} color="#00f0ff" value={<AnimatedNumber value={toDistanceDisplay(drive.distanceM)} decimals={1} suffix={` ${distanceUnit}`} />} label={t('driveDetail.distance', 'Distance')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Clock} color="#f59e0b" value={formatDuration((drive.durationS) / 60)} label={t('driveDetail.duration', 'Duration')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Gauge} color="#a855f7" value={<AnimatedNumber value={stats.maxSpd} suffix={` ${speedUnit}`} />} label={t('driveDetail.maxSpeed', 'Max Speed')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={TrendingUp} color="#10b981" value={<AnimatedNumber value={stats.avgSpd} suffix={` ${speedUnit}`} />} label={t('driveDetail.avgSpeed', 'Avg Speed')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Battery} color="#10b981" value={`${fmtInt(drive.startBatteryPct)}% → ${fmtInt(drive.endBatteryPct)}%`} label={t('driveDetail.soc', 'SOC')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Zap} color="#f59e0b" value={fmtWithUnit(stats.powerMax, 'kW')} label={t('driveDetail.maxPower', 'Max Power')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Navigation} color="#10b981" value={<AnimatedNumber value={Math.round(stats.elevGain)} suffix=" m ↑" />} label={t('driveDetail.elevGain', 'Elev. Gain')} /></StaggerItem>
        <StaggerItem><IconStatCard icon={Navigation} color="#ef4444" value={<AnimatedNumber value={Math.round(stats.elevLoss)} suffix=" m ↓" />} label={t('driveDetail.elevLoss', 'Elev. Loss')} /></StaggerItem>
        {stats.energyWh > 0 && (
          <StaggerItem><IconStatCard icon={DollarSign} color="#10b981" value={formatEnergyCost(stats.energyWh / 1000)} label={t('driveDetail.tripCost', 'Trip Cost')} /></StaggerItem>
        )}
        {stats.energyWh > 0 && drive.distanceM > 0 && (
          <StaggerItem><IconStatCard icon={TrendingDown} color="#06b6d4" value={`${currencySymbol}${(costPerDistanceUnit(stats.energyWh / 1000, drive.distanceM) ?? 0).toFixed(3)}`} label={t('driveDetail.costPerUnit', { unit: distanceUnit, defaultValue: 'Cost / {{unit}}' })} /></StaggerItem>
        )}
      </StaggerContainer>

      {/* Battery Heater Status — field removed from new API */}
    </>
  );
}
