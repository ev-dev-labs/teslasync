import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import { Input, Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useSignalCatalog, useSignalObservations } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function SignalCatalogWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: catalog,
    isLoading: catalogLoading,
    isFetching: catalogFetching,
    isStale: catalogStale,
    isError: catalogError,
    dataUpdatedAt: catalogUpdatedAt,
    refetch: refetchCatalog,
  } = useSignalCatalog();

  const { data: observations } = useSignalObservations(id);

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
        s.name.toLowerCase().includes(q) ||
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
      title={isCompact ? undefined : t('widget.signalCatalog.title', 'Signal Catalog')}
      icon={<BookOpen className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={catalogLoading}
      updatedAt={catalogUpdatedAt}
      isFetching={catalogFetching}
      isStale={catalogStale}
      isError={catalogError}
      onRefresh={() => refetchCatalog()}
    >
      {entries.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-5 w-5" />}
          message={t('widget.signalCatalog.noData', 'No signals in catalog')}
          className="py-4"
        />
      ) : isCompact ? (
        /* ── Compact layout (1-col) ── */
        <div className="flex flex-col items-center justify-center gap-1 h-full min-h-[44px]">
          <span className="text-2xl font-bold text-[var(--text-primary)]">
            {fmtInt(entries.length)}
          </span>
          <span className="text-xs text-[var(--text-secondary)]">
            {t('widget.signalCatalog.signalsAvailable', 'signals available')}
          </span>
        </div>
      ) : (
        /* ── Standard / Wide layout ── */
        <div className="flex flex-col gap-2 h-full min-h-0">
          <Input
            placeholder={t('widget.signalCatalog.searchPlaceholder', 'Search signals…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-[44px]"
          />

          {filtered.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-5 w-5" />}
              message={t('widget.signalCatalog.noResults', 'No matching signals')}
              className="py-4"
            />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
              {grouped.map(([category, signals]) => (
                <div key={category}>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1 sticky top-0 bg-white/[0.03] backdrop-blur-sm py-1 px-1 -mx-1 rounded">
                    {category}
                    <span className="ml-1 text-[var(--text-muted)]">({signals.length})</span>
                  </h4>
                  <div className="space-y-0.5">
                    {signals.map((sig) => (
                      <div
                        key={sig.name}
                        className="flex items-center gap-2 min-h-[32px] px-1 rounded hover:bg-white/[0.04] transition-colors"
                      >
                        <span className="text-xs font-mono text-[var(--text-primary)] truncate flex-1 min-w-0">
                          {sig.name}
                        </span>
                        {sig.unit && (
                          <Badge variant="neutral" className="text-[10px] shrink-0">
                            {sig.unit}
                          </Badge>
                        )}
                        <span className="text-[10px] text-[var(--text-muted)] tabular-nums shrink-0 min-w-[36px] text-right">
                          {fmtInt(observationCounts.get(sig.name) ?? 0)}
                        </span>
                      </div>
                    ))}
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
