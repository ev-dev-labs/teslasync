import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  destinationEvidenceBandLabel,
  destinationWeekday,
} from './labels';
import {
  DestinationTransitionProfilePlot,
  type DestinationTransitionProfileRow,
} from './DestinationTransitionProfilePlot';
import { DestinationTransitionsSectionBody } from './DestinationTransitionsSectionBody';
import type { DestinationTransitionsQueryState } from './types';

interface WeekdayTransitionProfileProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
  timeZone: string;
}

export function WeekdayTransitionProfile({
  model,
  state,
  locale,
  timeZone,
}: WeekdayTransitionProfileProps) {
  const { t } = useTranslation();
  const rows = useMemo<DestinationTransitionProfileRow[]>(
    () =>
      model.weekdayProfile.map((point) => ({
        label: destinationWeekday(point.weekday, locale),
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
    [locale, model.weekdayProfile, t],
  );
  const ready =
    state.isResolved && !state.error && model.acceptedTransitions > 0;
  const countName = t(
    'destinationTransitions.weekday.series.count',
    'Accepted transitions',
  );
  const concentrationName = t(
    'destinationTransitions.weekday.series.concentration',
    'Transition concentration index',
  );

  return (
    <section data-testid="destination-weekday-profile">
      <ChartContainer
        title={t(
          'destinationTransitions.weekday.title',
          'Vehicle-timezone weekday profile',
        )}
        subtitle={t(
          'destinationTransitions.weekday.subtitle',
          'Accepted transition starts grouped by weekday in {{timeZone}}.',
          { timeZone },
        )}
        ariaLabel={t(
          'destinationTransitions.weekday.aria',
          'Seven-day vehicle-timezone profile of accepted transition counts and concentration',
        )}
        ariaDescription={t(
          'destinationTransitions.weekday.description',
          'The accessible data includes distinct origins, destinations, historical leading-edge share, and sample support.',
        )}
        height={350}
        chartKey="destination-weekday-profile"
        exportable={ready}
        exportFilename="destination-weekday-profile"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'label',
            label: t(
              'destinationTransitions.weekday.column.weekday',
              'Vehicle-local weekday',
            ),
          },
          {
            key: 'samples',
            label: t(
              'destinationTransitions.weekday.column.samples',
              'Accepted transitions',
            ),
          },
          {
            key: 'origins',
            label: t(
              'destinationTransitions.weekday.column.origins',
              'Distinct origins',
            ),
          },
          {
            key: 'destinations',
            label: t(
              'destinationTransitions.weekday.column.destinations',
              'Distinct destinations',
            ),
          },
          {
            key: 'concentration',
            label: t(
              'destinationTransitions.weekday.column.concentration',
              'Transition concentration index',
            ),
          },
          {
            key: 'leadingShare',
            label: t(
              'destinationTransitions.weekday.column.leadingShare',
              'Leading edge share (%)',
            ),
          },
          {
            key: 'support',
            label: t(
              'destinationTransitions.weekday.column.support',
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
