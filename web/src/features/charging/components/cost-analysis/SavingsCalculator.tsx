import { useTranslation } from 'react-i18next';
import { Calculator } from 'lucide-react';
import { GlassPanel, Input, Button } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
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
}: SavingsCalculatorProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel glow="green" className="p-4">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <Calculator className="h-4 w-4 text-green-400" />
        {t('costAnalysis.calculator.title', 'Gas vs Electric Savings Calculator')}
      </h3>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Inputs */}
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wider text-gray-400">
            {t('costAnalysis.calculator.inputs', 'Your Assumptions')}
          </h4>
          <Input
            type="number"
            label={t('costAnalysis.calculator.gasPrice', 'Gas Price ($/gal)')}
            value={gasPrice}
            onChange={(e) => onGasPriceChange(Number(e.target.value) || 0)}
            suffix="$/gal"
          />
          <Input
            type="number"
            label={t('costAnalysis.calculator.mpg', 'Gas Car MPG')}
            value={mpg}
            onChange={(e) => onMpgChange(Number(e.target.value) || 1)}
            suffix="mpg"
          />
          <Input
            type="number"
            label={t('costAnalysis.calculator.elecRate', 'Electricity Rate ($/kWh)')}
            value={electricityRate}
            onChange={(e) =>
              onElectricityRateChange(Number(e.target.value) || 0)
            }
            suffix="$/kWh"
          />
          <Button
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

        {/* Side-by-side comparison */}
        <div className="space-y-3 lg:col-span-2">
          <h4 className="text-xs font-medium uppercase tracking-wider text-gray-400">
            {t('costAnalysis.calculator.comparison', 'Comparison')}
          </h4>
          {gasComparison ? (
            <div className="grid grid-cols-2 gap-3">
              <GlassPanel className="p-3">
                <p className="text-xs text-gray-400">
                  {t('costAnalysis.calculator.gasCost', 'Gas Cost (equivalent)')}
                </p>
                <p className="mt-1 text-xl font-bold text-red-400">
                  ${fmtNumber(gasComparison.gasCost, 2)}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-500">
                  ${fmtNumber(gasComparison.costPerMileGas, 3)}/{distanceUnit}
                </p>
              </GlassPanel>
              <GlassPanel className="p-3">
                <p className="text-xs text-gray-400">
                  {t('costAnalysis.calculator.evCost', 'EV Cost (actual)')}
                </p>
                <p className="mt-1 text-xl font-bold text-cyan-400">
                  ${fmtNumber(gasComparison.actualCost, 2)}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-500">
                  ${fmtNumber(gasComparison.costPerMileEV, 3)}/{distanceUnit}
                </p>
              </GlassPanel>
              <GlassPanel glow="green" className="p-3">
                <p className="text-xs text-gray-400">
                  {t('costAnalysis.calculator.totalSavings', 'Total Savings')}
                </p>
                <p className="mt-1 text-xl font-bold text-green-400">
                  ${fmtNumber(gasComparison.savings, 2)}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-500">
                  {t('costAnalysis.calculator.overPeriod', 'over selected period')}
                </p>
              </GlassPanel>
              <GlassPanel className="p-3">
                <p className="text-xs text-gray-400">
                  {t('costAnalysis.calculator.monthlySavings', 'Monthly Savings')}
                </p>
                <p className="mt-1 text-xl font-bold text-green-300">
                  ${fmtNumber(gasComparison.monthlySavings, 2)}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-500">
                  ~${fmtNumber(gasComparison.yearlySavings, 0)}{' '}
                  {t('costAnalysis.calculator.perYear', '/ year')}
                </p>
              </GlassPanel>
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-gray-500">
              {t('costAnalysis.calculator.noData', 'Not enough data for comparison')}
            </div>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
