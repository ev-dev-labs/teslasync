import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Caption, Input, Subhead, Text } from '@/components/ui';
import { combineDataStates, deriveDataState, knownNumber } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { useSignalCatalog, useSignalObservations } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
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
  observationRows.forEach((row) => {
    const name = row.signal_name?.trim();
    if (name) sampleCounts.set(name, (sampleCounts.get(name) ?? 0) + 1);
  });
  const categoryEntries = Array.from(
    filtered.reduce((groups, signal) => {
      const destination = signal.destination || 'unknown';
      const rows = groups.get(destination) ?? [];
      rows.push(signal);
      groups.set(destination, rows);
      return groups;
    }, new Map<string, typeof entries>()),
  );

  const browseLabel = t('widget.signalCatalog.browse', 'Browse');
  const signalCount = (
    <WidgetBigNumber
      value={catalog == null ? null : fmtInt(entries.length)}
      label={t('widget.signalCatalog.signalsAvailable', 'Signals available')}
    />
  );
  const compactEmpty = entries.length === 0 && (
    <EmptyState /* no-action: transient empty state — no specific recovery action available */
      icon={<BookOpen className="h-5 w-5" />}
      message={t('widget.signalCatalog.noData', 'No signals in catalog')}
      className="py-4"
    />
  );
  const searchControl = (
    <Input
      aria-label={t('widget.signalCatalog.searchLabel', 'Search signals')}
      placeholder={t('widget.signalCatalog.searchPlaceholder', 'Search signals…')}
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="min-h-[44px]"
    />
  );
  const observationNotice = (observations == null || observationState.refreshError || observationState.isRefreshBlocked) && (
    <SourceContent
      state={sourceBoundaryState(observationState, observations != null)}
      label={t('widget.signalCatalog.sampleCount', 'Observations in fetched sample')}
      emptyMessage={t('widget.signalCatalog.noObservations', 'No signal observations')}
      errorMessage={t('widget.signalCatalog.observationsUnavailable', 'Signal observations unavailable')}
      error={observationState.fatalError}
      retainedMessage={t('widget.signalCatalog.observationsRetained', 'Previously loaded signal observations remain visible while this source recovers.')}
      errorRecovery={{ onRetry: () => { void observationQuery.refetch(); } }}
    >
      {null}
    </SourceContent>
  );
  const metadataNotice = 'status' in catalogQuery && catalogQuery.status === 'success' && (
    <Caption as="p">
      {t('widget.signalCatalog.metadataUnavailable', 'Unit and description are not provided by this catalog.')}
    </Caption>
  );
  const catalogList = filtered.length === 0 ? (
    <EmptyState /* no-action: transient empty/filter state — edit the existing search control */
      icon={<BookOpen className="h-5 w-5" />}
      message={entries.length === 0 && !search.trim()
        ? t('widget.signalCatalog.noData', 'No signals in catalog')
        : t('widget.signalCatalog.noResults', 'No matching signals')}
      className="py-4"
    />
  ) : (
    <ul className="m-0 list-none space-y-2 p-0" aria-label={t('widget.signalCatalog.signalsAvailable', 'Signals available')}>
      {categoryEntries.map(([destination, signals]) => (
        <li key={destination} className="min-w-0 border-b border-[var(--border-subtle)] py-2 last:border-b-0">
          <Subhead
            aria-label={t('widget.signalCatalog.destination', 'Destination: {{destination}}', { destination })}
            className="break-words"
          >
            {destination}
          </Subhead>
          {signals.map((signal) => {
            const total = knownNumber(signal.sample_count_total);
            const vehicles = knownNumber(signal.vehicle_count);
            const fetchedCount = observations == null
              ? null
              : sampleCounts.get(signal.field) ?? 0;
            const lastSeen = signal.last_seen_at ?? null;
            return (
              <div key={`${signal.destination}:${signal.field}`} className="mt-3 min-w-0 border-t border-[var(--border-subtle)] pt-2 first:border-t-0 first:pt-0">
                <Text as="p" variant="label" className="break-words">{signal.field}</Text>
                <Caption as="p" className="mt-1 break-words">
                  {t('widget.signalCatalog.valueKind', 'Value kind')}: <span>{signal.value_kind}</span>
                </Caption>
                <Caption as="p" className="mt-1 flex flex-wrap gap-x-3">
                  <span
                    title={t('widget.signalCatalog.sampleCount', 'Observations in fetched sample')}
                    className="tabular-nums"
                  >
                    {fetchedCount == null ? '—' : fmtInt(fetchedCount)}
                  </span>
                  <span className="flex flex-wrap gap-x-3">
                    {t('widget.signalCatalog.totalSamples', 'Total observations: {{count}}', {
                      count: total ?? undefined,
                      replace: { count: total == null ? '—' : fmtInt(total) },
                    })}
                    {t('widget.signalCatalog.vehicleCount', 'Vehicles observed: {{count}}', {
                      count: vehicles ?? undefined,
                      replace: { count: vehicles == null ? '—' : fmtInt(vehicles) },
                    })}
                  </span>
                  <span>
                    {t('widget.signalCatalog.lastSeen', 'Last seen: {{timestamp}}', {
                      timestamp: lastSeen ?? '—',
                    })}
                  </span>
                </Caption>
              </div>
            );
          })}
          <Caption as="p" className="mt-2">
            <span>
              {t('widget.signalCatalog.categorySignals', '{{count}} signals', { count: signals.length, replace: { count: fmtInt(signals.length) } })}
            </span>
            {!observationState.fatalError && !observationState.refreshError && !observationState.isRefreshBlocked && (
              <>
                {' · '}
                <span>{(() => {
                  const totals = signals.map((signal) => knownNumber(signal.sample_count_total));
                  const categoryTotal = totals.some((total) => total == null)
                    ? null
                    : totals.reduce<number>((sum, total) => sum + (total ?? 0), 0);
                  return categoryTotal == null
                    ? t('widget.signalCatalog.categoryObservationsUnavailable', 'Observations unavailable')
                    : t('widget.signalCatalog.categoryObservations', '{{count}} obs', {
                        count: categoryTotal,
                        replace: { count: fmtInt(categoryTotal) },
                      });
                })()}</span>
              </>
            )}
          </Caption>
        </li>
      ))}
    </ul>
  );
  const listContent = (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
      {catalogList}
      {filtered.length > 0 && metadataNotice}
    </div>
  );
  const firstSignal = filtered[0];
  const headline = !isCompact && firstSignal ? (
    <div className="min-w-0">
      <Text as="p" variant="metricValue" mono className="break-words">{firstSignal.field}</Text>
      <Caption>{t('widget.signalCatalog.title', 'Signal catalog')}</Caption>
    </div>
  ) : signalCount;

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
          <Caption>
            {t('widget.signalCatalog.catalogTotal', '{{count}} signals', {
              count: entries.length,
              replace: { count: fmtInt(entries.length) },
            })}
          </Caption>
          <Link
            to="/signals"
            className="shrink-0 text-[var(--accent-primary)] hover:underline"
          >
            <Caption className="inline-flex items-center gap-1 text-inherit">
              {browseLabel}
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Caption>
          </Link>
        </div>
      ) : undefined}
    >
      <InstrumentPresentation
        family="list"
        compact={isCompact}
        headline={headline}
        icon={<BookOpen />}
        context={!isCompact ? (
          <div className="flex min-w-0 flex-col gap-2">
            {searchControl}
            {observationNotice}
          </div>
        ) : undefined}
        instrument={isCompact ? compactEmpty : listContent}
        details={<Caption as="p">{t('dashboardWidgets.telemetry.signalCatalog.definitionNote', 'Catalog definitions and actual observations are different things.')}</Caption>}
      >
        {isCompact ? (
          /* ── Compact layout (1-col) ── */
          <>
            {compactEmpty}
            {signalCount}
          </>
        ) : (
          /* ── Standard / Wide layout ── */
          <div className="flex flex-col gap-2 h-full min-h-0">
            {searchControl}
            {observationNotice}
            {listContent}
          </div>
        )}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
