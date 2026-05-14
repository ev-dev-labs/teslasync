/**
 * SignalCatalogPanel — staleness-aware catalog browser for vehicle signals.
 *
 * Wraps `useSignalGaps` plus the search / filter / sort UI that used to live
 * in `SignalGapDetectorPage`. When `selection` is provided it adds a
 * checkbox column so callers can drive a chip-selection workflow (used by
 * `SignalsWorkspacePage`'s left rail).
 *
 * Used by:
 *   - SignalGapDetectorPage  (read-only catalog)
 *   - SignalsWorkspacePage   (selection-enabled catalog)
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowUpDown, Filter, Plus, RefreshCw, X } from 'lucide-react';

import { GlassPanel, Badge, Button, Input, DataTable, type Column } from '@/components/ui';
import { StatCard, TimeStamp } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useSignalGaps } from '@/api/hooks/useTelemetry';
import { fmtInt } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { SignalRow } from '@/types/telemetry';

export type CatalogFilterMode = 'all' | 'stale' | 'active';
export type CatalogSortMode = 'staleness' | 'alpha' | 'category';

export interface SignalCatalogSelectionProps {
  selectedSignals: string[];
  onToggle: (signal: string) => void;
  /** Maximum signals that can be selected. Disables further toggles when reached. */
  max?: number;
}

export interface SignalCatalogPanelProps {
  vehicleId: number;
  /** Optional override title. */
  title?: string;
  /** Show the 4 summary StatCards at the top. Default true. */
  showSummary?: boolean;
  /** Optional selection state. Adds a checkbox column when provided. */
  selection?: SignalCatalogSelectionProps;
  /** Optional className applied to the wrapping GlassPanel. */
  className?: string;
  /** Slot rendered next to the title (e.g. extra actions). */
  headerExtra?: ReactNode;
  /** Override max-height of the table viewport. Default 60vh. */
  tableMaxHeight?: string;
}

export function getCatalogStalenessStyle(seconds: number, hasTimestamp: boolean) {
  if (!hasTimestamp) return { label: 'Never received', text: 'text-[var(--text-muted)]', variant: 'neutral' as const };
  if (seconds < 30)  return { label: 'Active',         text: 'text-green-400',           variant: 'success' as const };
  if (seconds < 300) return { label: 'Aging',          text: 'text-amber-400',           variant: 'warning' as const };
  return                       { label: 'Stale',          text: 'text-red-400',             variant: 'danger'  as const };
}

export function formatStaleness(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60)   return `${fmtInt(seconds)}s ago`;
  if (seconds < 3600) return `${fmtInt(seconds / 60)}m ago`;
  const h = Math.floor(seconds / 3600);
  const m = (seconds % 3600) / 60;
  return `${h}h ${fmtInt(m)}m ago`;
}

