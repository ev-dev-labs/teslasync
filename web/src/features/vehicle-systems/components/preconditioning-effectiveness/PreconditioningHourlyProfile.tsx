import { Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { chartTokens } from '@/lib/tokens';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type {
  PreconditioningQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface PreconditioningHourlyProfileProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  formatDelta: TemperatureDeltaFormatter;
}

export function PreconditioningHourlyProfile({
  summary,
  state,
  formatDelta,
}: PreconditioningHourlyProfileProps) {
  const { t } = useTranslation();
  const data = summary.hourlyProfile.map((bucket) => ({
    hour: t('preconditioningEffectiveness.hourly.hourLabel', '{{hour}}:00', {
      hour: String(bucket.hour).padStart(2, '0'),
    }),
    active: bucket.conditionedDepartures,
    control: bucket.unconditionedDepartures,
    classified: bucket.classifiedDepartures,
    meanStart: formatDelta(bucket.meanStartDeltaC),
    meanImprovement: formatDelta(bucket.meanImprovementC, { signed: true }),
  }));
  const occupied = summary.hourlyProfile.filter(
    (bucket) => bucket.classifiedDepartures > 0,
  );

  return (
    <section data-testid="preconditioning-hourly-profile">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t(
            'preconditioningEffectiveness.hourly.title',
            'Classification and hourly profile',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.hourly.subtitle',
            'Classified departures by browser-local departure hour; counts are observational and overlapping windows can share climate rows.',
          )}
        </Text>
        <PreconditioningSectionBody
          summary={summary}
          state={state}
          requirement="classified"
          skeletonHeight={330}
        >
          <ChartContainer
            title={t(
              'preconditioningEffectiveness.hourly.plotTitle',
              'Classified departures by local hour',
            )}
            ariaLabel={t(
              'preconditioningEffectiveness.hourly.aria',
              'Stacked bar chart of observed HVAC-active and explicitly HVAC-off control departures by local hour',
            )}
            height={300}
            chartKey="preconditioning-effectiveness-hourly"
            data={data}
            dataColumns={[
              { key: 'hour', label: t('preconditioningEffectiveness.hourly.hour', 'Hour') },
              { key: 'active', label: t('preconditioningEffectiveness.groups.observedActive', 'Observed HVAC-active pre-drive') },
              { key: 'control', label: t('preconditioningEffectiveness.groups.explicitOff', 'Explicitly HVAC-off control') },
              { key: 'meanStart', label: t('preconditioningEffectiveness.hourly.meanStart', 'Mean departure gap') },
              { key: 'meanImprovement', label: t('preconditioningEffectiveness.hourly.meanImprovement', 'Mean observed improvement') },
            ]}
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                  <XAxis dataKey="hour" interval={1} tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ChartLegend />
                  <Bar
                    dataKey="active"
                    name={t('preconditioningEffectiveness.groups.observedActive', 'Observed HVAC-active pre-drive')}
                    stackId="departures"
                    fill={chartTokens.series[0]}
                    hide={hiddenSeries?.isHidden('active')}
                  />
                  <Bar
                    dataKey="control"
                    name={t('preconditioningEffectiveness.groups.explicitOff', 'Explicitly HVAC-off control')}
                    stackId="departures"
                    fill={chartTokens.series[2]}
                    radius={[4, 4, 0, 0]}
                    hide={hiddenSeries?.isHidden('control')}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartContainer>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {occupied.map((bucket) => (
              <div
                key={bucket.hour}
                className="rounded-lg border border-[var(--border-subtle)] p-3"
              >
                <MetricLabel>
                  {t('preconditioningEffectiveness.hourly.hourLabel', '{{hour}}:00', {
                    hour: String(bucket.hour).padStart(2, '0'),
                  })}
                </MetricLabel>
                <Text as="p" variant="bodySm" className="mt-1">
                  {t(
                    'preconditioningEffectiveness.hourly.bucketCounts',
                    '{{active}} active · {{control}} control',
                    {
                      active: bucket.conditionedDepartures,
                      control: bucket.unconditionedDepartures,
                    },
                  )}
                </Text>
                <Text as="p" variant="caption">
                  {t(
                    'preconditioningEffectiveness.hourly.bucketMeans',
                    'Mean gap {{gap}} · improvement {{improvement}}',
                    {
                      gap: formatDelta(bucket.meanStartDeltaC),
                      improvement: formatDelta(bucket.meanImprovementC, { signed: true }),
                    },
                  )}
                </Text>
              </div>
            ))}
          </div>
        </PreconditioningSectionBody>
      </GlassPanel>
    </section>
  );
}
