import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { fmtNumber } from '@/lib/numberFormat';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import { DestinationTransitionsSectionBody } from './DestinationTransitionsSectionBody';
import type { DestinationTransitionsQueryState } from './types';

interface DestinationVisitShareChartProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
}

export function DestinationVisitShareChart({
  model,
  state,
  locale,
}: DestinationVisitShareChartProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      model.states.slice(0, 12).map((destination) => ({
        destination: destination.label,
        share: Math.round(destination.visitShare * 1_000) / 10,
        visits: destination.visits,
        activeDays: destination.activeLocalDays,
        activeWeeks: destination.activeLocalWeeks,
      })),
    [model.states],
  );
  const ready = state.isResolved && !state.error && rows.length > 0;

  return (
    <section data-testid="destination-visit-share">
      <ChartContainer
        title={t(
          'destinationTransitions.visitShare.title',
          'Destination visit share',
        )}
        subtitle={t(
          'destinationTransitions.visitShare.subtitle',
          'Included completed-drive arrivals by normalized end destination.',
        )}
        ariaLabel={t(
          'destinationTransitions.visitShare.aria',
          'Visit share for the most common normalized end destinations',
        )}
        ariaDescription={t(
          'destinationTransitions.visitShare.description',
          'The accessible data includes visit counts and active vehicle-local days and weeks.',
        )}
        height={350}
        exportable={ready}
        exportFilename="destination-visit-share"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'destination',
            label: t(
              'destinationTransitions.visitShare.column.destination',
              'Destination',
            ),
          },
          {
            key: 'share',
            label: t(
              'destinationTransitions.visitShare.column.share',
              'Visit share (%)',
            ),
          },
          {
            key: 'visits',
            label: t(
              'destinationTransitions.visitShare.column.visits',
              'Included visits',
            ),
          },
          {
            key: 'activeDays',
            label: t(
              'destinationTransitions.visitShare.column.activeDays',
              'Active local days',
            ),
          },
          {
            key: 'activeWeeks',
            label: t(
              'destinationTransitions.visitShare.column.activeWeeks',
              'Active local weeks',
            ),
          },
        ]}
      >
        <DestinationTransitionsSectionBody
          model={model}
          state={state}
          requirement="visits"
          className="h-full min-h-0"
          skeletonHeight={310}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--glass-border)"
                strokeOpacity={0.4}
              />
              <XAxis
                dataKey="destination"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis
                domain={[0, 100]}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                unit="%"
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value) =>
                      `${fmtNumber(value, 1, locale)}%`
                    }
                  />
                }
              />
              <Bar
                dataKey="share"
                name={t(
                  'destinationTransitions.visitShare.series',
                  'Visit share',
                )}
                fill={CHART_COLORS[0]}
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </DestinationTransitionsSectionBody>
      </ChartContainer>
    </section>
  );
}
