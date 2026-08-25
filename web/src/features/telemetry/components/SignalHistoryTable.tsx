/**
 * SignalHistoryTable — paginated history rows with raw-payload row expansion.
 *
 * Composes shared `DataTable` + `Pagination` primitives. Color-codes the
 * Signal column by its position in the caller's `selectedSignals` list so
 * the table stays visually aligned with `SignalChartPanel`.
 *
 * The page-global signal selector (e.g. the "Add signals" picker on
 * `SignalsWorkspacePage`) controls which signals are present in `rows`,
 * so this component intentionally has no per-panel filter UI — adding
 * one would just duplicate the global selector.
 *
 * Used by:
 *   - SignalLogViewerPage  (full-page query)
 *   - SignalExplorerPage   (history slice of the explore mode)
 *   - SignalsWorkspacePage (history slice of default mode)
 */

import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { useDateFormat } from '@/hooks/useDateFormat';

import { GlassPanel, Badge, DataTable, Pagination, SectionTitle, type Column } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { CHART_COLORS } from '@/lib/colors';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { formatValue, type SignalLogEntry } from '@/components/SignalQueryControls';

const TYPE_BADGE_VARIANT: Record<string, 'info' | 'success' | 'warning'> = {
  number: 'info',
  string: 'success',
  boolean: 'warning',
};

function valueType(row: SignalLogEntry): string {
  if (row.value_num !== null && row.value_num !== undefined) return 'number';
  if (row.value_bool !== null && row.value_bool !== undefined) return 'boolean';
  return 'string';
}

export interface SignalHistoryTableProps {
  rows: SignalLogEntry[];
  selectedSignals: string[];
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  /** Override panel title. */
  title?: string;
  /** Show the "Page X · N total" badge in the header. Default true. */
  showHeaderMeta?: boolean;
  /** Optional row-expansion JSON. Default true. */
  expandable?: boolean;
  className?: string;
}

export function SignalHistoryTable({
  rows,
  selectedSignals,
  page,
  pageSize,
  totalRows,
  onPageChange,
  loading = false,
  title,
  showHeaderMeta = true,
  expandable = true,
  className,
}: SignalHistoryTableProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const [expandedKeys, setExpandedKeys] = useState<(string | number)[]>([]);

  const headingId = useId();
  const heading = title ?? t('Signal Data');

  // Null-safe locals — callers should never hand us undefined, but a bad
  // upstream value must degrade to the empty state, not crash on `.length`
  // / `.indexOf` / `.map`.
  const safeRows = rows ?? [];
  const safeSelected = selectedSignals ?? [];

  // A stable, collision-free row key. `${created_at}-${signal}` alone is NOT
  // unique: two samples of the same signal inside the same timestamp string
  // would share a React key and — because the shared DataTable keys its
  // expansion state by this value — expand and collapse together. Index each
  // row by its position via an identity map so every drawer is independent.
  const rowKeyIndex = useMemo(() => {
    const m = new Map<SignalLogEntry, number>();
    safeRows.forEach((r, i) => m.set(r, i));
    return m;
  }, [safeRows]);
  const keyExtractor = useCallback(
    (r: SignalLogEntry) => `${r.created_at}::${r.signal}::${rowKeyIndex.get(r) ?? 0}`,
    [rowKeyIndex],
  );

  const renderExpanded = useCallback(
    (r: SignalLogEntry) => (
      <pre className="whitespace-pre-wrap break-all text-2xs font-mono text-[var(--text-secondary)]">
        {JSON.stringify(r, null, 2)}
      </pre>
    ),
    [],
  );

  const columns: Column<SignalLogEntry>[] = useMemo(() => [
    {
      key: 'time',
      header: t('Timestamp'),
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-[var(--text-muted)]">{formatDateTime(r.created_at)}</span>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'signal',
      header: t('Signal'),
      render: (r) => {
        const idx = safeSelected.indexOf(r.signal);
        const color = idx >= 0 ? CHART_COLORS[idx % CHART_COLORS.length] : undefined;
        return (
          <span className="inline-flex items-center gap-1.5">
            {color && (
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: color }}
              />
            )}
            <span
              className={cn('font-mono text-xs', idx < 0 && 'text-[var(--text-primary)]')}
              style={color ? { color } : undefined}
            >
              {r.signal}
            </span>
          </span>
        );
      },
      visibleOnMobile: true,
    },
    {
      key: 'value',
      header: t('Value'),
      render: (r) => <span className="font-mono text-xs text-[var(--text-primary)]">{formatValue(r)}</span>,
      visibleOnMobile: true,
    },
    {
      key: 'type',
      header: t('Type'),
      render: (r) => {
        const vt = valueType(r);
        return <Badge variant={TYPE_BADGE_VARIANT[vt] ?? 'neutral'} size="sm">{vt}</Badge>;
      },
    },
  ], [safeSelected, t, formatDateTime]);

  return (
    <FadeIn>
      <GlassPanel role="region" aria-labelledby={headingId} className={cn('p-4 sm:p-5', className)}>
        <div className="flex items-center gap-2 mb-3">
          <Activity aria-hidden="true" className="h-4 w-4 text-neon-cyan" />
          <SectionTitle id={headingId}>{heading}</SectionTitle>
          {showHeaderMeta ? (
            <span className="ml-auto text-2xs text-[var(--text-muted)]">
              {t('Page')} {page} · {fmtInt(totalRows)} {t('total')}
            </span>
          ) : null}
        </div>

        {loading ? (
          <div role="status" aria-label={t('Loading signal data')} className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : safeRows.length > 0 ? (
          <>
            <DataTable
              tableId="telemetry:signal-history"
              columns={columns}
              data={safeRows}
              keyExtractor={keyExtractor}
              compact
              showColumnsMenu
              stickyHeader
              maxHeight={520}
              expandable={expandable}
              expandedKeys={expandable ? expandedKeys : undefined}
              onExpandedChange={expandable ? setExpandedKeys : undefined}
              renderExpanded={expandable ? renderExpanded : undefined}
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={totalRows}
              onPageChange={onPageChange}
            />
          </>
        ) : (
          // no-action: empty result for a user-issued query; user adjusts the controls above to re-query.
          <EmptyState
            icon={<Activity className="h-8 w-8" aria-hidden="true" />}
            title={t('signalHistory.emptyTitle', 'No signal samples')}
            message={t(
              'signalHistory.emptyMessage',
              'No signal data matches the selected signals and time range.',
            )}
            description={t(
              'signalHistory.emptyDescription',
              'Expand the time range or choose another signal, then run the query again.',
            )}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
