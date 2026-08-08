import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import {
  ArrivalReliabilityProfilePlot,
  type ArrivalReliabilityProfileRow,
} from './ArrivalReliabilityProfilePlot';
import { ArrivalReliabilitySectionBody } from './ArrivalReliabilitySectionBody';
import { arrivalMonth } from './labels';
import type { ArrivalReliabilityQueryState } from './types';

interface ArrivalReliabilityMonthTrendProps {
  analysis: ArrivalReliabilityResult;
  state: ArrivalReliabilityQueryState;
  locale: string;
  timeZone: string;
}

export function ArrivalReliabilityMonthTrend({
  analysis,
  state,
  locale,
  timeZone,
}: ArrivalReliabilityMonthTrendProps) {
  const { t } = useTranslation();
  const rows = useMemo<ArrivalReliabilityProfileRow[]>(
    () =>
      analysis.monthTrend.map((point) => ({
        key: point.monthKey,
        label: arrivalMonth(point.firstObservationMs, locale, timeZone),
        normalizedDurationIndex:
          point.normalizedDurationIndex != null
            ? Math.round(point.normalizedDurationIndex * 10) / 10
            : null,
        allowanceShare:
          point.withinAllowanceShare != null
            ? Math.round(point.withinAllowanceShare * 1_000) / 10
            : null,
        samples: point.samples,
      })),
    [analysis.monthTrend, locale, timeZone],
  );
  const ready =
    state.isResolved && !state.error && analysis.routes.length > 0;

  return (
    <section data-testid="arrival-month-trend">
      <ChartContainer
        title={t(
          'arrivalReliability.profiles.monthTitle',
          'Local-month timing trend',
        )}
        subtitle={t(
          'arrivalReliability.profiles.monthSubtitle',
          'Observed supported-route timing by vehicle-local month, normalized within each route.',
        )}
        ariaLabel={t(
          'arrivalReliability.profiles.monthAria',
          'Vehicle-local monthly trend of route-normalized duration, observed allowance share, and samples',
        )}
        ariaDescription={t(
          'arrivalReliability.profiles.monthDescription',
          'Months use {{timeZone}} and may retain residual route-mix effects when route support changes.',
          { timeZone },
        )}
        height={360}
        chartKey="arrival-month-trend"
        exportable={ready}
        exportFilename="arrival-month-trend"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'label',
            label: t(
              'arrivalReliability.profiles.column.month',
              'Vehicle-local month',
            ),
          },
          {
            key: 'normalizedDurationIndex',
            label: t(
              'arrivalReliability.profiles.column.normalized',
              'Route-normalized duration index',
            ),
          },
          {
            key: 'allowanceShare',
            label: t(
              'arrivalReliability.profiles.column.allowance',
              'Observed within-allowance share (%)',
            ),
          },
          {
            key: 'samples',
            label: t(
              'arrivalReliability.profiles.column.samples',
              'Samples',
            ),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <ArrivalReliabilitySectionBody
            analysis={analysis}
            state={state}
            className="h-full min-h-0"
            skeletonHeight={320}
          >
            <ArrivalReliabilityProfilePlot
              rows={rows}
              normalizedName={t(
                'arrivalReliability.profiles.normalizedSeries',
                'Route-normalized duration index',
              )}
              allowanceName={t(
                'arrivalReliability.profiles.allowanceSeries',
                'Observed within-allowance share (%)',
              )}
              samplesName={t(
                'arrivalReliability.profiles.samplesSeries',
                'Samples',
              )}
              locale={locale}
              hiddenSeries={hiddenSeries}
            />
          </ArrivalReliabilitySectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
