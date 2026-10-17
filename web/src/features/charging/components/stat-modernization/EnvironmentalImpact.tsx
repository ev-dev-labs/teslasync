import { useTranslation } from 'react-i18next';
import { Leaf, Trees } from 'lucide-react';
import { Text } from '@/components/ui';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import type { StatPeriod } from '@/lib/metric-reference';
import type { CoreStats } from '../cost-analysis/types';
import { CostStatSection } from './CostStatSection';
import { useStatFormatting } from './useStatFormatting';

interface EnvironmentalImpactProps {
  coreStats: CoreStats | null;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  period: StatPeriod;
}

export function EnvironmentalImpact({ coreStats, isLoading, error, onRetry, period }: EnvironmentalImpactProps) {
  const { t } = useTranslation();
  const { text, preferences } = useStatFormatting();
  // Preserve the existing kg / 1000 display derivation, without inventing zero for missing raw leaves.
  const co2SavedKg = coreStats?.co2SavedKg;
  const treeEquiv = coreStats?.treeEquiv;
  const gallonsEquiv = coreStats?.gallonsEquiv;
  const savings = coreStats?.savings;
  const metricTonsCo2 = co2SavedKg != null ? co2SavedKg / 1000 : null;

  return (
    <CostStatSection title={t('costAnalysis.environment.title', 'Environmental Impact')}
      icon={<Leaf className="h-4 w-4 text-emerald-300" aria-hidden="true" />} glow="green"
      isLoading={isLoading} error={error} onRetry={onRetry} retained={coreStats != null}
      isEmpty={!coreStats} period={period}
      emptyMessage={t('costAnalysis.environment.noData', 'No data')} skeletonHeight={200}>
      {periodHeaderId => (
        <div className="space-y-4">
          <ChargingSummaryBrief title={t('costAnalysis.environment.title', 'Environmental Impact')}
            period={period} preferences={preferences} periodInHeader periodContextInHeader periodHeaderId={periodHeaderId}
            metrics={[
              { metricId: 'number', rawValue: co2SavedKg, label: t('costAnalysis.environment.kgCo2', 'kg CO₂ saved') },
              { metricId: 'number', rawValue: treeEquiv, label: t('costAnalysis.environment.treeEquiv', 'tree-years equivalent') },
            ]} />
          <div className="rounded-lg bg-[var(--surface-2)] p-3">
            <div className="flex items-start gap-3">
              <Trees className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
              <Text variant="bodySm">
                {t('costAnalysis.environment.desc',
                  'By driving electric instead of a gas car, you have avoided the equivalent of')}{' '}
                <Text weight="semibold" className="text-emerald-300">{text('number', co2SavedKg)} kg</Text>{' '}
                {t('costAnalysis.environment.ofCo2', 'of CO₂ emissions.')}{' '}
                {t('costAnalysis.environment.treeNote', "That's the same as")}{' '}
                <Text weight="semibold" className="text-emerald-300">{text('number', treeEquiv)}</Text>{' '}
                {t('costAnalysis.environment.treesAbsorbing', 'trees absorbing carbon for a full year.')}
              </Text>
            </div>
          </div>
          <ChargingSummaryBrief title={t('costAnalysis.environment.gallons', 'gallons avoided')}
            period={period} preferences={preferences} periodInHeader periodContextInHeader periodHeaderId={periodHeaderId}
            metrics={[
              { metricId: 'number', rawValue: gallonsEquiv, label: t('costAnalysis.environment.gallons', 'gallons avoided') },
              { metricId: 'number', rawValue: metricTonsCo2, label: t('costAnalysis.environment.metricTons', 'metric tons CO₂') },
              // Deliberately preserve fmtNumber, not a new currency prefix/FX policy.
              { metricId: 'number', rawValue: savings, label: t('costAnalysis.environment.dollarsSaved', '$ saved total') },
            ]} />
        </div>
      )}
    </CostStatSection>
  );
}
