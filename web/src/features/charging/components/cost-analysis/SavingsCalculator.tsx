import { useTranslation } from 'react-i18next';
import { Calculator } from 'lucide-react';
import { GlassPanel, Input, Button, Text } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { CostSection } from './CostSection';
import { DEFAULT_GAS_PRICE, DEFAULT_MPG, DEFAULT_ELECTRICITY_RATE } from './constants';
import type { GasComparison } from './types';

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
}

interface ComparisonCardProps {
  label: string;
  value: string;
  valueClass: string;
  sub: string;
  glow?: 'green' | 'none';
}

function ComparisonCard({ label, value, valueClass, sub, glow = 'none' }: ComparisonCardProps) {
  return (
    <GlassPanel glow={glow} className="p-3">
      <Text as="p" variant="caption">{label}</Text>
      <Text as="p" size="xl" weight="bold" className={`mt-1 tabular-nums ${valueClass}`}>{value}</Text>
      <Text as="p" variant="caption" className="mt-0.5">{sub}</Text>
    </GlassPanel>
  );
}

/**
 * Coerce a possibly non-finite number to a controlled-input-safe value. React
 * logs "Received NaN for the `value` attribute" and drops the field back to
 * uncontrolled if a number input's `value` is ever NaN/Infinity, so fall back
 * to the field's default whenever the incoming prop isn't finite.
 */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function SavingsCalculator({
  gasComparison,
  gasPrice,
  mpg,
  electricityRate,
  onGasPriceChange,
  onMpgChange,
  onElectricityRateChange,
  distanceUnit,
  isLoading,
  error,
  onRetry,
}: SavingsCalculatorProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  // Display-boundary guard: the per-distance labels embed the unit in a
  // template literal, so a blank/undefined unit would render "$0.15/" or
  // "$0.15/undefined". Fall back to the metric default.
  const unit = distanceUnit?.trim() ? distanceUnit : 'km';

  return (
    <CostSection
      title={t('costAnalysis.calculator.title', 'Gas vs Electric Savings Calculator')}
      icon={<Calculator className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
      glow="green"
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Inputs — always visible so users can tweak assumptions. */}
        <div className="space-y-3">
          <Text as="h4" variant="label">
            {t('costAnalysis.calculator.inputs', 'Your Assumptions')}
          </Text>
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
          <Button
            type="button"
            className="mt-2 w-full"
            onClick={() => {
              onGasPriceChange(DEFAULT_GAS_PRICE);
              onMpgChange(DEFAULT_MPG);
              onElectricityRateChange(DEFAULT_ELECTRICITY_RATE);
            }}
          >
            {t('costAnalysis.calculator.reset', 'Reset Defaults')}
          </Button>
        </div>

        {/* Side-by-side comparison — self-manages loading / error / empty. */}
        <div className="space-y-3 xl:col-span-2" aria-busy={isLoading || undefined}>
          <Text as="h4" variant="label">
            {t('costAnalysis.calculator.comparison', 'Comparison')}
          </Text>
          {isLoading ? (
            <Skeleton height={160} />
          ) : error ? (
            <QueryError error={error} onRetry={onRetry} />
          ) : gasComparison ? (
            <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
              <ComparisonCard
                label={t('costAnalysis.calculator.gasCost', 'Gas Cost (equivalent)')}
                value={formatCurrency(gasComparison.gasCost, 2)}
                valueClass="text-rose-300"
                sub={`${formatCurrency(gasComparison.costPerMileGas, 3)}/${unit}`}
              />
              <ComparisonCard
                label={t('costAnalysis.calculator.evCost', 'EV Cost (actual)')}
                value={formatCurrency(gasComparison.actualCost, 2)}
                valueClass="text-cyan-300"
                sub={`${formatCurrency(gasComparison.costPerMileEV, 3)}/${unit}`}
              />
              <ComparisonCard
                glow="green"
                label={t('costAnalysis.calculator.totalSavings', 'Total Savings')}
                value={formatCurrency(gasComparison.savings, 2)}
                valueClass="text-emerald-300"
                sub={t('costAnalysis.calculator.overPeriod', 'over selected period')}
              />
              <ComparisonCard
                label={t('costAnalysis.calculator.monthlySavings', 'Monthly Savings')}
                value={formatCurrency(gasComparison.monthlySavings, 2)}
                valueClass="text-emerald-300"
                sub={`~${formatCurrency(gasComparison.yearlySavings, 0)} ${t('costAnalysis.calculator.perYear', '/ year')}`}
              />
            </div>
          ) : (
            <EmptyState
              /* no-action: transient empty state — needs charging rows with cost + distance to compare */
              message={t('costAnalysis.calculator.noData', 'Not enough data for comparison')}
            />
          )}
        </div>
      </div>
    </CostSection>
  );
}
