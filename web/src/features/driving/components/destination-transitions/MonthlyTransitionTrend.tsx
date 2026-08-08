import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  destinationEvidenceBandLabel,
  destinationMonth,
} from './labels';
import {
  DestinationTransitionProfilePlot,
  type DestinationTransitionProfileRow,
} from './DestinationTransitionProfilePlot';
import { DestinationTransitionsSectionBody } from './DestinationTransitionsSectionBody';
import type { DestinationTransitionsQueryState } from './types';

interface MonthlyTransitionTrendProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
  timeZone: string;
}

export function MonthlyTransitionTrend({
  model,
  state,
  locale,
  timeZone,
}: MonthlyTransitionTrendProps) {
  const { t } = useTranslation();
  const rows = useMemo<DestinationTransitionProfileRow[]>(
    () =>
      model.monthTrend.map((point) => ({
        label: destinationMonth(
          point.firstObservationMs,
          locale,
          timeZone,
        ),
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
    [locale, model.monthTrend, t, timeZone],
  );
  const ready = state.isResolved && !state.error && rows.length > 0;
  const countName = t(
    'destinationTransitions.month.series.count',
    'Accepted transitions',
  );
  const concentrationName = t(
    'destinationTransitions.month.series.concentration',
    'Transition concentration index',
  );

  return (
    <section data-testid="destination-month-trend">
      <ChartContainer
        title={t(
          'destinationTransitions.month.title',
          'Local-month transition trend',
        )}
        subtitle={t(
          'destinationTransitions.month.subtitle',
          'Accepted transition starts grouped by calendar month in {{timeZone}}.',
          { timeZone },
        )}
        ariaLabel={t(
          'destinationTransitions.month.aria',
          'Vehicle-local monthly trend of accepted transition counts and concentration',
        )}
        ariaDescription={t(
          'destinationTransitions.month.description',
          'The accessible data includes distinct origins, destinations, historical leading-edge share, and monthly sample support.',
        )}
        height={360}
        chartKey="destination-month-trend"
        exportable={ready}
        exportFilename="destination-month-trend"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'label',
            label: t(
              'destinationTransitions.month.column.month',
              'Vehicle-local month',
            ),
          },
          {
            key: 'samples',
            label: t(
              'destinationTransitions.month.column.samples',
              'Accepted transitions',
            ),
          },
          {
            key: 'origins',
            label: t(
              'destinationTransitions.month.column.origins',
              'Distinct origins',
            ),
          },
          {
            key: 'destinations',
            label: t(
              'destinationTransitions.month.column.destinations',
              'Distinct destinations',
            ),
          },
          {
            key: 'concentration',
            label: t(
              'destinationTransitions.month.column.concentration',
              'Transition concentration index',
            ),
          },
          {
            key: 'leadingShare',
            label: t(
              'destinationTransitions.month.column.leadingShare',
              'Leading edge share (%)',
            ),
          },
          {
            key: 'support',
            label: t(
              'destinationTransitions.month.column.support',
              'Sample support',
            ),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <DestinationTransitionsSectionBody
            model={model}
            state={state}
            requirement="months"
            className="h-full min-h-0"
            skeletonHeight={320}
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
