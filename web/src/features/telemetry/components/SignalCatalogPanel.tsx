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
import { ArrowUpDown, Filter, Plus, RefreshCw, X } from 'lucide-react';

import { GlassPanel, Badge, Button, Input, DataTable, Text, Code, SectionTitle, type Column } from '@/components/ui';
import { TimeStamp, type StatMetric } from '@/components/data-display';
import { TelemetrySummaryBrief } from './operationalbrief-all/TelemetrySummaryBrief';
import { Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { PillFilterBar } from '@/components/forms';
import { FadeIn } from '@/components/motion';
import { useSignalGaps } from '@/api/hooks/useTelemetry';
import { fmtInt } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { SignalRow } from '@/types/telemetry';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';

type CatalogRow = SignalRow & { rawValue: string | number | boolean | null };

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
  /** Show the compact four-metric OperationalBrief. Default true. */
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
  if (!hasTimestamp) return { key: 'never'  as const, label: 'Never received', text: 'text-[var(--text-muted)]', variant: 'neutral' as const };
  if (seconds < 30)  return { key: 'active' as const, label: 'Active',         text: 'text-green-400',           variant: 'success' as const };
  if (seconds < 300) return { key: 'aging'  as const, label: 'Aging',          text: 'text-amber-400',           variant: 'warning' as const };
  return                     { key: 'stale'  as const, label: 'Stale',          text: 'text-red-400',             variant: 'danger'  as const };
}

