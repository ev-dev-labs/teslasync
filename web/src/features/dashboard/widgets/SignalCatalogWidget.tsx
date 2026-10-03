import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import { Input, Badge, Caption, Subhead, Text } from '@/components/ui';
import { combineDataStates, deriveDataState } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { useSignalCatalog, useSignalObservations } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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

  const entries = catalog ?? [];

  const observationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const obs of observations ?? []) {
      counts.set(obs.signal_name, (counts.get(obs.signal_name) ?? 0) + 1);
    }
    return counts;
  }, [observations]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (s) =>
        (s.name ?? '').toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.source_module ?? '').toLowerCase().includes(q),
    );
  }, [entries, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const entry of filtered) {
      const cat = entry.source_module || t('widget.signalCatalog.uncategorized', 'Uncategorized');
      const list = map.get(cat) ?? [];
      list.push(entry);
      map.set(cat, list);
    }
    // Sort categories alphabetically
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, t]);

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
              {grouped.map(([category, signals]) => (
                <div key={category}>
                  <Subhead className="mb-1 sticky top-0 bg-[var(--surface-2)] py-1 px-1 rounded-shape-sm">
                    {category}
                    <span className="ml-1 text-[var(--text-muted)]">({signals.length})</span>
                  </Subhead>
                  <div className="space-y-0.5">
                    {signals.map((sig, i) => {
                      const name = sig.name ?? '';
                      return (
                        <div
                          key={name || `${category}-${i}`}
                          className="flex items-center gap-2 min-h-11 px-1 rounded-shape-sm hover:bg-[var(--surface-2)] transition-colors"
                          title={sig.description ?? undefined}
                        >
                          <Text variant="bodySm" className="font-mono truncate flex-1 min-w-0">
                            {name || '—'}
                          </Text>
                          {sig.unit && (
                            <Badge variant="neutral" className="text-2xs shrink-0">
                              {sig.unit}
                            </Badge>
                          )}
                          <Caption className="tabular-nums shrink-0 min-w-9 text-right" title={t('widget.signalCatalog.sampleCount', 'Observations in fetched sample')}>
                            {observations == null ? '—' : fmtInt(observationCounts.get(name) ?? 0)}
                          </Caption>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
