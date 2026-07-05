import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

interface MoreDetailsPanelProps {
  drive: DriveDetail;
  stats: DriveStats;
}

/** Format an energy reading (Wh, SI) as kWh above 1 kWh, otherwise as Wh. */
function fmtEnergy(wh: number): string {
  return wh > 1000 ? fmtWithUnit(wh / 1000, 'kWh') : `${fmtNumber(wh)} Wh`;
}

export function MoreDetailsPanel({ drive, stats }: MoreDetailsPanelProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const headingId = useId();

  // Efficiency is Wh per km at the SI floor (stats.consumptionWhKm). Convert to
  // Wh per the user's distance unit through the shared SI converter
  // (Wh/km ÷ display-units-per-km) rather than a hand-typed mile factor; see
  // unit-conversion.instructions.md.
  const displayUnitsPerKm = convertDistanceFromSI(1000, unitPrefs.distance);
  const toEfficiencyDisplay = (whPerKm: number) =>
    displayUnitsPerKm > 0 ? whPerKm / displayUnitsPerKm : whPerKm;

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const energyWh = stats.energyWh ?? 0;
  const regenWh = stats.regenWh ?? 0;
  const netWh = energyWh - regenWh;
  const consumptionWhKm = stats.consumptionWhKm ?? 0;
  const elevGain = stats.elevGain ?? 0;
  const elevLoss = stats.elevLoss ?? 0;
  const avgPower = stats.avgPower ?? 0;
  const minSpd = stats.minSpd ?? 0;

  return (
    <FadeIn>
      <GlassPanel className="p-5" role="region" aria-labelledby={headingId}>
        <h3 id={headingId} className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <Activity aria-hidden="true" className="h-4 w-4 text-cyan-400" /> {t('driveDetail.moreDetails', 'More Details')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
          <div className="text-center">
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.odometer', 'Odometer (From → To)')}</p>
            <p className="text-lg font-bold text-cyan-400">
              {stats.odometerStart && stats.odometerEnd
                ? `${fmtNumber(stats.odometerStart)} → ${fmtNumber(stats.odometerEnd)}`
                : '—'}{' '}
              <span className="text-xs text-[var(--text-muted)]">{distanceUnit}</span>
            </p>
          </div>
          <div className="text-center">
            <p className="text-2xs text-[var(--text-muted)] mb-1">
              {t('driveDetail.rangeStartEnd', 'Range (Start → End)')}
            </p>
            <p className="text-lg font-bold text-green-400">
              {stats.startRange != null
                ? `${fmtNumber(stats.startRange)} → ${stats.endRange != null ? fmtNumber(stats.endRange) : '—'}`
                : '—'}{' '}
              <span className="text-xs text-[var(--text-muted)]">{distanceUnit}</span>
            </p>
          </div>
          <div className="text-center">
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.elevSummary', 'Elevation Summary')}</p>
            <div className="text-base font-bold">
              <span className="text-green-400 flex items-center justify-center gap-1"><ArrowUpRight aria-hidden="true" className="h-3 w-3" />{fmtNumber(elevGain)} m</span>
              <span className="text-red-400 flex items-center justify-center gap-1"><ArrowDownRight aria-hidden="true" className="h-3 w-3" />{fmtNumber(elevLoss)} m</span>
            </div>
          </div>
          <div className="text-center">
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.energyConsumed', 'Energy Consumed')}</p>
            <p className="text-lg font-bold text-amber-400">{fmtEnergy(energyWh)}</p>
          </div>
          <div className="text-center">
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.energyRecovered', 'Energy Recovered')}</p>
            <p className="text-lg font-bold text-green-400">{fmtEnergy(regenWh)}</p>
          </div>
          <div className="text-center">
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.consumptionRate', 'Consumption')}</p>
            <p className="text-lg font-bold text-purple-400">
              {consumptionWhKm > 0 ? fmtNumber(toEfficiencyDisplay(consumptionWhKm)) : '—'}{' '}
              <span className="text-xs text-[var(--text-muted)]">{efficiencyUnit}</span>
            </p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.avgPower', 'Avg Power')}</p>
            <p className="text-lg font-bold text-amber-400">{fmtNumber(avgPower)} <span className="text-xs text-[var(--text-muted)]">kW</span></p>
          </div>
          {stats.avgOutsideTemp !== null && (
            <div className="text-center">
              <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.avgOutsideTemp', 'Avg Outside Temp')}</p>
              <p className="text-lg font-bold text-blue-400">{fmtNumber(stats.avgOutsideTemp)}{tempUnit}</p>
            </div>
          )}
          {stats.avgInsideTemp !== null && (
            <div className="text-center">
              <p className="text-2xs text-[var(--text-muted)] mb-1">
                {t('driveDetail.avgInsideTemp', 'Avg Inside Temp')}
              </p>
              <p className="text-lg font-bold text-orange-400">
                {fmtNumber(stats.avgInsideTemp)}{tempUnit}
              </p>
            </div>
          )}
          <div className="text-center">
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.minSpeed', 'Min Speed')}</p>
            <p className="text-lg font-bold text-[var(--text-secondary)]">{fmtInt(minSpd)} {speedUnit}</p>
          </div>
          <div className="text-center">
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.batteryUsed', 'Battery Used')}</p>
            <p className="text-lg font-bold text-amber-400">
              {drive.startBatteryPct != null && drive.endBatteryPct != null
                ? `${drive.startBatteryPct - drive.endBatteryPct}%`
                : '—'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.netEnergy', 'Net Consumption')}</p>
            <p className="text-lg font-bold text-cyan-400">{fmtEnergy(netWh)}</p>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
