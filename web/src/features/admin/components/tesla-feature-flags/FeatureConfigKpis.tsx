import { useTranslation } from 'react-i18next';
import { Flag, ToggleRight, ToggleLeft, Percent } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { StatGridSkeleton } from '@/components/feedback';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { FeatureFlagSummary } from './parseFeatureFlags';

interface FeatureConfigKpisProps {
  summary: FeatureFlagSummary;
  isLoading: boolean;
}

/**
 * Full-width KPI band summarising the parsed feature-config: total feature
 * count, enabled / disabled splits, and the enabled rate. Renders a
 * layout-preserving skeleton while the first fetch is in flight so the row
 * doesn't jump when data lands.
 */
export function FeatureConfigKpis({ summary, isLoading }: FeatureConfigKpisProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return <StatGridSkeleton cards={4} className="lg:grid-cols-4" />;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <MetricCard
        label={t('featureConfig.kpi.total', 'Total Features')}
        value={fmtInt(summary.total)}
        icon={<Flag className="h-5 w-5" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t('featureConfig.kpi.enabled', 'Enabled')}
        value={fmtInt(summary.enabled)}
        icon={<ToggleRight className="h-5 w-5" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t('featureConfig.kpi.disabled', 'Disabled')}
        value={fmtInt(summary.disabled)}
        icon={<ToggleLeft className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('featureConfig.kpi.enabledRate', 'Enabled Rate')}
        value={fmtPercent(summary.enabledRate, 0)}
        icon={<Percent className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
    </div>
  );
}
