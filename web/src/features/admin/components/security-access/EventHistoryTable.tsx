import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Badge, GlassPanel, PanelTitle, DataTable, type Column } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import type { SecurityEvent } from '@/types/admin';
import { asNonEmptyString } from '@/lib/typeGuards';
import { doorClosed, allWindowsClosed, windowSummary } from './helpers';

interface EventHistoryTableProps {
  history: SecurityEvent[];
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function EventHistoryTable({ history, isLoading, error, onRetry, className }: EventHistoryTableProps) {
  const { t } = useTranslation();

  const eventColumns: Column<SecurityEvent>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: t('admin.security.col.time', 'Time'),
        sortable: true,
        render: (row) => (
          <TimeStamp value={row.createdAt} className="whitespace-nowrap text-xs text-[var(--text-muted)]" />
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
        render: (row) => (
          <Badge variant={row.sentryMode ? 'success' : 'neutral'} size="sm">
            {row.sentryMode ? t('admin.security.on', 'On') : t('admin.security.off', 'Off')}
          </Badge>
        ),
      },
      {
        key: 'doorState',
        header: t('admin.security.col.doors', 'Doors'),
        render: (row) => (
          <span className={cn('text-sm', doorClosed(row.doorState) ? 'text-emerald-300' : 'text-amber-300')}>
            {asNonEmptyString(row.doorState) ?? (doorClosed(row.doorState) ? t('admin.security.closed', 'Closed') : '—')}
          </span>
        ),
      },
      {
        key: 'windows',
        header: t('admin.security.col.windows', 'Windows'),
        render: (row) => (
          <span className={cn('text-sm', allWindowsClosed(row) ? 'text-emerald-300' : 'text-amber-300')}>
            {windowSummary(row, t)}
          </span>
        ),
      },
    ],
    [t],
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
          data={history}
          keyExtractor={(row) => row.id}
          emptyMessage={t('admin.security.noEvents', 'No security events recorded yet.')}
          compact
          pagination={{ defaultPageSize: 50 }}
        />
      )}
    </GlassPanel>
  );
}
