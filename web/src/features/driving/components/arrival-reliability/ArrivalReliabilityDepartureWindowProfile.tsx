import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import {
  ArrivalReliabilityProfilePlot,
  type ArrivalReliabilityProfileRow,
} from './ArrivalReliabilityProfilePlot';
import { ArrivalReliabilitySectionBody } from './ArrivalReliabilitySectionBody';
import { arrivalLocalHour } from './labels';
import type { ArrivalReliabilityQueryState } from './types';

interface ArrivalReliabilityDepartureWindowProfileProps {
  analysis: ArrivalReliabilityResult;
  state: ArrivalReliabilityQueryState;
  locale: string;
}

export function ArrivalReliabilityDepartureWindowProfile({
  analysis,
  state,
  locale,
}: ArrivalReliabilityDepartureWindowProfileProps) {
  const { t } = useTranslation();
  const rows = useMemo<ArrivalReliabilityProfileRow[]>(
    () =>
      analysis.twoHourProfile.map((point) => ({
        key: String(point.bucketStartHour),
        label: t(
          'arrivalReliability.profiles.windowValue',
          '{{start}}–{{end}}',
          {
            start: arrivalLocalHour(point.bucketStartHour, locale),
            end: arrivalLocalHour(
              (point.bucketStartHour + 2) % 24,
              locale,
            ),
          },
        ),
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
    [analysis.twoHourProfile, locale, t],
  );
  const ready =
    state.isResolved && !state.error && analysis.routes.length > 0;

  return (
    <section data-testid="arrival-window-profile">
      <ChartContainer
        title={t(
          'arrivalReliability.profiles.windowTitle',
          'Local two-hour departure-window profile',
        )}
        subtitle={t(
          'arrivalReliability.profiles.windowSubtitle',
          'Route-normalized duration and observed allowance share across all 12 vehicle-local windows.',
        )}
        ariaLabel={t(
          'arrivalReliability.profiles.windowAria',
          'Twelve-bin vehicle-local departure-window profile of route-normalized duration, observed allowance share, and samples',
        )}
        ariaDescription={t(
          'arrivalReliability.profiles.windowDescription',
          'A duration index of 100 equals each drive route median; unequal route support can leave residual route-mix effects.',
        )}
        height={360}
        chartKey="arrival-window-profile"
        exportable={ready}
        exportFilename="arrival-window-profile"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'label',
            label: t(
              'arrivalReliability.profiles.column.window',
              'Vehicle-local window',
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
