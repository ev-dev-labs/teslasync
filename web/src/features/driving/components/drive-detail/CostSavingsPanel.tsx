import { useTranslation } from 'react-i18next';
import { DollarSign } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

interface CostSavingsPanelProps {
  drive: DriveDetail;
  stats: DriveStats;
}

export function CostSavingsPanel({ drive, stats }: CostSavingsPanelProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { unitPrefs } = useUnits();
  const {
    costPerKwh,
    currencySymbol,
    formatEnergyCost,
    formatCurrency,
    costPerDistanceUnit,
    estimateGasCost,
  } = useFormatting();

  const distanceUnit = unitPrefs.distance;
  const distanceM = drive.distanceM ?? 0;
  const energyKwh = (stats.energyWh ?? 0) / 1000;

  const gasCost = estimateGasCost(distanceM);
  const evCost = energyKwh * costPerKwh;
  const savings = gasCost != null ? gasCost - evCost : null;
  const showGasComparison = gasCost != null && savings != null && savings > 0;
  const savingsPct =
    gasCost != null && gasCost > 0 && savings != null ? (savings / gasCost) * 100 : null;

  return (
    <FadeIn>
      <GlassPanel className="p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <DollarSign className="h-4 w-4 text-green-400" aria-hidden="true" /> {t('driveDetail.costSavings', 'Cost & Savings')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-center">
          <div>
            <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.tripCost', 'Trip Cost')}</p>
            <p className="text-lg font-bold text-green-400">{formatEnergyCost(energyKwh)}</p>
            <p className="text-2xs text-[var(--text-muted)]">{t('driveDetail.atRate', { currencySymbol, costPerKwh, defaultValue: 'at {{currencySymbol}}{{costPerKwh}}/kWh' })}</p>
          </div>
          {distanceM > 0 && (
            <div>
              <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.costPerUnit', { unit: distanceUnit, defaultValue: 'Cost / {{unit}}' })}</p>
              <p className="text-lg font-bold text-cyan-400">
                {formatCurrency(costPerDistanceUnit(energyKwh, distanceM) ?? 0, 3)}
              </p>
            </div>
          )}
          {showGasComparison && (
            <>
              <div>
                <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.gasCostEquiv', 'Gas Cost (equiv)')}</p>
                <p className="text-lg font-bold text-red-400">{formatCurrency(gasCost ?? 0)}</p>
                <p className="text-2xs text-[var(--text-muted)]">{t('driveDetail.atMpg', { mpg: settings.gas_efficiency_mpg, defaultValue: 'at {{mpg}} MPG' })}</p>
              </div>
              <div>
                <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.gasSavings', 'vs Gas Savings')}</p>
                <p className="text-lg font-bold text-emerald-400">{formatCurrency(savings ?? 0)}</p>
              </div>
              <div>
                <p className="text-2xs text-[var(--text-muted)] mb-1">{t('driveDetail.savingsPct', 'Savings %')}</p>
                <p className="text-lg font-bold text-emerald-400">
                  {fmtNumber(savingsPct ?? 0, 0)}%
                </p>
              </div>
            </>
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
