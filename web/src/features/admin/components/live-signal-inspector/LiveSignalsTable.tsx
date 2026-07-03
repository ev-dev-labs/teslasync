/**
 * Live Signal Inspector — snapshot table.
 *
 * Renders the flattened live snapshot as a filterable + sortable table. The
 * page owns the no-vehicle / loading / error / empty affordances (via
 * `LiveSectionState`) and passes an already-normalised, non-empty `rows`
 * array; this component only handles the name filter, sort, and per-row
 * rendering (typed value colours, kind badge, source-layer badge, freshness).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

import {
  DataTable,
  Input,
  Badge,
  useSortToggle,
  type Column,
} from '@/components/ui';
import { TimeStamp, SourceLayerBadge } from '@/components/data-display';

import {
  classifyKind,
  formatAge,
  KIND_LABELS,
  type KindCategory,
  type LiveSignalRow,
} from './liveSignalStats';

interface LiveSignalsTableProps {
  rows: LiveSignalRow[];
}

const KIND_BADGE: Record<
  KindCategory,
  'success' | 'info' | 'warning' | 'neutral' | 'danger'
> = {
  numeric: 'info',
  boolean: 'warning',
  text: 'neutral',
  enum: 'success',
  time: 'neutral',
  compound: 'danger',
  other: 'neutral',
};

/**
 * Coerce a signal value to a display string plus a toned-down syntax-highlight
 * colour (number → cyan, string → amber, boolean → purple). Objects are
 * JSON-stringified so a compound value never crashes the cell.
 */
function renderValue(v: unknown): { text: string; cls: string } {
  if (v === null) return { text: 'null', cls: 'text-[var(--text-muted)]' };
  if (v === undefined) return { text: '—', cls: 'text-[var(--text-muted)]' };
  const tx = typeof v;
  if (tx === 'number') return { text: String(v), cls: 'text-cyan-300' };
  if (tx === 'boolean') return { text: String(v), cls: 'text-purple-300' };
  if (tx === 'string') return { text: v as string, cls: 'text-amber-300' };
  try {
    return { text: JSON.stringify(v), cls: 'text-[var(--text-secondary)]' };
  } catch {
    return { text: '—', cls: 'text-[var(--text-muted)]' };
  }
}

export function LiveSignalsTable({ rows }: LiveSignalsTableProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const { sortKey, sortDir, onSort } = useSortToggle('name', 'asc');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'timestamp') {
        const at = a.timestamp ? Date.parse(a.timestamp) : 0;
        const bt = b.timestamp ? Date.parse(b.timestamp) : 0;
        return (at - bt) * dir;
      }
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const columns: Column<LiveSignalRow>[] = [
    {
      key: 'name',
      header: t('admin.liveSignals.cols.name', 'Signal'),
      sortable: true,
      visibleOnMobile: true,
      render: (row) => (
        <span className="font-mono text-sm text-[var(--text-primary)]">
          {row.name}
        </span>
      ),
    },
    {
      key: 'value',
      header: t('admin.liveSignals.cols.value', 'Value'),
      visibleOnMobile: true,
      render: (row) => {
        const { text, cls } = renderValue(row.value);
        return (
          <span className={`font-mono text-xs ${cls}`} title={text}>
            {text}
          </span>
        );
      },
    },
    {
      key: 'kind',
      header: t('admin.liveSignals.cols.kind', 'Kind'),
      render: (row) => {
        const category = classifyKind(row.kind, row.value);
        return (
          <Badge variant={KIND_BADGE[category]} size="sm">
            {t(KIND_LABELS[category].key, KIND_LABELS[category].fallback)}
          </Badge>
        );
      },
    },
    {
      key: 'source',
      header: t('admin.liveSignals.cols.source', 'Source'),
      render: (row) =>
        row.source ? (
          <SourceLayerBadge source={row.source} ageMs={row.ageMs} showLabel />
        ) : (
          <span className="text-xs text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: 'timestamp',
      header: t('admin.liveSignals.cols.timestamp', 'Last update'),
      sortable: true,
      render: (row) =>
        row.timestamp ? (
          <TimeStamp value={row.timestamp} format="relative" />
        ) : (
          <span className="text-xs tabular-nums text-[var(--text-muted)]">
            {formatAge(row.ageMs)}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
          aria-hidden="true"
        />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t(
            'admin.liveSignals.filterPlaceholder',
            'Filter signal names…',
          )}
          className="pl-9"
          aria-label={t('admin.liveSignals.filterAria', 'Filter signals')}
        />
      </div>

      <DataTable<LiveSignalRow>
        tableId="admin:live-signals"
        name="live-signals"
        columns={columns}
        data={sorted}
        keyExtractor={(row) => row.name}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
        emptyMessage={t(
          'admin.liveSignals.table.filtered',
          'No signals match this filter.',
        )}
        pagination={{ defaultPageSize: 50, pageSizeOptions: [25, 50, 100] }}
        mobileColumns={['name', 'value']}
      />
    </div>
  );
}
