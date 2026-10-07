import { useTranslation } from 'react-i18next';
import { CircuitBoard } from 'lucide-react';
import {
  ChartContainer, ChartTooltip, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import type { ImpactVerdict } from '../../lib/firmwareImpact';
import type { FirmwareImpactState } from './firmwareImpactState';

export interface FirmwareImpactChartRow {
  version: string;
  delta: number;
  share: number;
  p: number | null;
  verdict: ImpactVerdict;
}

export function FirmwareImpactChart({
  chartData,
  exportData,
  state,
  onRetry,
}: {
  chartData: FirmwareImpactChartRow[];
  exportData: Array<Omit<FirmwareImpactChartRow, 'verdict'> & { verdict: string }>;
  state: FirmwareImpactState;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const title = t('firmwareImpact.chart', 'Consumption change per version');
  return (
    // Keep the panel frame: embedded mode suppresses the existing export and
    // fullscreen toolbar. A second chart/overlay implementation is not needed.
    <ChartContainer
      title={title}
      subtitle={t(
        'firmwareImpact.modernization.chartHint',
        'Bars below zero show lower observed consumption after an install, not proof that the update caused the change.',
      )}
      ariaLabel={t(
        'firmwareImpact.chart.aria',
        'Bar chart of the change in energy consumption in watt-hours per kilometre after each firmware version',
      )}
      loading={state.loading}
      error={state.fatalError}
      onRetry={onRetry}
      empty={!state.hasInputs || chartData.length === 0}
      emptyIcon={<CircuitBoard className="h-8 w-8" aria-hidden="true" />}
      emptyMessage={t(
        'firmwareImpact.noData',
        'No update yet has enough drives on both sides of it to support a comparison. This fills in as you drive after each install.',
      )}
      height={340}
      data={exportData}
      exportData={exportData}
      dataColumns={[
        { key: 'version', label: t('firmwareImpact.col.version', 'Version') },
        { key: 'delta', label: t('firmwareImpact.col.delta', 'Δ Wh/km') },
        { key: 'share', label: t('firmwareImpact.col.share', 'Δ %') },
        { key: 'p', label: t('firmwareImpact.col.p', 'p-value') },
        { key: 'verdict', label: t('firmwareImpact.col.verdict', 'Verdict') },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 16, right: 16, bottom: 32, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
          <XAxis
            dataKey="version"
            tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
            angle={-30}
            textAnchor="end"
            height={56}
          />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit=" Wh/km" />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine y={0} stroke="var(--text-muted)" />
          <Bar dataKey="delta" name={t('firmwareImpact.col.delta', 'Δ Wh/km')} radius={[3, 3, 0, 0]}>
            {chartData.map((d) => (
              <Cell
                key={d.version}
                fill={
                  d.verdict === 'better'
                    ? chartTokens.series[2]
                    : d.verdict === 'worse'
                      ? chartTokens.series[5]
                      : chartTokens.series[7]
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
