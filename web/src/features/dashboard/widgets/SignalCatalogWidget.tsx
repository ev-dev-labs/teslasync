import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Input } from '@/components/ui';
import { combineDataStates, deriveDataState, knownNumber } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { useSignalCatalog, useSignalObservations } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
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

  const observationRows = Array.isArray(observations) ? observations : [];
  const sampleCounts = new Map<string, number>();
  const categories = new Map<string, { count: number; sampleCount: number | null }>();
  observationRows.forEach((row) => {
    const name = row.signal_name?.trim();
    if (name) sampleCounts.set(name, (sampleCounts.get(name) ?? 0) + 1);
  });
  entries.forEach((signal) => {
    const destination = signal.destination || 'unknown';
    const category = categories.get(destination) ?? { count: 0, sampleCount: null as number | null };
    category.count += 1;
    const total = knownNumber(signal.sample_count_total);
    category.sampleCount = total == null
      ? (category.sampleCount == null ? null : category.sampleCount)
      : (category.sampleCount ?? 0) + total;
    categories.set(destination, category);
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
              <ul className="m-0 list-none space-y-2 p-0" aria-label={t('widget.signalCatalog.signalsAvailable', 'Signals available')}>
                {Array.from(categories.entries())
                  .filter(([destination]) => filtered.some((signal) => (signal.destination || 'unknown') === destination))
                  .map(([destination, category]) => (
                    <li key={destination} className="min-w-0 rounded-panel border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2">
                      <h4 className="break-words text-sm font-medium text-[var(--text-primary)]">{destination}</h4>
                      {filtered.filter((signal) => (signal.destination || 'unknown') === destination).map((signal) => (
                        <p key={`${signal.destination}:${signal.field}`} className="mt-1 break-words text-xs text-[var(--text-muted)]">
                          {signal.field}
                        </p>
                      ))}
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        {t('widget.signalCatalog.categorySignals', '{{count}} signals', { count: category.count, replace: { count: fmtInt(category.count) } })}
                        {' · '}
                        {category.sampleCount == null
                          ? t('widget.signalCatalog.observationsUnavailable', 'Observations unavailable')
                          : t('widget.signalCatalog.categoryObservations', '{{count}} obs', { count: category.sampleCount, replace: { count: fmtInt(category.sampleCount) } })}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
