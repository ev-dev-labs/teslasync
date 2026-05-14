import { useTranslation } from 'react-i18next';
import {
  DollarSign, Zap, TrendingDown, Car, Fuel,
} from 'lucide-react';
import { StaggerContainer, StaggerItem } from '@/components/motion';
import { useFormatting } from '@/hooks/useFormatting';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import { StatBox } from './StatBox';
import type { CoreStats } from './types';

interface CostSummaryCardsProps {
  coreStats: CoreStats | null;
  gasPrice: number;
  distanceUnit: string;
  isMiles: boolean;
}

export function CostSummaryCards({
  coreStats,
  gasPrice,
  distanceUnit,
  isMiles,
}: CostSummaryCardsProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { settings } = useSettings();
  const gasUnitLabel = settings.gas_unit === 'liter' ? 'L' : 'gal';

  return (
    <StaggerContainer>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StaggerItem>
          <StatBox
            icon={<DollarSign className="h-5 w-5 text-cyan-400" />}
            label={t('costAnalysis.stats.totalCost', 'Total Cost')}
            value={formatCurrency(coreStats?.totalCost ?? 0, 2)}
            sub={`${fmtInt(coreStats?.count ?? 0)} ${t('costAnalysis.stats.sessions', 'sessions')}`}
            glow="cyan"
          />
        </StaggerItem>
        <StaggerItem>
          <StatBox
            icon={<Zap className="h-5 w-5 text-yellow-400" />}
            label={t('costAnalysis.stats.avgPerKwh', 'Avg $/kWh')}
            value={formatCurrency(coreStats?.avgCostPerKwh ?? 0, 3)}
            sub={t('costAnalysis.stats.blendedRate', 'blended rate')}
          />
        </StaggerItem>
        <StaggerItem>
          <StatBox
            icon={<Car className="h-5 w-5 text-blue-400" />}
            label={t('costAnalysis.stats.costPerDist', { unit: isMiles ? 'Mile' : 'km', defaultValue: 'Cost Per {{unit}}' })}
            value={formatCurrency(coreStats?.costPerDist ?? 0, 3)}
            sub={`per ${distanceUnit}`}
          />
        </StaggerItem>
        <StaggerItem>
          <StatBox
            icon={<Zap className="h-5 w-5 text-green-400" />}
            label={t('costAnalysis.stats.totalEnergy', 'Total Energy')}
            value={fmtWithUnit(coreStats?.totalEnergy ?? 0, 'kWh', 1)}
            sub={fmtWithUnit(coreStats?.gallonsEquiv ?? 0, 'gal equiv', 1)}
            glow="green"
          />
        </StaggerItem>
        <StaggerItem>
          <StatBox
            icon={<Fuel className="h-5 w-5 text-red-400" />}
            label={t('costAnalysis.stats.gasSavings', 'Gas Savings $')}
            value={formatCurrency(coreStats?.savings ?? 0, 2)}
            sub={`vs ${formatCurrency(gasPrice, 2)}/${gasUnitLabel}`}
            glow="green"
          />
        </StaggerItem>
        <StaggerItem>
          <StatBox
            icon={<TrendingDown className="h-5 w-5 text-emerald-400" />}
            label={t('costAnalysis.stats.savingsPercent', 'Savings %')}
            value={`${fmtNumber(coreStats?.savingsPercent ?? 0, 1)}%`}
            sub={t('costAnalysis.stats.vsGasoline', 'vs gasoline')}
            glow="green"
          />
        </StaggerItem>
      </div>
    </StaggerContainer>
  );
}
