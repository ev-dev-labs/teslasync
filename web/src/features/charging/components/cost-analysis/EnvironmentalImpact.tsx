import { useTranslation } from 'react-i18next';
import { Leaf, Trees } from 'lucide-react';
import { Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import { CostSection } from './CostSection';
import type { CoreStats } from './types';

interface EnvironmentalImpactProps {
  coreStats: CoreStats | null;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function EnvironmentalImpact({ coreStats, isLoading, error, onRetry }: EnvironmentalImpactProps) {
  const { t } = useTranslation();

  // Null-safe reads at the boundary: dirty upstream rows may carry null /
  // undefined magnitudes. `fmtNumber` neutralises NaN downstream, but the raw
  // `/ 1000` metric-tons math must never see a nullish operand.
  const co2SavedKg = coreStats?.co2SavedKg ?? 0;
  const treeEquiv = coreStats?.treeEquiv ?? 0;
  const gallonsEquiv = coreStats?.gallonsEquiv ?? 0;
  const savings = coreStats?.savings ?? 0;
  const metricTonsCo2 = co2SavedKg / 1000;

  return (
    <CostSection
      title={t('costAnalysis.environment.title', 'Environmental Impact')}
      icon={<Leaf className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
      glow="green"
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={!coreStats}
      emptyMessage={t('costAnalysis.environment.noData', 'No data')}
      skeletonHeight={200}
    >
      {coreStats && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-4 text-center">
              <Text as="p" size="2xl" weight="bold" className="text-emerald-300">
                {fmtNumber(co2SavedKg, 1)}
              </Text>
              <Text as="p" variant="caption" className="mt-1">
                {t('costAnalysis.environment.kgCo2', 'kg CO₂ saved')}
              </Text>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-4 text-center">
              <Text as="p" size="2xl" weight="bold" className="text-emerald-300">
                {fmtNumber(treeEquiv, 1)}
              </Text>
              <Text as="p" variant="caption" className="mt-1">
                {t('costAnalysis.environment.treeEquiv', 'tree-years equivalent')}
              </Text>
            </div>
          </div>
          <div className="rounded-lg bg-[var(--surface-2)] p-3">
            <div className="flex items-start gap-3">
              <Trees className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
              <Text variant="bodySm">
                {t(
                  'costAnalysis.environment.desc',
                  'By driving electric instead of a gas car, you have avoided the equivalent of',
                )}{' '}
                <Text weight="semibold" className="text-emerald-300">
                  {fmtNumber(co2SavedKg, 0)} kg
                </Text>{' '}
                {t('costAnalysis.environment.ofCo2', 'of CO₂ emissions.')}{' '}
                {t('costAnalysis.environment.treeNote', "That's the same as")}{' '}
                <Text weight="semibold" className="text-emerald-300">
                  {fmtNumber(treeEquiv, 1)}
                </Text>{' '}
                {t(
                  'costAnalysis.environment.treesAbsorbing',
                  'trees absorbing carbon for a full year.',
                )}
              </Text>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <Text as="p" size="lg" weight="semibold" color="primary">
                {fmtNumber(gallonsEquiv, 1)}
              </Text>
              <Text as="p" variant="caption">
                {t('costAnalysis.environment.gallons', 'gallons avoided')}
              </Text>
            </div>
            <div className="text-center">
              <Text as="p" size="lg" weight="semibold" color="primary">
                {fmtNumber(metricTonsCo2, 2)}
              </Text>
              <Text as="p" variant="caption">
                {t('costAnalysis.environment.metricTons', 'metric tons CO₂')}
              </Text>
            </div>
            <div className="text-center">
              <Text as="p" size="lg" weight="semibold" color="primary">
                {fmtNumber(savings, 0)}
              </Text>
              <Text as="p" variant="caption">
                {t('costAnalysis.environment.dollarsSaved', '$ saved total')}
              </Text>
            </div>
          </div>
        </div>
      )}
    </CostSection>
  );
}
