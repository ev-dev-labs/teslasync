import { useTranslation } from 'react-i18next';
import { Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

interface MoreDetailsPanelProps {
  drive: DriveDetail;
  stats: DriveStats;
}

export function MoreDetailsPanel({ drive, stats }: MoreDetailsPanelProps) {
  const { t } = useTranslation();
  const { convertDistance, convertEfficiency, distanceUnit, speedUnit, tempUnit, efficiencyUnit } = useSettings();

  return (
    <FadeIn>
      <GlassPanel className="p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-cyan-400" /> {t('driveDetail.moreDetails', 'More Details')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
          <div className="text-center">
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.odometer', 'Odometer (From → To)')}</p>
            <p className="text-lg font-bold text-cyan-400">
              {drive.startOdometer && drive.endOdometer
                ? `${fmtNumber(convertDistance(drive.startOdometer))} → ${fmtNumber(convertDistance(drive.endOdometer))}`
                : '—'}{' '}
              <span className="text-xs text-[var(--text-muted)]">{distanceUnit}</span>
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-[var(--text-muted)] mb-1">
              {t('driveDetail.rangeStartEnd', 'Range (Start → End)')}
            </p>
            <p className="text-lg font-bold text-green-400">
              {stats.startRange != null
                ? `${fmtNumber(stats.startRange)} → ${stats.endRange != null ? fmtNumber(stats.endRange) : '?'}`
                : '—'}{' '}
              <span className="text-xs text-[var(--text-muted)]">{distanceUnit}</span>
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.elevSummary', 'Elevation Summary')}</p>
            <div className="text-base font-bold">
              <span className="text-green-400 flex items-center justify-center gap-1"><ArrowUpRight className="h-3 w-3" />{fmtNumber(stats.elevGain)} m</span>
              <span className="text-red-400 flex items-center justify-center gap-1"><ArrowDownRight className="h-3 w-3" />{fmtNumber(stats.elevLoss)} m</span>
            </div>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.energyConsumed', 'Energy Consumed')}</p>
            <p className="text-lg font-bold text-amber-400">
              {stats.energyWh > 1000 ? fmtWithUnit(stats.energyWh / 1000, 'kWh') : `${fmtNumber(stats.energyWh)} Wh`}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.energyRecovered', 'Energy Recovered')}</p>
            <p className="text-lg font-bold text-green-400">
              {stats.regenWh > 1000 ? fmtWithUnit(stats.regenWh / 1000, 'kWh') : `${fmtNumber(stats.regenWh)} Wh`}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.consumptionRate', 'Consumption')}</p>
            <p className="text-lg font-bold text-purple-400">
              {stats.consumptionWhKm > 0 ? `${fmtNumber(convertEfficiency(stats.consumptionWhKm))}` : '—'}{' '}
              <span className="text-xs text-[var(--text-muted)]">{efficiencyUnit}</span>
            </p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.avgPower', 'Avg Power')}</p>
            <p className="text-lg font-bold text-amber-400">{fmtNumber(stats.avgPower)} <span className="text-xs text-[var(--text-muted)]">kW</span></p>
          </div>
          {stats.avgOutsideTemp !== null && (
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.avgOutsideTemp', 'Avg Outside Temp')}</p>
              <p className="text-lg font-bold text-blue-400">{fmtNumber(stats.avgOutsideTemp)}{tempUnit}</p>
            </div>
          )}
          {stats.avgInsideTemp !== null && (
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">
                {t('driveDetail.avgInsideTemp', 'Avg Inside Temp')}
              </p>
              <p className="text-lg font-bold text-orange-400">
                {fmtNumber(stats.avgInsideTemp)}{tempUnit}
              </p>
            </div>
          )}
          <div className="text-center">
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.minSpeed', 'Min Speed')}</p>
            <p className="text-lg font-bold text-[var(--text-secondary)]">{fmtInt(stats.minSpd)} {speedUnit}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.batteryUsed', 'Battery Used')}</p>
            <p className="text-lg font-bold text-amber-400">
              {drive.startBatteryLevel != null && drive.endBatteryLevel != null
                ? `${drive.startBatteryLevel - drive.endBatteryLevel}%`
                : '—'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.netEnergy', 'Net Consumption')}</p>
            <p className="text-lg font-bold text-cyan-400">
              {(stats.energyWh - stats.regenWh) > 1000
                ? fmtWithUnit((stats.energyWh - stats.regenWh) / 1000, 'kWh')
                : `${fmtNumber(stats.energyWh - stats.regenWh)} Wh`}
            </p>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
