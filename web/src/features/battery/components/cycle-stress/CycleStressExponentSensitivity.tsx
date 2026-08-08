import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import type { CycleStressResult } from '../../lib/cycleStress';
import { CycleStressSectionBody } from './CycleStressSectionBody';
import type { CycleStressQueryState } from './types';

interface CycleStressExponentSensitivityProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
}

export function CycleStressExponentSensitivity({
  result,
  state,
}: CycleStressExponentSensitivityProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.exponentSensitivity.map((point) => ({
        exponent: point.exponent,
        label: `d^${point.exponent}`,
        depthWeightedIndex: point.depthWeightedIndex,
        indexToEfcPct:
          point.indexToEfcRatio == null
            ? null
            : point.indexToEfcRatio * 100,
      })),
    [result.exponentSensitivity],
  );

  return (
    <section data-testid="cycle-stress-exponent-sensitivity">
      <ChartContainer
        title={t(
          'cycleStress.exponent.title',
          'Illustrative exponent sensitivity',
        )}
        subtitle={t(
          'cycleStress.exponent.subtitle',
          'The same reconstructed ranges under alternative depth exponents; this is a mathematical comparison, not a manufacturer damage model.',
        )}
        ariaLabel={t(
          'cycleStress.exponent.aria',
          'Bar chart of depth-weighted index under alternative exponents',
        )}
        height={300}
        loading={state.isLoading}
        empty={false}
        exportable={
          state.isResolved && !state.error && result.cycles.length > 0
        }
        exportData={rows}
        data={rows}
        dataColumns={[
          {
            key: 'exponent',
            label: t('cycleStress.columns.exponent', 'Exponent'),
          },
          {
            key: 'depthWeightedIndex',
            label: t(
              'cycleStress.columns.depthIndex',
              'Depth-weighted index',
            ),
          },
          {
            key: 'indexToEfcPct',
            label: t(
              'cycleStress.columns.indexToEfcPct',
              'Index / EFC (%)',
            ),
          },
        ]}
      >
        <CycleStressSectionBody
          result={result}
          state={state}
          requirement="cycles"
          className="h-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--glass-border)"
                strokeOpacity={0.4}
              />
              <XAxis
                dataKey="label"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="depthWeightedIndex"
                name={t(
                  'cycleStress.series.depthIndex',
                  'Depth-weighted index',
                )}
                radius={[4, 4, 0, 0]}
              >
                {rows.map((row) => (
                  <Cell
                    key={row.label}
                    fill={
                      row.exponent === result.config.exponent
                        ? chartTokens.series[4]
                        : chartTokens.series[0]
                    }
                    fillOpacity={
                      row.exponent === result.config.exponent
                        ? 0.95
                        : 0.62
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CycleStressSectionBody>
      </ChartContainer>
    </section>
  );
}
