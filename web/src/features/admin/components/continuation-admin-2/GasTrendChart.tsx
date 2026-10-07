import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { GasPriceHistory } from '@/api/types';
import { ChartCard } from '@/components/layout';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ChartTooltip, AREA_DEFAULTS, areaGradient } from '@/components/charts';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useFormatting } from '@/hooks/useFormatting';
import { formatDate } from '@/lib/dateFormat';

export function GasTrendChart({ source }: { source: DataState<GasPriceHistory[]> }) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const { formatCurrency } = useFormatting();
  const color = palette[3] ?? palette[0] ?? '#f59e0b';
  const rows = useMemo(() => (source.data ?? []).slice().reverse().map((item) => ({
    date: formatDate(item.effective_from), price: item.price_per_unit,
  })), [source.data]);
  return (
    <ChartCard title={t('gas.priceTrend', 'Price trend')} size="compact" fluid
      ariaLabel={t('gas.priceTrendAria', 'Line chart of historical gas prices over time')}
      loading={source.status === 'initial'} error={source.fatalError} onRetry={source.retry ?? undefined}
      empty={source.hasData && rows.length === 0} emptyMessage={t('gas.noHistory', 'No price history recorded yet. Trigger a poll to get started.')}
      data={rows} dataColumns={[
        { key: 'date', label: t('gas.priceTrendDateCol', 'Date') },
        { key: 'price', label: t('gas.priceSeries', 'Price'), format: (value) => value == null ? '—' : formatCurrency(Number(value)) },
      ]}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {areaGradient('gasPriceGrad', color)}
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
          <YAxis width={56} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} tickFormatter={(value) => formatCurrency(Number(value))} />
          <Tooltip content={<ChartTooltip />} />
          <Area {...AREA_DEFAULTS} dataKey="price" name={t('gas.priceSeries', 'Price')} stroke={color} fill="url(#gasPriceGrad)" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
