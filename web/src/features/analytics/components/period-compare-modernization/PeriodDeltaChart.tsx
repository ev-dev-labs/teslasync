import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ChartTooltip, EmbeddedChart,
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, axisTick, chartAnimation,
} from '@/components/charts';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface PeriodDeltaChartProps {
  data: { name: string; delta: number; fill: string }[];
  metrics: { label: string; b: number }[];
  error: Error | null;
  loading: boolean;
  onRetry: () => void;
}

/** Unitless A-vs-B specialist chart; all original chart actions stay delegated. */
export function PeriodDeltaChart({ data, metrics, error, loading, onRetry }: PeriodDeltaChartProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  return (
    <LayoutCard title={t('compare.deltaChartTitle', 'Change vs period B (%)')}>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : loading ? (
        <Skeleton height={288} />
      ) : data.length === 0 ? (
        <EmptyState /* no-action: no valid percent baseline in the selected windows */
          icon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
          message={metrics.length === 0
            ? t('compare.empty', 'Select a vehicle and two periods to compare.')
            : t('compare.noChartBaseline', 'Percent change requires a nonzero period B baseline. Try another window.')}
        />
      ) : (
        <>
          {data.length < metrics.length && (
            <Text as="p" size="sm" color="secondary">
              {metrics.length - data.length === 1
                ? t('compare.omittedBaseline', 'One metric with no period B baseline is omitted from the chart.')
                : t('compare.omittedBaselines', '{{count}} metrics with no period B baseline are omitted from the chart.', {
                  count: metrics.length - data.length,
                })}
            </Text>
          )}
          <EmbeddedChart
            title={t('compare.deltaChartTitle', 'Change vs period B (%)')}
            ariaLabel={t('compare.deltaChartAria', 'Percent change of each metric in period A relative to period B')}
            data={data}
            dataColumns={[
              { key: 'name', label: t('compare.metric', 'Metric') },
              {
                key: 'delta',
                label: t('compare.pctChange', '% Change'),
                format: (value) => `${fmtNumber(Number(value ?? 0))}%`,
              },
            ]}
            height={320}
            mobileHeight={280}
            chartKey="period-compare-delta-vs-b"
          >
            {() => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--glass-border)"
                    strokeOpacity={0.4}
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={axisTick}
                    tickFormatter={(v) => `${fmtNumber(Number(v))}%`}
                    domain={[(dataMin: number) => Math.min(0, dataMin), (dataMax: number) => Math.max(0, dataMax)]}
                  />
                  <YAxis type="category" dataKey="name" tick={axisTick} width={112} />
                  <Tooltip content={({ active, payload, label }) => (
                    <ChartTooltip
                      active={active}
                      payload={payload as { name: string; value: unknown; color?: string; fill?: string; unit?: string }[]}
                      label={label as string}
                      valueFormatter={(value) =>
                        metrics.find((m) => m.label === label)?.b === 0
                          ? '—'
                          : `${fmtNumber(Number(value ?? 0))}%`
                      }
                    />
                  )} />
                  <ReferenceLine x={0} stroke="var(--glass-border)" />
                  <Bar
                    dataKey="delta"
                    name={t('compare.pctChange', '% Change')}
                    radius={4}
                    {...chartAnimation}
                  >
                    {data.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </EmbeddedChart>
        </>
      )}
    </LayoutCard>
  );
}
