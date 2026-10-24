import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useTeslaChargingHistory } from '@/api/hooks/useCharging';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import { formatDuration } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetDetailCard, type DetailEntry } from './shared';
import type { WidgetProps } from './types';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';

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
  const { formatEnergy, unitPrefs } = useUnits();
  const { formatDateShort } = useDateFormat();

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

  const detailEntries: DetailEntry[] = useMemo(() => {
    const sorted = [...entries]
      .sort((a, b) => startTimeMs(b.charge_start_datetime) - startTimeMs(a.charge_start_datetime))
      .slice(0, 10);

    return sorted.map((entry) => {
      const wh = knownNumber(entry.usage_wh);
      const cost = knownNumber(entry.total_due);
      const startMs = startTimeMs(entry.charge_start_datetime);
      const stopMs = entry.charge_stop_datetime ? startTimeMs(entry.charge_stop_datetime) : 0;
      const durationS = startMs > 0 && stopMs >= startMs ? (stopMs - startMs) / 1000 : null;
      const date = startMs > 0 ? formatDateShort(entry.charge_start_datetime) : '—';
      const duration = durationS == null
        ? null
        : formatDuration(durationS, { ...unitPrefs, duration: 'min' }, { precision: 0 });

      return {
        id: entry.id,
        label: entry.site_location_name ?? '—',
        sublabel: duration == null ? date : `${date} · ${duration}`,
        value: wh == null ? '—' : formatEnergy(wh, { precision: 0 }),
        badge: cost != null
          ? { text: formatCurrency(cost), variant: 'neutral' as const }
          : undefined,
      };
    });
  }, [entries, formatCurrency, formatDateShort, formatEnergy, unitPrefs]);

  const totalSpend = knownNumber(summary?.total_spend);
  const totalSessions = knownNumber(summary?.total_sessions);

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
          <div role="group" aria-label={t('widget.superchargerHistory.compactLabel', '30-day Supercharger')}>
            <WidgetBigNumber
              value={totalSpend == null ? null : formatCurrency(totalSpend)}
              label={t('widget.superchargerHistory.compactLabel', '30-day Supercharger')}
            />
          </div>
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
      footer={entries.length > 0 ? (
        <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
          <span>
            {totalSessions != null && (
              <>
                {t('widget.chargeCost.sessions', '{{count}} sessions', { count: totalSessions })}
                {totalSpend != null && ' · '}
              </>
            )}
            {totalSpend == null ? '—' : formatCurrency(totalSpend)}
          </span>
        </div>
      ) : undefined}
    >
      {entries.length > 0 ? (
        <div className="flex flex-col gap-2 h-full">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <WidgetDetailCard
              entries={detailEntries}
              emptyMessage={t('widget.superchargerHistory.noData', 'No Supercharger sessions')}
              emptyIcon={<Zap className="h-5 w-5" />}
            />
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
