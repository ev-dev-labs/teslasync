import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartCard } from '@/components/layout';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ChartTooltip, axisTickSm, type ChartDataColumn,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import type { CadencePoint } from '../SoftwareUpdateCadenceChart';

// Preserve the original chart operands and presentation contracts.
const CHART_MARGIN = { top: 8, right: 8, left: -18, bottom: 0 };
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
const TOOLTIP_CURSOR = { fill: 'var(--surface-2)', opacity: 0.4 };

interface Props {
  data: CadencePoint[];
  loading: boolean;
  error?: unknown;
  onRetry: () => void;
  errorContent?: ReactNode;
  emptyContent?: ReactNode;
  emptyMessage: string;
}

export function SoftwareCadenceCard({ data, loading, error, onRetry, errorContent, emptyContent, emptyMessage }: Props) {
  const { t } = useTranslation();
  const dataColumns = useMemo<ChartDataColumn[]>(() => [
    { key: 'label', label: t('softwareUpdates.cadence.colMonth', 'Month') },
    { key: 'count', label: t('softwareUpdates.cadence.series', 'Updates'), format: v => String(v ?? 0) },
  ], [t]);
  const chartRows = useMemo(() => data.map(({ label, count }) => ({ label, count })), [data]);

  return (
    <ChartCard
      title={t('softwareUpdates.cadence.title', 'Update cadence')}
      ariaLabel={t('softwareUpdates.cadence.aria', 'Software updates per calendar month')}
      data={chartRows}
      dataColumns={dataColumns}
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={data.length === 0}
      emptyMessage={emptyMessage}
      footer={errorContent ?? (data.length === 0 && !loading ? emptyContent : undefined)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
          <XAxis dataKey="label" tick={axisTickSm} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tick={axisTickSm} width={28} />
          <Tooltip content={<ChartTooltip />} cursor={TOOLTIP_CURSOR} />
          <Bar
            dataKey="count"
            name={t('softwareUpdates.cadence.series', 'Updates')}
            fill={chartTokens.series[5]}
            fillOpacity={0.85}
            radius={BAR_RADIUS}
            maxBarSize={56}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
