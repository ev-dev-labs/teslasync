import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import { destinationEvidenceBandLabel } from './labels';
import {
  OriginConcentrationPlot,
  type OriginConcentrationRow,
} from './OriginConcentrationPlot';
import { DestinationTransitionsSectionBody } from './DestinationTransitionsSectionBody';
import type { DestinationTransitionsQueryState } from './types';

interface OriginConcentrationSupportChartProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
}

export function OriginConcentrationSupportChart({
  model,
  state,
  locale,
}: OriginConcentrationSupportChartProps) {
  const { t } = useTranslation();
  const rows = useMemo<OriginConcentrationRow[]>(
    () =>
      model.states
        .filter((origin) => origin.outgoingTransitions > 0)
        .sort(
          (left, right) =>
            right.outgoingTransitions - left.outgoingTransitions
            || left.key.localeCompare(right.key),
        )
        .slice(0, 10)
        .map((origin) => ({
          origin: origin.label,
          concentration:
            Math.round(
              (origin.transitionConcentrationIndex ?? 0) * 10,
            ) / 10,
          leadingShare:
            Math.round(
              (origin.leadingSuccessorObservedShare ?? 0) * 1_000,
            ) / 10,
          outgoing: origin.outgoingTransitions,
          successors: origin.distinctObservedSuccessors,
          supportIndex: Math.round(origin.support.index * 10) / 10,
          support: destinationEvidenceBandLabel(t, origin.support.band),
        })),
    [model.states, t],
  );
  const ready = state.isResolved && !state.error && rows.length > 0;
  const concentrationName = t(
    'destinationTransitions.originChart.concentrationSeries',
    'Transition concentration index',
  );
  const leadingName = t(
    'destinationTransitions.originChart.leadingSeries',
    'Leading successor share',
  );

  return (
    <section data-testid="destination-origin-concentration">
      <ChartContainer
        title={t(
          'destinationTransitions.originChart.title',
          'Origin concentration and support',
        )}
        subtitle={t(
          'destinationTransitions.originChart.subtitle',
          'Concentration and leading-share shape stay separate from outgoing volume and support.',
        )}
        ariaLabel={t(
          'destinationTransitions.originChart.aria',
          'Transition concentration index and historical leading successor share by origin',
        )}
        ariaDescription={t(
          'destinationTransitions.originChart.description',
          'The accessible data also lists outgoing observations, distinct successors, support index, and evidence band.',
        )}
        height={370}
        chartKey="destination-origin-concentration"
        exportable={ready}
        exportFilename="destination-origin-concentration"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'origin',
            label: t(
              'destinationTransitions.originChart.column.origin',
              'Origin destination',
            ),
          },
          {
            key: 'concentration',
            label: t(
              'destinationTransitions.originChart.column.concentration',
              'Transition concentration index',
            ),
          },
          {
            key: 'leadingShare',
            label: t(
              'destinationTransitions.originChart.column.leadingShare',
              'Leading successor share (%)',
            ),
          },
          {
            key: 'outgoing',
            label: t(
              'destinationTransitions.originChart.column.outgoing',
              'Outgoing transitions',
            ),
          },
          {
            key: 'successors',
            label: t(
              'destinationTransitions.originChart.column.successors',
              'Distinct observed successors',
            ),
          },
          {
            key: 'supportIndex',
            label: t(
              'destinationTransitions.originChart.column.supportIndex',
              'Support index',
            ),
          },
          {
            key: 'support',
            label: t(
              'destinationTransitions.originChart.column.support',
              'Evidence band',
            ),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <DestinationTransitionsSectionBody
            model={model}
            state={state}
            requirement="origins"
            className="h-full min-h-0"
            skeletonHeight={330}
          >
            <OriginConcentrationPlot
              rows={rows}
              locale={locale}
              concentrationName={concentrationName}
              leadingName={leadingName}
              hiddenConcentration={
                hiddenSeries?.isHidden('concentration') ?? false
              }
              hiddenLeadingShare={
                hiddenSeries?.isHidden('leadingShare') ?? false
              }
            />
          </DestinationTransitionsSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
