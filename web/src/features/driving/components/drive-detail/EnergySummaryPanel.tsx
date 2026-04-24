import { useTranslation } from 'react-i18next';
import { BatteryCharging } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtWithUnit } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

interface EnergySummaryPanelProps {
  drive: DriveDetail;
  stats: DriveStats;
}

export function EnergySummaryPanel({ drive, stats }: EnergySummaryPanelProps) {
  const { t } = useTranslation();
  const { convertEfficiency, efficiencyUnit } = useSettings();

  return (
    <FadeIn>
      <GlassPanel className="p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <BatteryCharging className="h-4 w-4 text-green-400" /> {t('driveDetail.energySummary', 'Energy Summary')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
          <div>
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.energyConsumed', 'Energy Consumed')}</p>
            <p className="text-lg font-bold text-amber-400">{stats.energyWh > 1000 ? fmtWithUnit(stats.energyWh / 1000, 'kWh') : `${fmtNumber(stats.energyWh)} Wh`}</p>
          </div>
          <div>
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.energyRecovered', 'Energy Recovered')}</p>
            <p className="text-lg font-bold text-green-400">{stats.regenWh > 1000 ? fmtWithUnit(stats.regenWh / 1000, 'kWh') : `${fmtNumber(stats.regenWh)} Wh`}</p>
          </div>
          <div>
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.netConsumption', 'Net Consumption')}</p>
            <p className="text-lg font-bold text-cyan-400">{(stats.energyWh - stats.regenWh) > 1000 ? fmtWithUnit((stats.energyWh - stats.regenWh) / 1000, 'kWh') : `${fmtNumber(stats.energyWh - stats.regenWh)} Wh`}</p>
          </div>
          <div>
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.efficiency', 'Efficiency')}</p>
            <p className="text-lg font-bold text-purple-400">{stats.consumptionWhKm > 0 ? `${fmtNumber(convertEfficiency(stats.consumptionWhKm))} ${efficiencyUnit}` : '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.batteryUsed', 'Battery Used')}</p>
            <p className="text-lg font-bold text-amber-400">
              {drive.startBatteryPct != null && drive.endBatteryPct != null ? `${drive.startBatteryPct - drive.endBatteryPct}%` : '—'}
              <span className="text-xs text-[var(--text-muted)] ml-1">{drive.startBatteryPct ?? '?'}% → {drive.endBatteryPct ?? '?'}%</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.rangeUsed', 'Range Used')}</p>
            <p className="text-lg font-bold text-green-400">—</p>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
