import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Input } from '@/components/ui';
import { combineDataStates, deriveDataState } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { useSignalCatalog, useSignalObservations } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetDetailCard, type DetailEntry } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { sourceBoundaryState } from '../components/continuation-dashboard-1/sourceBoundary';

export default function SignalCatalogWidget({ vehicleId, size }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const catalogQuery = useSignalCatalog();
  const {
    data: catalog,
    isLoading: catalogLoading,
    isFetching: catalogFetching,
    isStale: catalogStale,
    isError: catalogError,
    dataUpdatedAt: catalogUpdatedAt,
    refetch: refetchCatalog,
  } = catalogQuery;
  const catalogState = deriveDataState({ ...catalogQuery, data: catalog ?? (catalogLoading || catalogQuery.isError || catalogQuery.error ? undefined : null) });

  const observationQuery = useSignalObservations(id);
  const { data: observations } = observationQuery;
  const observationState = deriveDataState({
    ...observationQuery,
    data: observations ?? (observationQuery.isLoading || observationQuery.isError || observationQuery.error ? undefined : null),
  });
  const combined = combineDataStates([catalogState, observationState]);
  const state = {
    ...catalogState,
    ...combined,
    // The feed sample cannot replace or recover the catalog itself.
    fatalError: catalogState.fatalError,
    status: catalogState.fatalError || catalogState.status === 'initial' ? catalogState.status : combined.status,
  };

  const [search, setSearch] = useState('');
  const isCompact = size.cols <= 1;

  const entries = useMemo(() => catalog?.signals ?? [], [catalog]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (s) =>
        s.field.toLowerCase().includes(q) ||
        s.destination.toLowerCase().includes(q) ||
        s.value_kind.toLowerCase().includes(q),
    );
  }, [entries, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const entry of filtered) {
      const cat = entry.destination;
      const list = map.get(cat) ?? [];
      list.push(entry);
      map.set(cat, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const categoryEntries: DetailEntry[] = grouped.map(([category, signals]) => {
    const totals = signals.map((signal) => signal.sample_count_total);
    const allTotalsKnown = totals.length > 0 && totals.every((count) => count != null);
    const observationTotal = allTotalsKnown
      ? totals.reduce<number>((sum, count) => sum + (count ?? 0), 0)
      : null;
    const countLabel = t('widget.signalCatalog.categorySignals', '{{count}} signals', {
      count: signals.length,
      replace: { count: fmtInt(signals.length) },
    });
    const observationLabel = observationTotal == null
      ? t('widget.signalCatalog.observationsUnknown', 'Observations unavailable')
      : t('widget.signalCatalog.categoryObservations', '{{count}} obs', {
          count: observationTotal,
          replace: { count: fmtInt(observationTotal) },
        });
    return {
      id: category,
      label: category,
      value: countLabel,
      hint: observationLabel,
    };
  });

  const browseLabel = t('widget.signalCatalog.browse', 'Browse');

  return (
    <WidgetShell
      title={t('widget.signalCatalog.title', 'Signal catalog')}
      icon={<BookOpen className="h-3.5 w-3.5" />}
      loading={catalogLoading}
      dataState={state}
      updatedAt={catalogUpdatedAt}
      isFetching={catalogFetching || observationQuery.isFetching}
      isStale={catalogStale || observationQuery.isStale}
      isError={catalogError || observationQuery.isError}
      onRefresh={() => { void refetchCatalog(); void observationQuery.refetch?.(); }}
      footer={entries.length > 0 ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-muted)]">
            {t('widget.signalCatalog.catalogTotal', '{{count}} signals', {
              count: entries.length,
              replace: { count: fmtInt(entries.length) },
            })}
          </span>
          <Link
            to="/signals"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline"
          >
            {browseLabel}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      ) : undefined}
    >
      {entries.length === 0 && isCompact && (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<BookOpen className="h-5 w-5" />}
          message={t('widget.signalCatalog.noData', 'No signals in catalog')}
          className="py-4"
        />
      )}
      {isCompact ? (
        /* ── Compact layout (1-col) ── */
        <WidgetBigNumber value={catalog == null ? null : fmtInt(entries.length)} label={t('widget.signalCatalog.signalsAvailable', 'Signals available')} />
      ) : (
        /* ── Standard / Wide layout ── */
        <div className="flex flex-col gap-2 h-full min-h-0">
          <Input
            aria-label={t('widget.signalCatalog.searchLabel', 'Search signals')}
            placeholder={t('widget.signalCatalog.searchPlaceholder', 'Search signals…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-[44px]"
          />
          {observations == null || observationState.refreshError || observationState.isRefreshBlocked ? (
            <SourceContent
              state={sourceBoundaryState(observationState, observations != null)}
              label={t('widget.signalCatalog.sampleCount', 'Observations in fetched sample')}
              emptyMessage={t('widget.signalCatalog.observationsUnavailable', 'Signal observations unavailable')}
              errorMessage={t('widget.signalCatalog.observationsUnavailable', 'Signal observations unavailable')}
              error={observationState.fatalError}
              retainedMessage={t('widget.signalCatalog.observationsRetained', 'Previously loaded signal observations remain visible while this source recovers.')}
              errorRecovery={{ onRetry: () => { void observationQuery.refetch(); } }}
            >
              {null}
            </SourceContent>
          ) : null}

          {filtered.length === 0 ? (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<BookOpen className="h-5 w-5" />}
              message={entries.length === 0 && !search.trim()
                ? t('widget.signalCatalog.noData', 'No signals in catalog')
                : t('widget.signalCatalog.noResults', 'No matching signals')}
              className="py-4"
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
              <WidgetDetailCard
                entries={categoryEntries}
                compact={isCompact}
                emptyMessage={filtered.length === 0
                  ? t('widget.signalCatalog.noResults', 'No matching signals')
                  : t('widget.signalCatalog.noData', 'No signals in catalog')}
                emptyIcon={<BookOpen className="h-5 w-5" />}
              />
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
