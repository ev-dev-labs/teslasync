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
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { WidgetStatGrid } from './shared';

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

  const query = useTeslaChargingHistory();
  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;

  const entries = safeArray(data?.entries);
  const summary = data?.summary;
  const dataState = useDataState({
    ...query,
    data: data ?? (!isLoading && !query.isPending && !isError ? null : undefined),
  }, {
    provenance: 'historical', unavailable: entries.length === 0,
    partial: entries.length > 0 && (
      knownNumber(summary?.total_wh) == null
      || knownNumber(summary?.total_spend) == null
      || entries.some((entry) => knownNumber(entry.usage_wh) == null)
    ),
  });
  const isCompact = size.cols <= 1;

  const rankedItems: RankedItem[] = useMemo(() => {
    const sorted = [...entries]
      .sort((a, b) => startTimeMs(b.charge_start_datetime) - startTimeMs(a.charge_start_datetime))
      .slice(0, 10);

    return sorted.map((entry) => {
      const wh = knownNumber(entry.usage_wh);
      const cost = knownNumber(entry.total_due);
      return {
        id: entry.id,
        label: entry.site_location_name ?? '—',
        value: wh,
        formattedValue: wh == null ? '—' : formatEnergy(wh),
        badge: cost != null
          ? { text: formatCurrency(cost), variant: 'neutral' as const }
          : undefined,
        barColor: 'bg-[var(--text-secondary)]',
      };
    }).sort((a, b) => {
      if (a.value == null) return b.value == null ? 0 : 1;
      if (b.value == null) return -1;
      return b.value - a.value;
    });
  }, [entries, formatCurrency, formatEnergy]);

  const totalWh = knownNumber(summary?.total_wh);
  const totalSpend = knownNumber(summary?.total_spend);

  // Compact: show 30-day Supercharger spend as big number
  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.superchargerHistory.title', 'Supercharger history')}
        dataState={dataState}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        {entries.length > 0 ? (
          <WidgetBigNumber
            value={totalSpend == null ? null : formatCurrency(totalSpend)}
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
      title={t('widget.superchargerHistory.title', 'Supercharger history')}
      icon={<Zap className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      dataState={dataState}
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
              order="source"
              wrapContent
              maxItems={10}
              showBars={entries.every((entry) => knownNumber(entry.usage_wh) != null)}
              emptyMessage={t('widget.superchargerHistory.noData', 'No Supercharger sessions')}
              emptyIcon={<Zap className="h-5 w-5" />}
            />
          </div>

          {/* Totals row */}
          <div className="border-t border-[var(--border-subtle)] pt-2">
            <WidgetStatGrid stats={[
              { label: t('widget.superchargerHistory.totals', '30-day totals'), value: totalWh == null ? '—' : formatEnergy(totalWh) },
              { label: t('widget.superchargerHistory.compactLabel', '30-day Supercharger'), value: totalSpend == null ? '—' : formatCurrency(totalSpend) },
            ]} />
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
