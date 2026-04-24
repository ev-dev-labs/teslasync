import { useTranslation } from 'react-i18next';
import { DollarSign } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

interface CostSavingsPanelProps {
  drive: DriveDetail;
  stats: DriveStats;
}

export function CostSavingsPanel({ drive, stats }: CostSavingsPanelProps) {
  const { t } = useTranslation();
  const {
    costPerKwh, currencySymbol, formatEnergyCost, formatCurrency,
    costPerDistanceUnit, estimateGasCost, distanceUnit, settings,
  } = useSettings();

  const gasCost = estimateGasCost(drive.distanceMi);
  const evCost = (stats.energyWh / 1000) * costPerKwh;
  const savings = gasCost != null ? gasCost - evCost : null;

  return (
    <FadeIn>
      <GlassPanel className="p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <DollarSign className="h-4 w-4 text-green-400" /> {t('driveDetail.costSavings', 'Cost & Savings')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-center">
          <div>
            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.tripCost', 'Trip Cost')}</p>
            <p className="text-lg font-bold text-green-400">{formatEnergyCost(stats.energyWh / 1000)}</p>
            <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.atRate', `at ${currencySymbol}${costPerKwh}/kWh`)}</p>
          </div>
          {drive.distanceMi > 0 && (
            <div>
              <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.costPerUnit', `Cost / ${distanceUnit}`)}</p>
              <p className="text-lg font-bold text-cyan-400">
                {formatCurrency(costPerDistanceUnit(stats.energyWh / 1000, drive.distanceMi) ?? 0, 3)}
              </p>
            </div>
          )}
          {savings != null && savings > 0 && (
            <>
              <div>
                <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.gasCostEquiv', 'Gas Cost (equiv)')}</p>
                <p className="text-lg font-bold text-red-400">{formatCurrency(gasCost!)}</p>
                <p className="text-[9px] text-[var(--text-muted)]">{t('driveDetail.atMpg', `at ${settings.gas_efficiency_mpg} MPG`)}</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.gasSavings', 'vs Gas Savings')}</p>
                <p className="text-lg font-bold text-emerald-400">{formatCurrency(savings)}</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('driveDetail.savingsPct', 'Savings %')}</p>
                <p className="text-lg font-bold text-emerald-400">
                  {fmtNumber((savings / gasCost!) * 100, 0)}%
                </p>
              </div>
            </>
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
