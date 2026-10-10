import { LayoutCard } from '@/components/layout';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  EmbeddedChart,
  ChartLegend,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { Text } from '@/components/ui';
import { chartTokens } from '@/lib/tokens';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type {
  PreconditioningQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface PreconditioningImprovementDistributionProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  formatDelta: TemperatureDeltaFormatter;
}

export function PreconditioningImprovementDistribution({
  summary,
  state,
  formatDelta,
}: PreconditioningImprovementDistributionProps) {
  const { t } = useTranslation();
  const data = summary.improvementDistribution.map((bin) => {
    const band = bin.lowerC == null
      ? t('preconditioningEffectiveness.distribution.below', 'Below {{upper}}', {
          upper: formatDelta(bin.upperC),
        })
      : bin.upperC == null
        ? t('preconditioningEffectiveness.distribution.atLeast', 'At least {{lower}}', {
            lower: formatDelta(bin.lowerC),
          })
        : t(
            'preconditioningEffectiveness.distribution.range',
            '{{lower}} to below {{upper}}',
            {
              lower: formatDelta(bin.lowerC),
              upper: formatDelta(bin.upperC),
            },
          );
    return {
      band,
      active: bin.conditioned,
      control: bin.unconditioned,
      total: bin.total,
    };
  });

  return (
    <section data-testid="preconditioning-improvement-distribution">
      <LayoutCard title={t('preconditioningEffectiveness.distribution.title', 'Observed improvement distribution')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.distribution.subtitle',
            'Counts of qualified departures by initial-gap minus final-gap band; negative values moved farther from the target.',
          )}
        </Text>
        <PreconditioningSectionBody
          summary={summary}
          state={state}
          requirement="classified"
          skeletonHeight={330}
        >
          <EmbeddedChart toolbar exportable size="standard"
            title={t(
              'preconditioningEffectiveness.distribution.plotTitle',
              'Classified departures by improvement band',
            )}
            ariaLabel={t(
              'preconditioningEffectiveness.distribution.aria',
              'Stacked bars of observed HVAC-active and explicitly HVAC-off control departures by cabin-improvement band',
            )}
            height={300}
            chartKey="preconditioning-effectiveness-distribution"
            data={data}
            dataColumns={[
              { key: 'band', label: t('preconditioningEffectiveness.distribution.band', 'Improvement band') },
              { key: 'active', label: t('preconditioningEffectiveness.groups.observedActive', 'Observed HVAC-active pre-drive') },
              { key: 'control', label: t('preconditioningEffectiveness.groups.explicitOff', 'Explicitly HVAC-off control') },
              { key: 'total', label: t('preconditioningEffectiveness.distribution.total', 'Total') },
            ]}
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                  <XAxis dataKey="band" tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
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
          </EmbeddedChart>
        </PreconditioningSectionBody>
      </LayoutCard>
    </section>
  );
}