export function formatStaleness(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  // Floor consistently and clamp clock-skew negatives so we never emit a
  // rounding overflow like "60m ago" or "1h 60m ago" (fmtInt used to round
  // 59.98 → 60), and never a nonsensical "-3s ago" for future timestamps.
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60)   return `${fmtInt(s)}s ago`;
  if (s < 3600) return `${fmtInt(Math.floor(s / 60))}m ago`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
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
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  const query = useSignalGaps(vehicleId);
  const { data: liveData, isLoading, dataUpdatedAt } = query;
  const sourceState = useDataState(query, { provenance: 'live' });
  const unavailable = sourceState.fatalError != null || (isLoading && !sourceState.hasData);

  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<CatalogFilterMode>('all');
  const [sortMode, setSortMode] = useState<CatalogSortMode>('staleness');

  const now = Date.now();
  const signals: CatalogRow[] = useMemo(() => {
    if (!liveData) return [];
    return Object.entries(liveData).map(([name, entry]) => {
      const raw = entry && typeof entry === 'object' ? entry : { value: entry, timestamp: null };
      const ts = (raw as { timestamp?: string | null }).timestamp ?? null;
      // An unparseable timestamp string used to slip through as a bogus
      // "active" row (NaN staleness). Treat it as "never received" so the
      // badge, the KPI counts, and the "Last Updated" cell all stay consistent.
      const parsedMs = ts ? new Date(ts).getTime() : NaN;
      const hasValidTs = Number.isFinite(parsedMs);
      const staleness = hasValidTs ? (now - parsedMs) / 1000 : Infinity;
      const category: SignalRow['category'] = !hasValidTs ? 'never' : staleness > 300 ? 'stale' : 'active';
      const value = (raw as { value?: unknown }).value;
      return {
        name,
        value: value != null ? String(value) : '—',
        rawValue: value == null ? null : typeof value === 'number' || typeof value === 'boolean' ? value : String(value),
        timestamp: hasValidTs ? ts : null,
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
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'total', rawValue: unavailable || vehicleId <= 0 ? null : signals.length,
      label: t('signalGap.totalSignals', 'Total signals'),
      description: t('telemetry.brief.catalogScope', 'Whole queried catalog before search and table filters; not the selected-signal count.') },
    { metricId: 'count', occurrenceId: 'active', rawValue: unavailable || vehicleId <= 0 ? null : activeCount,
      label: t('signalGap.active', 'Active (<30s)'),
      description: t('telemetry.brief.catalogActiveDefinition', 'Existing catalog active category includes valid timestamps up to five minutes old; the separate status badge still distinguishes active from aging.') },
    { metricId: 'count', occurrenceId: 'stale', rawValue: unavailable || vehicleId <= 0 ? null : staleCount,
      label: t('signalGap.stale', 'Stale (>5min)'),
      description: t('telemetry.brief.gapDescription', 'Timestamp age buckets from the current signal query; a sleeping vehicle can be stale without being unhealthy.') },
    { metricId: 'count', occurrenceId: 'never', rawValue: unavailable || vehicleId <= 0 ? null : neverCount,
      label: t('signalGap.neverReceived', 'Never received'),
      description: t('telemetry.brief.catalogNever', 'Entries without a valid reported timestamp, including malformed timestamps; not a health verdict.') },
  ];

  const selectedSet = useMemo(() => new Set(selection?.selectedSignals ?? []), [selection?.selectedSignals]);
  const selectionMax = selection?.max;

  const columns: Column<CatalogRow>[] = useMemo(() => {
    const cols: Column<CatalogRow>[] = [];
    if (selection) {
      cols.push({
        key: 'select',
        header: '',
        className: 'w-8',
        render: (s) => {
          const checked = selectedSet.has(s.name);
          const disabled = !checked && selectionMax != null && (selection.selectedSignals.length >= selectionMax);
          return (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={checked
                ? t('signalCatalog.removeSignal', { defaultValue: 'Remove {{name}} from selection', name: s.name })
                : t('signalCatalog.addSignal',    { defaultValue: 'Add {{name}} to selection',      name: s.name })}
              onClick={(e) => { e.stopPropagation(); selection.onToggle(s.name); }}
              disabled={disabled}
              className={cn(
                'touch-target rounded border p-0',
                checked
                  ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-300'
                  : disabled
                    ? 'border-white/[0.04] bg-white/[0.02] text-[var(--text-muted)] opacity-40 cursor-not-allowed'
                    : 'border-white/[0.06] bg-white/[0.02] text-[var(--text-muted)] hover:border-cyan-400/40 hover:text-cyan-300',
              )}
            >
              {checked ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            </Button>
          );
        },
      });
    }
    cols.push(
      {
        key: 'status',
        header: t('signalGap.status', 'Status'),
        filterValue: (signal) => getCatalogStalenessStyle(signal.staleness, !!signal.timestamp).key,
        filterValueLabel: (_value, signal) => {
          const style = getCatalogStalenessStyle(signal.staleness, !!signal.timestamp);
          return t(`signalCatalog.staleness.${style.key}`, style.label);
        },
        className: 'w-24',
        render: (signal) => {
          const style = getCatalogStalenessStyle(signal.staleness, !!signal.timestamp);
          return <Badge variant={style.variant} size="sm" dot>{t(`signalCatalog.staleness.${style.key}`, style.label)}</Badge>;
        },
      },
      {
        key: 'signal',
        header: t('signalGap.signal', 'Signal'),
        filterValue: (signal) => signal.name,
        render: (signal) => <Code>{signal.name}</Code>,
        visibleOnMobile: true,
      },
      {
        key: 'value',
        header: t('signalGap.lastValue', 'Last value'),
        filterValue: (signal) => signal.rawValue,
        filterValueLabel: (_value, signal) => signal.value,
        render: (signal) => <Text mono variant="caption" color="secondary" className="block max-w-full whitespace-pre-wrap break-words">{signal.value}</Text>,
      },
      {
        key: 'lastUpdated',
        header: t('signalGap.lastUpdated', 'Last updated'),
        render: (signal) => <Text variant="bodySm" className="whitespace-nowrap">{signal.timestamp ? formatDateTime(signal.timestamp) : '—'}</Text>,
      },
      {
        key: 'timeSince',
        header: t('signalGap.timeSince', 'Time since'),
        align: 'right',
        className: 'text-right',
        render: (signal) => {
          const style = getCatalogStalenessStyle(signal.staleness, !!signal.timestamp);
          return <Text mono size="xs" className={cn('whitespace-nowrap', style.text)}>{signal.timestamp ? formatStaleness(signal.staleness) : '—'}</Text>;
        },
      },
    );
    return cols;
  }, [selection, selectedSet, selectionMax, t, displayPrecision, displayLocale]);

  return (
    <div className={cn('min-w-0 max-w-full space-y-4', className)}>
      {showSummary ? (
        <FadeIn delay={0.05}>
          <TelemetrySummaryBrief title={t('telemetry.brief.catalogTitle', 'Catalog timestamp summary')}
            metrics={metrics} testId="signal-catalog-summary"
            unavailable={sourceState.fatalError != null} unknown={vehicleId <= 0} sourceStatus={sourceState.status}
            loading={isLoading && !sourceState.hasData}
            retained={sourceState.hasData && (sourceState.isRefreshing || sourceState.status === 'stale' || sourceState.refreshError != null)}
            scope={t('telemetry.brief.catalogScope', 'Whole queried catalog before search and table filters; not the selected-signal count.')}
            provenance={t('telemetry.brief.gapProvenance', 'Current signal values and their reported timestamps')}
            description={t('telemetry.brief.gapDescription', 'Timestamp age buckets from the current signal query; a sleeping vehicle can be stale without being unhealthy.')} />
        </FadeIn>
      ) : null}

      <GlassPanel className="min-w-0 max-w-full p-4 sm:p-5">
        <StaleRefreshWarning state={sourceState} label={t('signalGap.catalogTitle', 'Signal catalog')} />
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {title ? <SectionTitle>{title}</SectionTitle> : null}
          <Text as="span" size="2xs" color="muted" className="ml-auto flex items-center gap-2">
            {headerExtra}
            <RefreshCw className="inline h-3 w-3" aria-hidden="true" />
            {t('signalGap.refreshInterval', 'Refreshes every 5s')}
          </Text>
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
            <Filter className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
            <PillFilterBar
              semanticMode="filters"
              scrollable={false}
              className="flex-wrap"
              ariaLabel={t('signalGap.status', 'Status')}
              activeKey={filterMode}
              onChange={(key) => {
                if (key === 'all' || key === 'stale' || key === 'active') setFilterMode(key);
              }}
              items={[
                { key: 'all', label: t('signalGap.all', 'All') },
                { key: 'stale', label: t('signalGap.staleOnly', 'Stale only') },
                { key: 'active', label: t('signalGap.activeOnly', 'Active only') },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
            <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
            {(['staleness', 'alpha', 'category'] as CatalogSortMode[]).map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                size="sm"
                wrapLabel
                aria-pressed={sortMode === mode}
                onClick={() => setSortMode(mode)}
                className={cn(
                  'border',
                  sortMode === mode
                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                    : 'text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]',
                )}
              >
                {mode === 'staleness' ? t('signalGap.mostStale', 'Most stale') : mode === 'alpha' ? t('signalGap.az', 'A-Z') : t('signalGap.category', 'Category')}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <SourceContent
            state={sourceState.fatalError ? 'error' : 'ready'}
            label={t('signalGap.catalogTitle', 'Signal catalog')}
            error={sourceState.fatalError}
            errorMessage={t('error.loadFailed', 'Failed to load data')}
            emptyMessage={t('signalGap.noData', 'No signal data available')}
            errorRecovery={{ onRetry: sourceState.retry ?? undefined }}
          >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : filtered.length > 0 ? (
            <div className="overflow-auto rounded border border-[var(--border-subtle)]" style={{ maxHeight: tableMaxHeight }}>
              <DataTable<CatalogRow>
                tableId="telemetry:signal-catalog"
                enableValueFilters
                filterData={signals}
                columns={columns}
                data={filtered}
                keyExtractor={(signal) => signal.name}
                compact
                pagination={{ defaultPageSize: 50 }}
                emptyMessage={t('signalGap.noMatch', 'No signals match current filters')}
              />
            </div>
          ) : (
            <Text as="p" color="muted" className="py-12 text-center">
              {signals.length === 0
                ? t('signalGap.noData', 'No signal data available')
                : t('signalGap.noMatch', 'No signals match current filters')}
            </Text>
          )}
          </SourceContent>

          {dataUpdatedAt > 0 && (
            <Text as="p" variant="caption" color="muted" className="mt-3 text-end">
              {t('signalGap.lastRefreshed', 'Last refreshed')}: <TimeStamp value={new Date(dataUpdatedAt)} format="relative" />
            </Text>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}
