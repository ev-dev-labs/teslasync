/**
 * Live Signal Inspector — table.
 *
 * Renders the current Redis-cached live snapshot for a single vehicle as
 * a sortable + filterable table. Refresh cadence is owned by the page
 * (1 s polling); this component just renders whatever rows are passed.
 *
 * Values arrive from the backend as `{ value: unknown; timestamp?: string }`
 * with `value` being string | number | boolean | object. The renderer
 * coerces objects to JSON for display so we never crash on a typed
 * compound value (e.g. location triple).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

import {
  DataTable,
  Input,
  useSortToggle,
  type Column,
} from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import type {
  VehicleLiveSignal,
  VehicleLiveSignalsResponse,
} from '@/api/hooks/useTelemetry';

interface LiveSignalsTableProps {
  data: VehicleLiveSignalsResponse | undefined;
  loading: boolean;
}

interface LiveSignalRow {
  name: string;
  value: unknown;
  timestamp?: string;
}

/**
 * Normalises a single entry of `data.signals` into a flat row. The
 * backend may return either `{ value, timestamp }` envelopes OR a bare
 * scalar (`true`, `42`, "Drive"), depending on which signal repo
 * shipped the row. Both shapes flow through unchanged into the table.
 */
function rowFromEntry(name: string, raw: unknown): LiveSignalRow {
  if (raw && typeof raw === 'object' && 'value' in (raw as VehicleLiveSignal)) {
    const env = raw as VehicleLiveSignal;
    return { name, value: env.value, timestamp: env.timestamp };
  }
  return { name, value: raw };
}

function renderValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  const tx = typeof v;
  if (tx === 'string') return v as string;
  if (tx === 'number' || tx === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '—';
  }
}

export function LiveSignalsTable({ data, loading }: LiveSignalsTableProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const { sortKey, sortDir, onSort } = useSortToggle('name', 'asc');

  const rows = useMemo<LiveSignalRow[]>(() => {
    const signals = data?.signals ?? {};
    return Object.keys(signals).map((name) => rowFromEntry(name, signals[name]));
  }, [data]);

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
        return (
          ((a.timestamp ? Date.parse(a.timestamp) : 0) -
            (b.timestamp ? Date.parse(b.timestamp) : 0)) *
          dir
        );
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
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {renderValue(row.value)}
        </span>
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
          <span className="text-xs text-[var(--text-muted)]">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('admin.liveSignals.filterPlaceholder', 'Filter signal names…')}
          className="pl-9"
          aria-label={t('admin.liveSignals.filterAria', 'Filter signals')}
        />
      </div>

      {!loading && rows.length === 0 ? (
        <EmptyState
          title={t('admin.liveSignals.empty.title', 'No live signals cached')}
          message={t(
            'admin.liveSignals.empty.message',
            'Redis has no live snapshot for this vehicle yet. Confirm the vehicle is online and publishing.',
          )}
          // no-action: the vehicle picker above is the only meaningful CTA.
        />
      ) : (
        <DataTable<LiveSignalRow>
          tableId="admin:live-signals"
          name="live-signals"
          columns={columns}
          data={sorted}
          keyExtractor={(row) => row.name}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          emptyMessage={
            loading
              ? t('admin.liveSignals.table.loading', 'Loading…')
              : t(
                  'admin.liveSignals.table.filtered',
                  'No signals match this filter.',
                )
          }
          pagination={{ defaultPageSize: 50, pageSizeOptions: [25, 50, 100] }}
          mobileColumns={['name', 'value']}
        />
      )}
    </div>
  );
}
