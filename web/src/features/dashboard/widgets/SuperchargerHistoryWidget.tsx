import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useTeslaChargingHistory } from '@/api/hooks/useCharging';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { WidgetShell } from './WidgetShell';
import { WidgetRankedList, type RankedItem } from './shared';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';

/**
 * Parse an entry's ISO start timestamp to epoch milliseconds. A missing or
 * unparseable value is treated as epoch 0 (ranked oldest) so the recency sort
 * stays deterministic — a raw `new Date(bad).getTime()` yields NaN, and NaN
 * comparisons scramble the order (and which rows survive the top-10 slice).
 */
function startTimeMs(raw: string | null | undefined): number {
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export default function SuperchargerHistoryWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatCurrency } = useFormatting();
  const { formatEnergy } = useUnits();

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useTeslaChargingHistory();

  const entries = data?.entries ?? [];
  const summary = data?.summary;
  const isCompact = size.cols <= 1;

  const rankedItems: RankedItem[] = useMemo(() => {
    const sorted = [...entries]
      .sort((a, b) => startTimeMs(b.charge_start_datetime) - startTimeMs(a.charge_start_datetime))
      .slice(0, 10);

    return sorted.map((entry) => {
      const wh = entry.usage_wh ?? 0;
      const cost = entry.total_due ?? 0;
      return {
        id: entry.id,
        label: entry.site_location_name ?? '—',
        value: wh,
        formattedValue: formatEnergy(wh, { precision: 1 }),
        badge: cost > 0
          ? { text: formatCurrency(cost), variant: 'neutral' as const }
          : undefined,
        barColor: 'bg-yellow-400',
      };
    });
  }, [entries, formatCurrency, formatEnergy]);

  const totalWh = summary?.total_wh ?? 0;
  const totalSpend = summary?.total_spend ?? 0;

  // Compact: show 30-day Supercharger spend as big number
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        {entries.length > 0 ? (
          <WidgetBigNumber
            value={totalSpend}
            unit={t('widget.superchargerHistory.currencyUnit', '$')}
            label={t('widget.superchargerHistory.compactLabel', '30-day Supercharger')}
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Zap className="h-5 w-5" />}
            message={t('widget.superchargerHistory.noData', 'No Supercharger sessions')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // Standard: list of sessions + totals
  return (
    <WidgetShell
      title={t('widget.superchargerHistory.title', 'Supercharger History')}
      icon={<Zap className="h-3.5 w-3.5 text-yellow-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {entries.length > 0 ? (
        <div className="flex flex-col gap-2 h-full">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <WidgetRankedList
              items={rankedItems}
              maxItems={10}
              showBars
              emptyMessage={t('widget.superchargerHistory.noData', 'No Supercharger sessions')}
              emptyIcon={<Zap className="h-5 w-5" />}
            />
          </div>

          {/* Totals row */}
          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 px-1">
            <span className="text-xs text-[var(--text-secondary)]">
              {t('widget.superchargerHistory.totals', '30-day totals')}
            </span>
            <div className="flex items-center gap-3 text-sm font-semibold tabular-nums text-[var(--text-primary)]">
              <span>{formatEnergy(totalWh, { precision: 1 })}</span>
              <span>{formatCurrency(totalSpend)}</span>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.superchargerHistory.noData', 'No Supercharger sessions')}
          className="py-8"
        />
      )}
    </WidgetShell>
  );
}
