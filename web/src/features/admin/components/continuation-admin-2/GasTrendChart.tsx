import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { GasPriceHistory } from '@/api/types';
import { ChartCard } from '@/components/layout';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ChartTooltip, AREA_DEFAULTS, areaGradient } from '@/components/charts';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDate } from '@/lib/dateFormat';
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';
import { chartTokens } from '@/lib/tokens';

export function GasTrendChart({ source }: { source: DataState<GasPriceHistory[]> }) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const { fmtNumber } = useNumberFormatting();
  const chartText = { fontFamily: getChartFontFamily(), fontSize: getChartFontSize(12) };
  const axisTick = { ...chartText, fill: chartTokens.axisStroke };
  const color = palette[3] ?? palette[0] ?? 'var(--text-secondary)';
  const rows = useMemo(() => (source.data ?? []).slice().reverse().map((item) => ({
    ...item, date: formatDate(item.effective_from), price: item.price_per_unit,
  })), [source.data]);
  const units = useMemo(() => [...new Set(rows.map((row) => row.unit))], [rows]);
  const unitLabel = (unit: string) => unit?.trim() ? unit : '—';
  // History has no source currency; the current currency symbol is not a conversion.
  const formatPrice = (value: unknown) => value == null ? '—' : fmtNumber(value);
  return (
    <ChartCard title={t('gas.priceTrend', 'Price trend')} size="compact" fluid
      ariaLabel={t('gas.priceTrendAria', 'Line chart of historical gas prices over time')}
      loading={source.status === 'initial'} error={source.fatalError} onRetry={source.retry ?? undefined}
      empty={source.hasData && rows.length === 0} emptyMessage={t('gas.noHistory', 'No price history recorded yet. Trigger a poll to get started.')}
      data={rows} dataColumns={[
        { key: 'date', label: t('gas.priceTrendDateCol', 'Date') },
        { key: 'price', label: t('gas.priceSeries', 'Price'), format: formatPrice },
        { key: 'unit', label: t('gas.unit', 'Unit'), format: (value) => unitLabel(String(value ?? '')) },
      ]}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {units.map((unit, index) => areaGradient(`gasPriceGrad-${index}`, palette[index + 3] ?? color))}
          <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
          <XAxis dataKey="date" tick={axisTick} />
          <YAxis width={96} tick={axisTick} domain={['auto', 'auto']}
            tickFormatter={(value) => units.length === 1 ? `${formatPrice(value)}/${unitLabel(units[0])}` : formatPrice(value)} />
          <Tooltip content={<ChartTooltip valueFormatter={(value, _name, unit) => `${formatPrice(value)}/${unitLabel(unit ?? '')}`} />} />
          <Legend wrapperStyle={{ ...chartText, color: chartTokens.tooltipMutedText }} />
          {units.map((unit, index) => (
            <Area key={unit} {...AREA_DEFAULTS}
              dataKey={(row: (typeof rows)[number]) => row.unit === unit ? row.price : null}
              connectNulls={false}
              unit={unitLabel(unit)}
              name={`${t('gas.priceSeries', 'Price')}/${unitLabel(unit)}`}
              stroke={palette[index + 3] ?? color} fill={`url(#gasPriceGrad-${index})`} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
