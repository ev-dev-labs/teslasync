import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import {
  ArrivalReliabilityProfilePlot,
  type ArrivalReliabilityProfileRow,
} from './ArrivalReliabilityProfilePlot';
import { ArrivalReliabilitySectionBody } from './ArrivalReliabilitySectionBody';
import { arrivalWeekday } from './labels';
import type { ArrivalReliabilityQueryState } from './types';

interface ArrivalReliabilityWeekdayProfileProps {
  analysis: ArrivalReliabilityResult;
  state: ArrivalReliabilityQueryState;
  locale: string;
  timeZone: string;
}

export function ArrivalReliabilityWeekdayProfile({
  analysis,
  state,
  locale,
  timeZone,
}: ArrivalReliabilityWeekdayProfileProps) {
  const { t } = useTranslation();
  const rows = useMemo<ArrivalReliabilityProfileRow[]>(
    () =>
      analysis.weekdayProfile.map((point) => ({
        key: String(point.weekday),
        label: arrivalWeekday(point.weekday, locale),
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
    [analysis.weekdayProfile, locale],
  );
  const ready =
    state.isResolved && !state.error && analysis.routes.length > 0;

  return (
    <section data-testid="arrival-weekday-profile">
      <ChartContainer
        title={t(
          'arrivalReliability.profiles.weekdayTitle',
          'Vehicle-timezone weekday profile',
        )}
        subtitle={t(
          'arrivalReliability.profiles.weekdaySubtitle',
          'Route-normalized duration, observed allowance share, and separate drive counts by local weekday.',
        )}
        ariaLabel={t(
          'arrivalReliability.profiles.weekdayAria',
          'Seven-day vehicle-timezone profile of route-normalized duration, observed allowance share, and samples',
        )}
        ariaDescription={t(
          'arrivalReliability.profiles.weekdayDescription',
          'Multiple drives on one local day count separately; weekday labels use {{timeZone}}.',
          { timeZone },
        )}
        height={360}
        chartKey="arrival-weekday-profile"
        exportable={ready}
        exportFilename="arrival-weekday-profile"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'label',
            label: t(
              'arrivalReliability.profiles.column.weekday',
              'Vehicle-local weekday',
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
