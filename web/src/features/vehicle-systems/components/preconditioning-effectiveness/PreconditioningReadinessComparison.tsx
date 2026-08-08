import { Gauge } from 'lucide-react';
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

interface PreconditioningReadinessComparisonProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  convertDelta: TemperatureDeltaConverter;
  formatDelta: TemperatureDeltaFormatter;
  temperatureUnit: string;
}

export function PreconditioningReadinessComparison({
  summary,
  state,
  convertDelta,
  formatDelta,
  temperatureUnit,
}: PreconditioningReadinessComparisonProps) {
  const { t } = useTranslation();
  const comparisons = [summary.overall, ...summary.strata];
  const data = comparisons.map((row) => ({
    regime: preconditioningRegimeLabel(t, row.regime),
    active: row.evidence !== 'none'
      ? convertDelta(row.conditionedStartDeltaC)
      : null,
    control: row.evidence !== 'none'
      ? convertDelta(row.unconditionedStartDeltaC)
      : null,
  }));

  return (
    <section data-testid="preconditioning-readiness-comparison">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t(
            'preconditioningEffectiveness.readiness.title',
            'Departure-readiness comparison',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.readiness.subtitle',
            'Median absolute cabin-to-front-row-target gap at the final qualified distinct cabin state; lower means closer to target.',
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
              'preconditioningEffectiveness.readiness.plotTitle',
              'Median departure gap by observational group',
            )}
            ariaLabel={t(
              'preconditioningEffectiveness.readiness.aria',
              'Grouped bars comparing median departure cabin gaps for observed HVAC-active and explicitly HVAC-off control departures',
            )}
            height={300}
            chartKey="preconditioning-effectiveness-readiness"
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
            metric="readiness"
            formatDelta={formatDelta}
          />
        </PreconditioningSectionBody>
      </GlassPanel>
    </section>
  );
}
