import { TrendingUp } from 'lucide-react';
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
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { chartTokens } from '@/lib/tokens';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { preconditioningRegimeLabel } from './labels';
import { PreconditioningComparisonCards } from './PreconditioningComparisonCards';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type {
  PreconditioningQueryState,
  TemperatureDeltaConverter,
  TemperatureDeltaFormatter,
} from './types';

interface PreconditioningImprovementComparisonProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  convertDelta: TemperatureDeltaConverter;
  formatDelta: TemperatureDeltaFormatter;
  temperatureUnit: string;
}

export function PreconditioningImprovementComparison({
  summary,
  state,
  convertDelta,
  formatDelta,
  temperatureUnit,
}: PreconditioningImprovementComparisonProps) {
  const { t } = useTranslation();
  const comparisons = [summary.overall, ...summary.strata];
  const data = comparisons.map((row) => ({
    regime: preconditioningRegimeLabel(t, row.regime),
    active: row.evidence !== 'none'
      ? convertDelta(row.conditionedImprovementC)
      : null,
    control: row.evidence !== 'none'
      ? convertDelta(row.unconditionedImprovementC)
      : null,
  }));

  return (
    <section data-testid="preconditioning-improvement-comparison">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t(
            'preconditioningEffectiveness.improvement.title',
            'Cabin-improvement comparison',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.improvement.subtitle',
            'Median initial absolute gap minus final absolute gap within each qualified pre-drive window; positive values moved toward target.',
          )}
        </Text>
        <PreconditioningSectionBody
          summary={summary}
          state={state}
          requirement="comparison"
          skeletonHeight={330}
        >
          <ChartContainer
            title={t(
              'preconditioningEffectiveness.improvement.plotTitle',
              'Median observed cabin improvement by group',
            )}
            ariaLabel={t(
              'preconditioningEffectiveness.improvement.aria',
              'Grouped bars comparing median observed cabin improvement for HVAC-active and explicitly HVAC-off control departures',
            )}
            height={300}
            chartKey="preconditioning-effectiveness-improvement"
            data={data}
            dataColumns={[
              { key: 'regime', label: t('preconditioningEffectiveness.comparison.stratum', 'Stratum') },
              { key: 'active', label: t('preconditioningEffectiveness.groups.observedActive', 'Observed HVAC-active pre-drive') },
              { key: 'control', label: t('preconditioningEffectiveness.groups.explicitOff', 'Explicitly HVAC-off control') },
            ]}
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                  <XAxis dataKey="regime" tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                  <YAxis unit={temperatureUnit} tick={{ fill: chartTokens.axisStroke, fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ChartLegend />
                  <Bar
                    dataKey="active"
                    name={t('preconditioningEffectiveness.groups.observedActive', 'Observed HVAC-active pre-drive')}
                    fill={chartTokens.series[0]}
                    radius={[4, 4, 0, 0]}
                    hide={hiddenSeries?.isHidden('active')}
                  />
                  <Bar
                    dataKey="control"
                    name={t('preconditioningEffectiveness.groups.explicitOff', 'Explicitly HVAC-off control')}
                    fill={chartTokens.series[2]}
                    radius={[4, 4, 0, 0]}
                    hide={hiddenSeries?.isHidden('control')}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartContainer>
          <PreconditioningComparisonCards
            comparisons={comparisons}
            metric="improvement"
            formatDelta={formatDelta}
          />
        </PreconditioningSectionBody>
      </GlassPanel>
    </section>
  );
}
