import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  destinationEvidenceBandLabel,
  destinationLocalHour,
} from './labels';
import {
  DestinationTransitionProfilePlot,
  type DestinationTransitionProfileRow,
} from './DestinationTransitionProfilePlot';
import { DestinationTransitionsSectionBody } from './DestinationTransitionsSectionBody';
import type { DestinationTransitionsQueryState } from './types';

interface LocalTwoHourTransitionProfileProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
  timeZone: string;
}

export function LocalTwoHourTransitionProfile({
  model,
  state,
  locale,
  timeZone,
}: LocalTwoHourTransitionProfileProps) {
  const { t } = useTranslation();
  const rows = useMemo<DestinationTransitionProfileRow[]>(
    () =>
      model.twoHourProfile.map((point) => ({
        label: destinationLocalHour(point.bucketStartHour, locale),
        samples: point.samples,
        origins: point.distinctOrigins,
        destinations: point.distinctDestinations,
        concentration: point.transitionConcentrationIndex,
        leadingShare:
          point.leadingEdgeShare != null
            ? Math.round(point.leadingEdgeShare * 1_000) / 10
            : null,
        support: destinationEvidenceBandLabel(t, point.support.band),
      })),
    [locale, model.twoHourProfile, t],
  );
  const ready =
    state.isResolved && !state.error && model.acceptedTransitions > 0;
  const countName = t(
    'destinationTransitions.twoHour.series.count',
    'Accepted transitions',
  );
  const concentrationName = t(
    'destinationTransitions.twoHour.series.concentration',
    'Transition concentration index',
  );

  return (
    <section data-testid="destination-two-hour-profile">
      <ChartContainer
        title={t(
          'destinationTransitions.twoHour.title',
          'Vehicle-local two-hour transition profile',
        )}
        subtitle={t(
          'destinationTransitions.twoHour.subtitle',
          'Accepted transitions use the current drive start in {{timeZone}}; multiple drives per day remain separate samples.',
          { timeZone },
        )}
        ariaLabel={t(
          'destinationTransitions.twoHour.aria',
          'Twelve-bin vehicle-local profile of accepted transition counts and concentration',
        )}
        ariaDescription={t(
          'destinationTransitions.twoHour.description',
          'The accessible data includes distinct origins, destinations, historical leading-edge share, and sample support.',
        )}
        height={350}
        chartKey="destination-two-hour-profile"
        exportable={ready}
        exportFilename="destination-two-hour-profile"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'label',
            label: t(
              'destinationTransitions.twoHour.column.window',
              'Local two-hour window',
            ),
          },
          {
            key: 'samples',
            label: t(
              'destinationTransitions.twoHour.column.samples',
              'Accepted transitions',
            ),
          },
          {
            key: 'origins',
            label: t(
              'destinationTransitions.twoHour.column.origins',
              'Distinct origins',
            ),
          },
          {
            key: 'destinations',
            label: t(
              'destinationTransitions.twoHour.column.destinations',
              'Distinct destinations',
            ),
          },
          {
            key: 'concentration',
            label: t(
              'destinationTransitions.twoHour.column.concentration',
              'Transition concentration index',
            ),
          },
          {
            key: 'leadingShare',
            label: t(
              'destinationTransitions.twoHour.column.leadingShare',
              'Leading edge share (%)',
            ),
          },
          {
            key: 'support',
            label: t(
              'destinationTransitions.twoHour.column.support',
              'Sample support',
            ),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <DestinationTransitionsSectionBody
            model={model}
            state={state}
            className="h-full min-h-0"
            skeletonHeight={310}
          >
            <DestinationTransitionProfilePlot
              rows={rows}
              locale={locale}
              countSeriesName={countName}
              concentrationSeriesName={concentrationName}
              hiddenCount={hiddenSeries?.isHidden('samples')}
              hiddenConcentration={hiddenSeries?.isHidden('concentration')}
            />
          </DestinationTransitionsSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
