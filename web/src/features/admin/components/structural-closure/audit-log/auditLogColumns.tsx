import { useMemo } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { Badge, Button, CopyButton, Caption, Text, type Column } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import type { AuditLogRow } from '@/types/admin-operator-confidence';
import type { useAuditLogPage } from '../../../hooks/useAuditLogPage';

type Controller = ReturnType<typeof useAuditLogPage>;

export function useAuditLogColumns(controller: Controller) {
  const { t, expanded, toggleExpanded } = controller;
  const columns = useMemo<Column<AuditLogRow>[]>(
    () => [
      {
        key: 'ts',
        header: t('admin.auditLog.colTs', 'Timestamp'),
        render: (r) => (
          <div>
            <Text as="div" variant="body">{formatDateTime(r.ts)}</Text>
            <Caption>{formatRelative(r.ts)}</Caption>
          </div>
        ),
      },
      {
        key: 'actor',
        header: t('admin.auditLog.colActor', 'Actor'),
        render: (r) => <Text variant="body">{r.actor || '—'}</Text>,
      },
      {
        key: 'category',
        header: t('admin.auditLog.colCategory', 'Category'),
        render: (r) =>
          r.category ? (
            <Badge variant="neutral">{r.category}</Badge>
          ) : (
            <Text color="muted">—</Text>
          ),
      },
      {
        key: 'action',
        header: t('admin.auditLog.colAction', 'Action'),
        render: (r) => <Text weight="medium" color="primary">{r.action}</Text>,
      },
      {
        key: 'entity',
        header: t('admin.auditLog.colEntity', 'Entity'),
        render: (r) => (
          <div>
            <Text variant="body">{r.entity_type}</Text>
            {r.entity_id !== null && r.entity_id !== undefined && (
              <Caption>{`#${r.entity_id}`}</Caption>
            )}
          </div>
        ),
      },
      {
        key: 'detail',
        header: t('admin.auditLog.colDetail', 'Detail'),
        render: (r) => (
          <Text color="secondary" className="line-clamp-2">{r.detail ?? '—'}</Text>
        ),
      },
      {
        key: 'trace',
        header: t('admin.auditLog.colTrace', 'Trace'),
        render: (r) =>
          r.trace_id ? (
            <div className="flex items-center gap-1">
              <Text mono size="xs" color="secondary">
                {r.trace_id.slice(0, 8)}…
              </Text>
              <CopyButton text={r.trace_id} iconOnly variant="ghost" size="sm" />
            </div>
          ) : (
            <Text color="muted">—</Text>
          ),
      },
      {
        key: 'success',
        header: t('admin.auditLog.colSuccess', 'Status'),
        align: 'right',
        render: (r) => {
          if (r.success === false)
            return (
              <Badge variant="danger">
                <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {t('admin.auditLog.statusFail', 'Fail')}
              </Badge>
            );
          if (r.success === true)
            return (
              <Badge variant="success">
                <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {t('admin.auditLog.statusOk', 'OK')}
              </Badge>
            );
          return <Badge variant="neutral">—</Badge>;
        },
      },
      {
        key: 'expand',
        header: '',
        align: 'right',
        render: (r) => (
          <Button variant="ghost" size="sm" onClick={() => toggleExpanded(r.id)}>
            {expanded.includes(r.id)
              ? t('admin.auditLog.hideDetails', 'Hide')
              : t('admin.auditLog.showDetails', 'Details')}
          </Button>
        ),
      },
    ],
    [t, expanded],
  );

  return columns;
}
