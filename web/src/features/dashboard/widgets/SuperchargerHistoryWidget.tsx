import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useTeslaChargingHistory } from '@/api/hooks/useCharging';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetRankedList, type RankedItem } from './shared';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';

export default function SuperchargerHistoryWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatCurrency } = useSettings();

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
      .sort((a, b) => new Date(b.charge_start_datetime).getTime() - new Date(a.charge_start_datetime).getTime())
      .slice(0, 10);

    return sorted.map((entry) => {
      const kwh = entry.usage_kwh ?? 0;
      const cost = entry.total_due ?? 0;
      return {
        id: entry.id,
        label: entry.site_location_name ?? '—',
        value: kwh,
        formattedValue: `${fmtNumber(kwh, 1)} kWh`,
        badge: cost > 0
          ? { text: formatCurrency(cost), variant: 'neutral' as const }
          : undefined,
        barColor: 'bg-yellow-400',
      };
    });
  }, [entries, formatCurrency]);

  const totalKwh = summary?.total_kwh ?? 0;
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
              <span>{fmtNumber(totalKwh, 1)} kWh</span>
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
