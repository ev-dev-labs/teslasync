import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { Badge, GlassPanel, PanelTitle, DataTable, useSortToggle, type Column } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import type { SecurityEvent } from '@/types/admin';
import { asNonEmptyString } from '@/lib/typeGuards';
import { doorClosed, allWindowsClosed, windowSummary, isSentryActive } from './helpers';

interface EventHistoryTableProps {
  history: SecurityEvent[];
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function EventHistoryTable({ history, isLoading, error, onRetry, className }: EventHistoryTableProps) {
  const { t } = useTranslation();
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle();

  const eventColumns: Column<SecurityEvent>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: t('admin.security.col.time', 'Time'),
        sortable: true,
        render: (row) => (
          <TimeStamp value={row.createdAt} className={cn('whitespace-nowrap', typography.size.xs, 'text-[var(--text-muted)]')} />
        ),
      },
      {
        key: 'locked',
        header: t('admin.security.col.lock', 'Lock'),
        render: (row) => (
          <Badge variant={row.locked ? 'success' : 'danger'} size="sm">
            {row.locked ? t('admin.security.locked', 'Locked') : t('admin.security.unlocked', 'Unlocked')}
          </Badge>
        ),
      },
      {
        key: 'sentryMode',
        header: t('admin.security.col.sentry', 'Sentry'),
        render: (row) => {
          // `sentryMode` arrives as a string enum ("SentryModeStateOff") or a
          // native bool. A bare `row.sentryMode ? …` truthiness check treats the
          // non-empty "…Off" string as active and mislabels a disarmed vehicle
          // as "On" — classify through the shared guard instead.
          const active = isSentryActive(row.sentryMode);
          return (
            <Badge variant={active ? 'success' : 'neutral'} size="sm">
              {active ? t('admin.security.on', 'On') : t('admin.security.off', 'Off')}
            </Badge>
          );
        },
      },
      {
        key: 'doorState',
        header: t('admin.security.col.doors', 'Doors'),
        render: (row) => (
          <span className={cn(typography.size.sm, doorClosed(row.doorState) ? 'text-emerald-300' : 'text-amber-300')}>
            {asNonEmptyString(row.doorState) ?? (doorClosed(row.doorState) ? t('admin.security.closed', 'Closed') : '—')}
          </span>
        ),
      },
      {
        key: 'windows',
        header: t('admin.security.col.windows', 'Windows'),
        render: (row) => (
          <span className={cn(typography.size.sm, allWindowsClosed(row) ? 'text-emerald-300' : 'text-amber-300')}>
            {windowSummary(row, t)}
          </span>
        ),
      },
    ],
    [t],
  );

  // Null-safe view of the (untyped-at-runtime) history feed, wired to the
  // "Time" column's sort affordance. `useSortToggle` starts with no active
  // key, so the initial order matches what the parent supplies; clicking the
  // header sorts chronologically by `createdAt` (invalid/missing timestamps
  // sort as epoch 0 rather than throwing).
  const rows = useMemo(
    () =>
      sortFn(history ?? [], (row) => {
        const iso = asNonEmptyString(row.createdAt);
        const ts = iso ? Date.parse(iso) : NaN;
        return Number.isFinite(ts) ? ts : 0;
      }),
    [history, sortFn],
  );

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3">{t('admin.security.eventHistory', 'Security Event History')}</PanelTitle>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <Skeleton lines={8} />
      ) : (
        <DataTable<SecurityEvent>
          tableId="admin:security-events"
          columns={eventColumns}
          data={rows}
          keyExtractor={(row) => row.id}
          emptyMessage={t('admin.security.noEvents', 'No security events recorded yet.')}
          compact
          pagination={{ defaultPageSize: 50 }}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
        />
      )}
    </GlassPanel>
  );
}
