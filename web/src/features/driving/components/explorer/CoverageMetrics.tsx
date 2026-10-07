import { useTranslation } from 'react-i18next';

import { CHART_COLORS } from '@/components/charts';
import { MetricBar } from '@/components/data-display';
import { MetricLabel, MetricValue } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { ExplorerEligibility } from '../../lib/explorer';

interface CoverageMetricsProps {
  eligibility: ExplorerEligibility;
}

export function CoverageMetrics({ eligibility }: CoverageMetricsProps) {
  const { t } = useTranslation();
  const coordinatePercent =
    (eligibility.coordinateCoverageShare ?? 0) * 100;
  const timestampPercent =
    (eligibility.timestampCoverageShare ?? 0) * 100;
  const percent = (value: number) =>
    t('explorer.coverage.percentValue', '{{value}}%', {
      value: fmtNumber(value, 0),
    });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <MetricValue>
            {fmtInt(eligibility.eligible)}/{fmtInt(eligibility.observed)}
          </MetricValue>
          <MetricLabel>
            {t('explorer.coverage.eligible', 'Eligible arrivals')}
          </MetricLabel>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <MetricValue>{fmtInt(eligibility.coordinateEligible)}</MetricValue>
          <MetricLabel>
            {t(
              'explorer.coverage.locatedRows',
              'Rows with usable end coordinates',
            )}
          </MetricLabel>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3">
          <MetricValue>{fmtInt(eligibility.usedStartTimestamp)}</MetricValue>
          <MetricLabel>
            {t(
              'explorer.coverage.timestampFallbacks',
              'Start-time proxies',
            )}
          </MetricLabel>
        </div>
      </div>

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
