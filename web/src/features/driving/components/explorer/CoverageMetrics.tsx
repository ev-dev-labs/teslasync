import { useTranslation } from 'react-i18next';

import { CHART_COLORS } from '@/components/charts';
import { MetricBar } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';


import type { ExplorerEligibility } from '../../lib/explorer';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface CoverageMetricsProps {
  eligibility: ExplorerEligibility;
}

export function CoverageMetrics({ eligibility }: CoverageMetricsProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const coordinatePercent =
    (eligibility.coordinateCoverageShare ?? 0) * 100;
  const timestampPercent =
    (eligibility.timestampCoverageShare ?? 0) * 100;
  const percent = (value: number) =>
    t('explorer.coverage.percentValue', '{{value}}%', {
      value: fmtNumber(value),
    });
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'eligible-arrivals', rawValue: eligibility.eligible,
      display: { countTotal: eligibility.observed },
      label: t('explorer.coverage.eligible', 'Eligible arrivals') },
    { metricId: 'count', occurrenceId: 'coordinate-rows', rawValue: eligibility.coordinateEligible,
      label: t('explorer.coverage.locatedRows', 'Rows with usable end coordinates') },
    { metricId: 'count', occurrenceId: 'timestamp-proxies', rawValue: eligibility.usedStartTimestamp,
      label: t('explorer.coverage.timestampFallbacks', 'Start-time proxies') },
  ];

  return (
    <div className="space-y-5">
      <NestedDrivingBrief metrics={metrics}
        title={t('explorer.brief.coverage', 'Arrival coverage')}
        description={t('explorer.brief.coverageScope', 'Returned drive endpoints; eligible arrivals and timestamp proxies are separate evidence.')}
        period={{ kind: 'unknown', label: t('explorer.brief.coverage', 'Arrival coverage'),
          reason: t('explorer.brief.coverageDenominator', '{{count}} returned rows define the eligible-arrival denominator.', { count: eligibility.observed }) }} />

      <div className="grid gap-4 md:grid-cols-2">
        <MetricBar
          value={coordinatePercent}
          max={100}
          color={CHART_COLORS[0]}
          label={t(
            'explorer.coverage.locationShare',
            'Usable endpoint-coordinate coverage',
          )}
          sublabel={percent(coordinatePercent)}
        />
        <MetricBar
          value={timestampPercent}
          max={100}
          color={CHART_COLORS[1]}
          label={t(
            'explorer.coverage.timestampShare',
            'Usable arrival-time coverage',
          )}
          sublabel={percent(timestampPercent)}
        />
      </div>
    </div>
  );
}
