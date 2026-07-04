import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ChartTooltip,
  AREA_DEFAULTS,
  areaGradient,
} from '@/components/charts';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useFormatting } from '@/hooks/useFormatting';
import { formatDate } from '@/lib/dateFormat';
import type { GasPriceHistory } from '@/api/types';

interface GasPriceTrendChartProps {
  query: UseQueryResult<GasPriceHistory[], Error>;
}

/**
 * Hero visual — historical EIA price trend. The `/gas-price/history` endpoint
 * returns rows newest-first, so we reverse to chronological order for the time
 * axis. Loading, empty, and error states are all handled independently.
 */
export function GasPriceTrendChart({ query }: GasPriceTrendChartProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const { formatCurrency } = useFormatting();
  const color = palette[3] ?? palette[0] ?? '#f59e0b';

  const { data, isLoading, isError, error, refetch } = query;

  const rows = useMemo(() => {
    const history = data ?? [];
    return history
      .slice()
      .reverse()
      .map((h) => ({
        date: formatDate(h.effective_from),
        price: h.price_per_unit ?? 0,
      }));
  }, [data]);

  return (
    <GlassPanel className="flex h-full flex-col p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('gas.priceTrend', 'Price Trend')}
      </PanelTitle>

      {isError ? (
        <QueryError
          error={error}
          onRetry={() => void refetch()}
          resourceName={t('gas.title', 'Gas Price Auto-Poll')}
        />
      ) : isLoading && rows.length === 0 ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading', 'Loading')}>
          <Skeleton height={240} className="rounded-xl" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<TrendingUp className="h-8 w-8" />}
          message={t('gas.noHistory', 'No price history recorded yet. Trigger a poll to get started.')}
        />
      ) : (
        <div
          role="img"
          aria-label={t('gas.priceTrendAria', 'Line chart of historical gas prices over time')}
          className="h-56 sm:h-64 xl:h-72"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {areaGradient('gasPriceGrad', color)}
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis
                width={56}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                domain={['auto', 'auto']}
                tickFormatter={(v) => formatCurrency(Number(v))}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                {...AREA_DEFAULTS}
                dataKey="price"
                name={t('gas.priceSeries', 'Price')}
                stroke={color}
                fill="url(#gasPriceGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </GlassPanel>
  );
}
