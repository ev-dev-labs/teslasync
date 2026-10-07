import { useTranslation } from 'react-i18next';
import { Flag, ToggleRight, ToggleLeft, Percent } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { StatGridSkeleton } from '@/components/feedback';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { FeatureFlagSummary } from './parseFeatureFlags';

interface FeatureConfigKpisProps {
  summary: FeatureFlagSummary;
  isLoading: boolean;
  /**
   * Set when the feature-config fetch failed with no cached data to fall
   * back on. When present the KPIs render em-dashes rather than fabricating
   * zeros (a `0`-count is a claim we can't back up when the source errored);
   * the sibling panels surface the actionable `<QueryError>`.
   */
  error?: unknown;
}

/** Em-dash placeholder for a metric whose true value is currently unknown. */
const UNKNOWN = '—';

/**
 * Full-width KPI band summarising the parsed feature-config: total feature
 * count, enabled / disabled splits, and the enabled rate. Renders a
 * layout-preserving skeleton while the first fetch is in flight so the row
 * doesn't jump when data lands, and degrades every value to an em-dash when
 * the source errored with nothing to show so it never invents a "0 features"
 * headline.
 */
export function FeatureConfigKpis({ summary, isLoading, error }: FeatureConfigKpisProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return <StatGridSkeleton cards={4} className="lg:grid-cols-4" />;
  }

  // Defensive: the page always hands over a summarised object, but guard a
  // nullish `summary` so a misbehaving caller degrades to truthful zeros
  // rather than throwing on `.total`. Values still collapse to em-dashes
  // when `error` is set (see UNKNOWN), so a real fetch failure is never
  // dressed up as "0 features".
  const { total, enabled, disabled, enabledRate } = summary ?? {
    total: 0,
    enabled: 0,
    disabled: 0,
    enabledRate: 0,
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <MetricCard
        label={t('featureConfig.kpi.total', 'Total Features')}
        value={error ? UNKNOWN : fmtInt(total)}
        icon={<Flag className="h-5 w-5" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t('featureConfig.kpi.enabled', 'Enabled')}
        value={error ? UNKNOWN : fmtInt(enabled)}
        icon={<ToggleRight className="h-5 w-5" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t('featureConfig.kpi.disabled', 'Disabled')}
        value={error ? UNKNOWN : fmtInt(disabled)}
        icon={<ToggleLeft className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('featureConfig.kpi.enabledRate', 'Enabled Rate')}
        value={error ? UNKNOWN : fmtPercent(enabledRate, 0)}
        icon={<Percent className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
    </div>
  );
}