export function SignalCatalogPanel({
  vehicleId,
  title,
  showSummary = true,
  selection,
  className,
  headerExtra,
  tableMaxHeight = '60vh',
}: SignalCatalogPanelProps) {
  const { t } = useTranslation();
  const { data: liveData, isLoading, dataUpdatedAt } = useSignalGaps(vehicleId);

  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<CatalogFilterMode>('all');
  const [sortMode, setSortMode] = useState<CatalogSortMode>('staleness');

  const now = Date.now();
  const signals: SignalRow[] = useMemo(() => {
    if (!liveData) return [];
    return Object.entries(liveData).map(([name, entry]) => {
      const raw = entry && typeof entry === 'object' ? entry : { value: entry, timestamp: null };
      const ts = (raw as { timestamp?: string | null }).timestamp ?? null;
      const staleness = ts ? (now - new Date(ts).getTime()) / 1000 : Infinity;
      const category: SignalRow['category'] = !ts ? 'never' : staleness > 300 ? 'stale' : 'active';
      const value = (raw as { value?: unknown }).value;
      return {
        name,
        value: value != null ? String(value) : '—',
        timestamp: ts,
        staleness,
        category,
      };
    });
  }, [liveData, now]);

  const filtered = useMemo(() => {
    let list = signals;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    if (filterMode === 'stale')  list = list.filter((s) => s.category === 'stale' || s.category === 'never');
    if (filterMode === 'active') list = list.filter((s) => s.category === 'active');
    list = [...list].sort((a, b) => {
      if (sortMode === 'staleness') return b.staleness - a.staleness;
      if (sortMode === 'alpha')     return a.name.localeCompare(b.name);
      const order = { never: 0, stale: 1, active: 2 } as const;
      return order[a.category] - order[b.category];
    });
    return list;
  }, [signals, search, filterMode, sortMode]);

  const activeCount = signals.filter((s) => s.category === 'active').length;
  const staleCount  = signals.filter((s) => s.category === 'stale').length;
  const neverCount  = signals.filter((s) => s.category === 'never').length;

  const selectedSet = useMemo(() => new Set(selection?.selectedSignals ?? []), [selection?.selectedSignals]);
  const selectionMax = selection?.max;

  const columns: Column<SignalRow>[] = useMemo(() => {
    const cols: Column<SignalRow>[] = [];
    if (selection) {
      cols.push({
        key: 'select',
        header: '',
        className: 'w-8',
        render: (s) => {
          const checked = selectedSet.has(s.name);
          const disabled = !checked && selectionMax != null && (selection.selectedSignals.length >= selectionMax);
          return (
            <button
              type="button"
              aria-label={checked
                ? t('signalCatalog.removeSignal', { defaultValue: 'Remove {{name}} from selection', name: s.name })
                : t('signalCatalog.addSignal',    { defaultValue: 'Add {{name}} to selection',      name: s.name })}
              onClick={(e) => { e.stopPropagation(); selection.onToggle(s.name); }}
              disabled={disabled}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded border transition-colors',
                checked
                  ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-300'
                  : disabled
                    ? 'border-white/[0.04] bg-white/[0.02] text-[var(--text-muted)] opacity-40 cursor-not-allowed'
                    : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)] hover:border-cyan-400/40 hover:text-cyan-300',
              )}
            >
              {checked ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            </button>
          );
        },
      });
    }
    cols.push(
      {
        key: 'status',
        header: t('signalGap.status', 'Status'),
        className: 'w-24',
        render: (signal) => {
          const style = getCatalogStalenessStyle(signal.staleness, !!signal.timestamp);
          return <Badge variant={style.variant} size="sm" dot>{style.label}</Badge>;
        },
      },
      {
        key: 'signal',
        header: t('signalGap.signal', 'Signal'),
        render: (signal) => <span className="font-mono text-xs text-[var(--text-primary)]">{signal.name}</span>,
        visibleOnMobile: true,
      },
      {
        key: 'value',
        header: t('signalGap.lastValue', 'Last Value'),
        render: (signal) => <span className="font-mono text-xs text-[var(--text-secondary)] max-w-[200px] truncate block">{signal.value}</span>,
      },
      {
        key: 'lastUpdated',
        header: t('signalGap.lastUpdated', 'Last Updated'),
        render: (signal) => <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">{signal.timestamp ? formatDateTime(signal.timestamp) : '—'}</span>,
      },
      {
        key: 'timeSince',
        header: t('signalGap.timeSince', 'Time Since'),
        className: 'text-right',
        render: (signal) => {
          const style = getCatalogStalenessStyle(signal.staleness, !!signal.timestamp);
          return <span className={cn('font-mono text-xs whitespace-nowrap', style.text)}>{signal.timestamp ? formatStaleness(signal.staleness) : '—'}</span>;
        },
      },
    );
    return cols;
  }, [selection, selectedSet, selectionMax, t]);

  return (
    <div className={cn('space-y-4', className)}>
      {showSummary ? (
        <FadeIn delay={0.05}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <StatCard label={t('signalGap.totalSignals',  'Total Signals')}     value={signals.length} icon={<ArrowUpDown className="h-4 w-4" />} />
            <StatCard label={t('signalGap.active',        'Active (<30s)')}     value={activeCount}    icon={<RefreshCw className="h-4 w-4" />} />
            <StatCard label={t('signalGap.stale',         'Stale (>5min)')}     value={staleCount}     icon={<AlertTriangle className="h-4 w-4" />} />
            <StatCard label={t('signalGap.neverReceived', 'Never Received')}    value={neverCount}     icon={<AlertTriangle className="h-4 w-4" />} />
          </div>
        </FadeIn>
      ) : null}

      <GlassPanel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {title ? <span className="section-title">{title}</span> : null}
          <span className="ml-auto flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
            {headerExtra}
            <RefreshCw className="inline h-3 w-3" />
            {t('signalGap.refreshInterval', 'Refreshes every 5s')}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Input
            type="text"
            placeholder={t('signalGap.filterPlaceholder', 'Filter by signal name...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('signalGap.filterLabel', 'Filter signals')}
            className="w-full sm:w-64"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            {(['all', 'stale', 'active'] as CatalogFilterMode[]).map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                size="sm"
                onClick={() => setFilterMode(mode)}
                className={cn(
                  'border',
                  filterMode === mode
                    ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                    : 'text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]',
                )}
              >
                {mode === 'all' ? t('signalGap.all', 'All') : mode === 'stale' ? t('signalGap.staleOnly', 'Stale Only') : t('signalGap.activeOnly', 'Active Only')}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            {(['staleness', 'alpha', 'category'] as CatalogSortMode[]).map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                size="sm"
                onClick={() => setSortMode(mode)}
                className={cn(
                  'border',
                  sortMode === mode
                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                    : 'text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]',
                )}
              >
                {mode === 'staleness' ? t('signalGap.mostStale', 'Most Stale') : mode === 'alpha' ? t('signalGap.az', 'A-Z') : t('signalGap.category', 'Category')}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : filtered.length > 0 ? (
            <div className="overflow-auto rounded border border-[var(--border-subtle)]" style={{ maxHeight: tableMaxHeight }}>
              <DataTable<SignalRow>
                tableId="telemetry:signal-catalog"
                columns={columns}
                data={filtered}
                keyExtractor={(signal) => signal.name}
                compact
                pagination={{ defaultPageSize: 50 }}
                emptyMessage={t('signalGap.noMatch', 'No signals match current filters')}
              />
            </div>
          ) : (
            <p className="text-center py-12 text-[var(--text-muted)]">
              {signals.length === 0
                ? t('signalGap.noData', 'No signal data available')
                : t('signalGap.noMatch', 'No signals match current filters')}
            </p>
          )}

          {dataUpdatedAt > 0 && (
            <p className="mt-3 text-[10px] text-[var(--text-muted)] text-right">
              {t('signalGap.lastRefreshed', 'Last refreshed')}: <TimeStamp value={new Date(dataUpdatedAt)} format="relative" />
            </p>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}
