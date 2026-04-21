import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { formatDateTime } from '@/lib/dateFormat';
import type { SecurityEvent } from '@/types/admin';
import { doorClosed, allWindowsClosed, windowSummary } from './helpers';

interface EventHistoryTableProps {
  history: SecurityEvent[];
  isLoading: boolean;
}

export function EventHistoryTable({ history, isLoading }: EventHistoryTableProps) {
  const { t } = useTranslation();

  const eventColumns: Column<SecurityEvent>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: t('admin.security.col.time', 'Time'),
        sortable: true,
        render: (row) => (
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {formatDateTime(row.createdAt)}
          </span>
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
          <span
            className={cn(
              'text-sm',
              doorClosed(row.doorState) ? 'text-green-400' : 'text-amber-400',
            )}
          >
            {row.doorState || '—'}
          </span>
        ),
      },
      {
        key: 'windows',
        header: t('admin.security.col.windows', 'Windows'),
        render: (row) => {
          const closed = allWindowsClosed(row);
          return (
            <span className={cn('text-sm', closed ? 'text-green-400' : 'text-amber-400')}>
              {windowSummary(row)}
            </span>
          );
        },
      },
    ],
    [t],
  );

  return (
    <FadeIn delay={0.3}>
      <GlassPanel className="p-4">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          {t('admin.security.eventHistory', 'Security Event History')}
        </h2>
        {isLoading ? (
          <Skeleton lines={8} />
        ) : (
          <DataTable<SecurityEvent>
            columns={eventColumns}
            data={history}
            keyExtractor={(row) => row.id}
            emptyMessage={t(
              'admin.security.noEvents',
              'No security events recorded yet.',
            )}
            compact
            pagination={{ defaultPageSize: 50 }}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
