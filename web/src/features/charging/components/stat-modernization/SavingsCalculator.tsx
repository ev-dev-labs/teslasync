import { useTranslation } from 'react-i18next';
import { Calculator } from 'lucide-react';
import { Input, Button, Text } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { StatGroup } from '@/components/data-display/stat-reference';
import type { StatPeriod } from '@/lib/metric-reference';
import { DEFAULT_GAS_PRICE, DEFAULT_MPG, DEFAULT_ELECTRICITY_RATE } from '../cost-analysis/constants';
import type { GasComparison } from '../cost-analysis/types';
import { CostStatSection } from './CostStatSection';
import { useStatFormatting } from './useStatFormatting';

interface SavingsCalculatorProps {
  gasComparison: GasComparison | null;
  gasPrice: number;
  mpg: number;
  electricityRate: number;
  onGasPriceChange: (v: number) => void;
  onMpgChange: (v: number) => void;
  onElectricityRateChange: (v: number) => void;
  distanceUnit: string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  period: StatPeriod;
}

/** Original controlled-input guard; assumption handlers/defaults are unchanged. */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function SavingsCalculator({
  gasComparison, gasPrice, mpg, electricityRate, onGasPriceChange, onMpgChange,
  onElectricityRateChange, distanceUnit, isLoading, error, onRetry, period,
}: SavingsCalculatorProps) {
  const { t } = useTranslation();
  const { text, preferences } = useStatFormatting();
  const unit = distanceUnit?.trim() ? distanceUnit : 'km';

  return (
    <CostStatSection
      title={t('costAnalysis.calculator.title', 'Gas vs Electric Savings Calculator')}
      icon={<Calculator className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
      glow="green" period={period}>
      {periodHeaderId => (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Inputs remain visible in every data state. No saved assumptions are mutated. */}
          <div className="space-y-3">
            <Text as="h4" variant="label">{t('costAnalysis.calculator.inputs', 'Your Assumptions')}</Text>
            <Input
              type="number"
              label={t('costAnalysis.calculator.gasPrice', 'Gas Price ($/gal)')}
              value={finiteOr(gasPrice, DEFAULT_GAS_PRICE)}
              onChange={(e) => onGasPriceChange(Number(e.target.value) || 0)}
              suffix="$/gal"
            />
            <Input
              type="number"
              label={t('costAnalysis.calculator.mpg', 'Gas Car MPG')}
              value={finiteOr(mpg, DEFAULT_MPG)}
              onChange={(e) => onMpgChange(Number(e.target.value) || 1)}
              suffix="mpg"
            />
            <Input
              type="number"
              label={t('costAnalysis.calculator.elecRate', 'Electricity Rate ($/kWh)')}
              value={finiteOr(electricityRate, DEFAULT_ELECTRICITY_RATE)}
              onChange={(e) => onElectricityRateChange(Number(e.target.value) || 0)}
              suffix="$/kWh"
            />
            <Button type="button" className="mt-2 w-full" onClick={() => {
              onGasPriceChange(DEFAULT_GAS_PRICE);
              onMpgChange(DEFAULT_MPG);
              onElectricityRateChange(DEFAULT_ELECTRICITY_RATE);
            }}>
              {t('costAnalysis.calculator.reset', 'Reset Defaults')}
            </Button>
          </div>
          <div className="space-y-3 xl:col-span-2" aria-busy={isLoading || undefined}>
            <Text as="h4" variant="label">{t('costAnalysis.calculator.comparison', 'Comparison')}</Text>
            {error ? <QueryError error={error} onRetry={onRetry} /> : null}
            {isLoading && !gasComparison && !error ? <Skeleton height={160} /> : gasComparison ? (
              <StatGroup period={period} preferences={preferences} periodInHeader periodContextInHeader periodHeaderId={periodHeaderId}
                loading={isLoading} retained={Boolean(error || isLoading)}
                metrics={[
                  { metricId: 'currency', rawValue: gasComparison.gasCost,
                    label: t('costAnalysis.calculator.gasCost', 'Gas Cost (equivalent)'),
                    context: `${text('currency', gasComparison.costPerMileGas)}/${unit}` },
                  { metricId: 'currency', rawValue: gasComparison.actualCost,
                    label: t('costAnalysis.calculator.evCost', 'EV Cost (actual)'),
                    context: `${text('currency', gasComparison.costPerMileEV)}/${unit}` },
                  { metricId: 'currency', rawValue: gasComparison.savings,
                    label: t('costAnalysis.calculator.totalSavings', 'Total Savings'),
                    context: t('costAnalysis.calculator.overPeriod', 'over selected period') },
                  { metricId: 'currency', rawValue: gasComparison.monthlySavings,
                    label: t('costAnalysis.calculator.monthlySavings', 'Monthly Savings'),
                    context: `~${text('currency', gasComparison.yearlySavings)} ${t('costAnalysis.calculator.perYear', '/ year')}` },
                ]} />
            ) : !error && (
              <EmptyState message={t('costAnalysis.calculator.noData', 'Not enough data for comparison')} />
            )}
          </div>
        </div>
      )}
    </CostStatSection>
  );
}
