import { useTranslation } from 'react-i18next';
import { Leaf, Trees } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import type { CoreStats } from './types';

interface EnvironmentalImpactProps {
  coreStats: CoreStats | null;
}

export function EnvironmentalImpact({ coreStats }: EnvironmentalImpactProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel glow="green" className="p-4">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <Leaf className="h-4 w-4 text-green-400" />
        {t('costAnalysis.environment.title', 'Environmental Impact')}
      </h3>
      {coreStats ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-green-500/10 p-4 text-center">
              <p className="text-2xl font-bold text-green-400">
                {fmtNumber(coreStats.co2SavedKg, 1)}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {t('costAnalysis.environment.kgCo2', 'kg CO₂ saved')}
              </p>
            </div>
            <div className="rounded-lg bg-green-500/10 p-4 text-center">
              <p className="text-2xl font-bold text-green-400">
                {fmtNumber(coreStats.treeEquiv, 1)}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {t('costAnalysis.environment.treeEquiv', 'tree-years equivalent')}
              </p>
            </div>
          </div>
          <div className="rounded-lg bg-white/5 p-3">
            <div className="flex items-start gap-3">
              <Trees className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
              <div>
                <p className="text-sm text-gray-300">
                  {t(
                    'costAnalysis.environment.desc',
                    'By driving electric instead of a gas car, you have avoided the equivalent of',
                  )}{' '}
                  <span className="font-semibold text-green-400">
                    {fmtNumber(coreStats.co2SavedKg, 0)} kg
                  </span>{' '}
                  {t('costAnalysis.environment.ofCo2', 'of CO₂ emissions.')}{' '}
                  {t('costAnalysis.environment.treeNote', "That's the same as")}{' '}
                  <span className="font-semibold text-green-400">
                    {fmtNumber(coreStats.treeEquiv, 1)}
                  </span>{' '}
                  {t(
                    'costAnalysis.environment.treesAbsorbing',
                    'trees absorbing carbon for a full year.',
                  )}
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <p className="text-lg font-semibold text-white">
                {fmtNumber(coreStats.gallonsEquiv, 1)}
              </p>
              <p className="text-[10px] text-gray-500">
                {t('costAnalysis.environment.gallons', 'gallons avoided')}
              </p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-white">
                {fmtNumber(coreStats.co2SavedKg / 1000, 2)}
              </p>
              <p className="text-[10px] text-gray-500">
                {t('costAnalysis.environment.metricTons', 'metric tons CO₂')}
              </p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-white">
                {fmtNumber(coreStats.savings, 0)}
              </p>
              <p className="text-[10px] text-gray-500">
                {t('costAnalysis.environment.dollarsSaved', '$ saved total')}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-32 items-center justify-center text-sm text-gray-500">
          {t('costAnalysis.environment.noData', 'No data')}
        </div>
      )}
    </GlassPanel>
  );
}
