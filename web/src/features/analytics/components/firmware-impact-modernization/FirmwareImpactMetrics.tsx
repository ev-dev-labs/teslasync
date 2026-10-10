import { useTranslation } from 'react-i18next';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { MetricCard } from '@/components/data-display';
import { StatStrip, type StatMetric, type StatPeriod } from '@/components/data-display/stat-reference';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { HelpTooltip } from '@/components/ui';
import type { FirmwareImpact, FirmwareImpactSummary } from '../../lib/firmwareImpact';
import type { FirmwareImpactState } from './firmwareImpactState';

export function FirmwareImpactMetrics({
  summary,
  best,
  worst,
  state,
  onRetry,
}: {
  summary: FirmwareImpactSummary;
  best: FirmwareImpact | null;
  worst: FirmwareImpact | null;
  state: FirmwareImpactState;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const testedLabel = t('firmwareImpact.tested', 'Updates tested');
  const testedHelp = t(
    'firmwareImpact.modernization.testedHelp',
    'Each install splits returned drives into before and after windows clipped at neighboring installs. Welch’s t-test compares consumption samples without assuming equal variance. This observational comparison does not isolate a firmware effect.',
  );
  const metrics: StatMetric[] = [
    {
      metricId: 'count',
      occurrenceId: 'firmware-updates-tested',
      rawValue: state.hasInputs ? summary.impacts.length : null,
      label: testedLabel,
      context: t('firmwareImpact.skipped', '{{n}} skipped for thin data', { n: summary.skipped }),
      description: testedHelp,
    },
    {
      metricId: 'count',
      occurrenceId: 'firmware-significant-comparisons',
      rawValue: state.hasInputs ? summary.significantCount : null,
      label: t('firmwareImpact.modernization.significant', 'Significant comparisons'),
      context: t('firmwareImpact.significantHint', 'p < 0.05 with a non-trivial effect'),
    },
  ];
  const period: StatPeriod = {
    kind: 'unknown',
    label: t('firmwareImpact.modernization.period', 'Returned history · install-centered windows'),
    reason: t(
      'firmwareImpact.modernization.historyLimit',
      'Comparisons use only the histories returned by the existing endpoints, not guaranteed complete vehicle history. Each nominal window spans 30 days before or after an install and is clipped at neighboring installs.',
    ),
  };

  return (
    <LayoutCard
      title={t('firmwareImpact.kpis', 'Firmware impact metrics')}
      actions={state.hasInputs ? (
        <HelpTooltip
          size="xs"
          i18nKey="firmwareImpact.modernization.testedHelp"
          defaultValue={testedHelp}
          ariaLabel={t('metricCard.moreInfoAbout', 'More info about {{label}}', { label: testedLabel })}
        />
      ) : undefined}
    >
      {state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={onRetry} />
      ) : state.loading ? (
        <Skeleton height={96} className="rounded-xl" />
      ) : !state.hasInputs ? (
        <EmptyState
          message={t('firmwareImpact.modernization.waiting', 'Waiting for both drive history and software updates.')}
          action={{ label: t('common.refresh', 'Refresh'), onClick: onRetry }}
        />
      ) : (
        <>
          <StatStrip
            id="firmware-impact-counts"
            variant="embedded"
            metrics={metrics}
            period={period}
            retained={state.retained}
          />
          {/* Generic efficiency stats cannot faithfully preserve signed,
              fixed Wh/km deltas and version context. Keep this display boundary. */}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <MetricCard
              label={t('firmwareImpact.best', 'Biggest gain')}
              value={best != null ? `${Math.round(best.deltaWhPerKm * 10) / 10} Wh/km` : '—'}
              subtitle={best != null ? best.version : t('firmwareImpact.none', 'None detected')}
              icon={<TrendingDown className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t('firmwareImpact.worst', 'Biggest regression')}
              value={worst != null ? `+${Math.round(worst.deltaWhPerKm * 10) / 10} Wh/km` : '—'}
              subtitle={worst != null ? worst.version : t('firmwareImpact.none', 'None detected')}
              icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
              color={worst != null ? 'red' : 'blue'}
            />
          </div>
        </>
      )}
    </LayoutCard>
  );
}
