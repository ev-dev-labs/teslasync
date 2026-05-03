import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowUpDown, Filter, RefreshCw } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Badge, Button, Input, DataTable, type Column } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useSignalGaps } from '@/api/hooks/useTelemetry';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { SignalRow } from '@/types/telemetry';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SortMode = 'staleness' | 'alpha' | 'category';
type FilterMode = 'all' | 'stale' | 'active';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getStalenessColor(seconds: number, hasTimestamp: boolean) {
  if (!hasTimestamp) return { label: 'Never received', text: 'text-[var(--text-muted)]' };
  if (seconds < 30) return { label: 'Active', text: 'text-green-400' };
  if (seconds < 300) return { label: 'Aging', text: 'text-amber-400' };
  return { label: 'Stale', text: 'text-red-400' };
}

function formatStaleness(seconds: number): string {
  if (seconds < 60) return `${fmtInt(seconds)}s ago`;
  if (seconds < 3600) return `${fmtInt(seconds / 60)}m ago`;
  const h = Math.floor(seconds / 3600);
  const m = (seconds % 3600) / 60;
  return `${h}h ${fmtInt(m)}m ago`;
}

function statusVariant(row: SignalRow): 'success' | 'warning' | 'danger' | 'neutral' {
  if (!row.timestamp) return 'neutral';
  if (row.staleness < 30) return 'success';
  if (row.staleness < 300) return 'warning';
  return 'danger';
}

/* ------------------------------------------------------------------ */
/*  Table columns                                                      */
/* ------------------------------------------------------------------ */

function buildColumns(t: (k: string, d: string) => string): Column<SignalRow>[] {
  return [
    {
      key: 'status',
      header: t('signalGap.status', 'Status'),
      render: (signal) => {
        const style = getStalenessColor(signal.staleness, !!signal.timestamp);
        return <Badge variant={statusVariant(signal)} size="sm" dot>{style.label}</Badge>;
      },
    },
    {
      key: 'signal',
      header: t('signalGap.signal', 'Signal'),
      render: (signal) => <span className="font-mono text-[var(--text-primary)]">{signal.name}</span>,
    },
    {
      key: 'value',
      header: t('signalGap.lastValue', 'Last Value'),
      render: (signal) => <span className="font-mono text-[var(--text-secondary)] max-w-[200px] truncate block">{signal.value}</span>,
    },
    {
      key: 'lastUpdated',
      header: t('signalGap.lastUpdated', 'Last Updated'),
      render: (signal) => <span className="text-[var(--text-secondary)] whitespace-nowrap">{signal.timestamp ? formatDateTime(signal.timestamp) : '—'}</span>,
    },
    {
      key: 'timeSince',
      header: t('signalGap.timeSince', 'Time Since'),
      className: 'text-right',
      render: (signal) => {
        const style = getStalenessColor(signal.staleness, !!signal.timestamp);
        return <span className={cn('font-mono whitespace-nowrap', style.text)}>{signal.timestamp ? formatStaleness(signal.staleness) : '—'}</span>;
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SignalGapDetectorPage() {
  const { t } = useTranslation();
  usePageTitle(t('signalGap.title', 'Signal Gaps'));
  const vehicleId = 1;

  const [sortMode, setSortMode] = useState<SortMode>('staleness');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');

  const { data: liveData, isLoading, dataUpdatedAt } = useSignalGaps(vehicleId);

  const now = Date.now();

  const signals: SignalRow[] = useMemo(() => {
    if (!liveData) return [];
    return Object.entries(liveData).map(([name, entry]) => {
      const raw = entry && typeof entry === 'object' ? entry : { value: entry, timestamp: null };
      const ts = raw.timestamp ?? null;
      const staleness = ts ? (now - new Date(ts).getTime()) / 1000 : Infinity;
      const category: SignalRow['category'] = !ts ? 'never' : staleness > 300 ? 'stale' : 'active';
      return { name, value: raw.value != null ? String(raw.value) : '—', timestamp: ts, staleness, category };
    });
  }, [liveData, now]);

  const filtered = useMemo(() => {
    let list = signals;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    if (filterMode === 'stale') list = list.filter((s) => s.category === 'stale' || s.category === 'never');
    if (filterMode === 'active') list = list.filter((s) => s.category === 'active');
    list = [...list].sort((a, b) => {
      if (sortMode === 'staleness') return b.staleness - a.staleness;
      if (sortMode === 'alpha') return a.name.localeCompare(b.name);
      const order = { never: 0, stale: 1, active: 2 };
      return order[a.category] - order[b.category];
    });
    return list;
  }, [signals, search, filterMode, sortMode]);

  const activeCount = signals.filter((s) => s.category === 'active').length;
  const staleCount = signals.filter((s) => s.category === 'stale').length;
  const neverCount = signals.filter((s) => s.category === 'never').length;

  const gapColumns = useMemo(() => buildColumns(t), [t]);

  return (
    <PageContainer
      title={t('signalGap.title', 'Signal Gap Detector')}
      subtitle={t('signalGap.subtitle', 'Identify signals that have stopped arriving or have gaps')}
      actions={
        <span className="text-xs text-[var(--text-muted)]">
          <RefreshCw className="inline h-3 w-3 mr-1" />
          {t('signalGap.refreshInterval', 'Refreshes every 5s')}
        </span>
      }
    >
      {/* Summary Cards */}
      <FadeIn delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label={t('signalGap.totalSignals', 'Total Signals')} value={signals.length} icon={<ArrowUpDown className="h-4 w-4" />} />
          <StatCard label={t('signalGap.active', 'Active (<30s)')} value={activeCount} icon={<RefreshCw className="h-4 w-4" />} />
          <StatCard label={t('signalGap.stale', 'Stale (>5min)')} value={staleCount} icon={<AlertTriangle className="h-4 w-4" />} />
          <StatCard label={t('signalGap.neverReceived', 'Never Received')} value={neverCount} icon={<AlertTriangle className="h-4 w-4" />} />
        </div>
      </FadeIn>

      {/* Controls */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <Input
              type="text"
              placeholder={t('signalGap.filterPlaceholder', 'Filter by signal name...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('signalGap.filterLabel', 'Filter signals')}
              className="w-full sm:w-64"
            />
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              {(['all', 'stale', 'active'] as FilterMode[]).map((mode) => (
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
            <div className="flex items-center gap-2 sm:ml-auto">
              <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              {(['staleness', 'alpha', 'category'] as SortMode[]).map((mode) => (
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
        </GlassPanel>
      </FadeIn>

      {/* Signal Table */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : filtered.length > 0 ? (
            <DataTable<SignalRow>
              columns={gapColumns}
              data={filtered}
              keyExtractor={(signal) => signal.name}
              compact
              pagination
              className="max-h-[65vh] overflow-auto border border-[var(--border-subtle)]"
              emptyMessage={t('signalGap.noMatch', 'No signals match current filters')}
            />
          ) : (
            <p className="text-center py-12 text-[var(--text-muted)]">
              {signals.length === 0
                ? t('signalGap.noData', 'No signal data available')
                : t('signalGap.noMatch', 'No signals match current filters')}
            </p>
          )}

          {dataUpdatedAt > 0 && (
            <p className="mt-3 text-[10px] text-[var(--text-muted)] text-right">
              {t('signalGap.lastRefreshed', 'Last refreshed')}: {formatRelative(new Date(dataUpdatedAt))}
            </p>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
