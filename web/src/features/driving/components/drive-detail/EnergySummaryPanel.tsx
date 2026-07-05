import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryCharging } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtWithUnit } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

interface EnergySummaryPanelProps {
  drive: DriveDetail;
  stats: DriveStats;
}

/**
 * Render a battery percentage, guarding a missing reading with the universal
 * "—" placeholder. 0% is a valid charge level, so it must never stand in for
 * "unknown" — mirrors SessionDetailPanel.fmtSoc for cross-panel consistency.
 */
function fmtBatteryPct(pct: number | null | undefined): string {
  return typeof pct === 'number' && Number.isFinite(pct) ? `${pct}%` : '—';
}

/** Format an energy reading (Wh, SI) as kWh above 1 kWh, otherwise as Wh. */
function fmtEnergy(wh: number): string {
  return wh > 1000 ? fmtWithUnit(wh / 1000, 'kWh') : `${fmtNumber(wh)} Wh`;
}

export function EnergySummaryPanel({ drive, stats }: EnergySummaryPanelProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const headingId = useId();

  // Efficiency is a per-distance quantity — Wh per km at the SI floor
  // (stats.consumptionWhKm). Convert to Wh per the user's distance unit through
  // the shared SI converter (Wh/km ÷ display-units-per-km) rather than a
  // hand-typed mile factor; see unit-conversion.instructions.md.
  const displayUnitsPerKm = convertDistanceFromSI(1000, unitPrefs.distance);
  const toEfficiencyDisplay = (whPerKm: number) =>
    displayUnitsPerKm > 0 ? whPerKm / displayUnitsPerKm : whPerKm;

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const energyWh = stats.energyWh ?? 0;
  const regenWh = stats.regenWh ?? 0;
  const netWh = energyWh - regenWh;
  const consumptionWhKm = stats.consumptionWhKm ?? 0;

  return (
    <FadeIn>
      <GlassPanel className="p-5" role="region" aria-labelledby={headingId}>
        <h3 id={headingId} className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <BatteryCharging aria-hidden="true" className="h-4 w-4 text-green-400" /> {t('driveDetail.energySummary', 'Energy Summary')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
          <div>
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.energyConsumed', 'Energy Consumed')}</p>
            <p className="text-lg font-bold text-amber-400">{fmtEnergy(energyWh)}</p>
          </div>
          <div>
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.energyRecovered', 'Energy Recovered')}</p>
            <p className="text-lg font-bold text-green-400">{fmtEnergy(regenWh)}</p>
          </div>
          <div>
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.netConsumption', 'Net Consumption')}</p>
            <p className="text-lg font-bold text-cyan-400">{fmtEnergy(netWh)}</p>
          </div>
          <div>
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.efficiency', 'Efficiency')}</p>
            <p className="text-lg font-bold text-purple-400">{consumptionWhKm > 0 ? `${fmtNumber(toEfficiencyDisplay(consumptionWhKm))} ${efficiencyUnit}` : '—'}</p>
          </div>
          <div>
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.batteryUsed', 'Battery Used')}</p>
            <p className="text-lg font-bold text-amber-400">
              {drive.startBatteryPct != null && drive.endBatteryPct != null ? `${drive.startBatteryPct - drive.endBatteryPct}%` : '—'}
              <span className="text-xs text-[var(--text-muted)] ml-1">{fmtBatteryPct(drive.startBatteryPct)} → {fmtBatteryPct(drive.endBatteryPct)}</span>
            </p>
          </div>
          <div>
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.rangeUsed', 'Range Used')}</p>
            <p className="text-lg font-bold text-green-400">
              {stats.startRange != null && stats.endRange != null
                ? fmtWithUnit(stats.startRange - stats.endRange, distanceUnit)
                : '—'}
            </p>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
