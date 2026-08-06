/**
 * Read-only view over the local, append-only audit log (install / upgrade
 * / rollback / uninstall / enable / disable / trust-decision / block).
 * Entries are capped client-side (oldest dropped first — see
 * `lib/packRepository.ts`); this panel never mutates the log.
 */
import { useTranslation } from 'react-i18next';
import { ScrollText } from 'lucide-react';
import { Badge, Column, DataTable } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { formatDateTime } from '@/lib/dateFormat';
import { useAuditLog } from '../hooks/useAuditLog';
import type { AuditAction, AuditLogEntry } from '../lib/auditLog';

const ACTION_VARIANT: Record<AuditAction, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  'catalog-preview': 'neutral',
  install: 'success',
  upgrade: 'info',
  rollback: 'warning',
  uninstall: 'danger',
  enable: 'success',
  disable: 'neutral',
  'trust-decision': 'info',
  block: 'danger',
  'verify-failed': 'danger',
  import: 'info',
  export: 'neutral',
};

export function AuditLogPanel() {
  const { t } = useTranslation();
  const auditQuery = useAuditLog();
  const rows = auditQuery.data ?? [];

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'timestamp',
      header: t('intelPacks.audit.colWhen', 'When'),
      render: (r) => <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{formatDateTime(r.timestampIso)}</span>,
      visibleOnMobile: true,
    },
    {
      key: 'action',
      header: t('intelPacks.audit.colAction', 'Action'),
      render: (r) => <Badge variant={ACTION_VARIANT[r.action] ?? 'neutral'} size="sm">{r.action}</Badge>,
      visibleOnMobile: true,
    },
    {
      key: 'pack',
      header: t('intelPacks.audit.colPack', 'Pack'),
      render: (r) => <span className="text-sm text-[var(--text-primary)]">{r.packName || r.packId}</span>,
    },
    {
      key: 'detail',
      header: t('intelPacks.audit.colDetail', 'Detail'),
      render: (r) => <span className="text-xs text-[var(--text-secondary)]">{r.detail}</span>,
    },
  ];

  if (rows.length === 0) {
    // no-action: transient — this log fills automatically as install/uninstall/rollback actions occur; there is no user action to populate an empty audit trail.
    return <EmptyState icon={<ScrollText className="h-10 w-10" />} message={t('intelPacks.audit.empty', 'No actions have been recorded yet.')} />;
  }

  return (
    <DataTable
      tableId="intelligence-packs:audit-log"
      columns={columns}
      data={rows}
      keyExtractor={(r) => r.id}
      pagination
      mobileColumns={['timestamp', 'action']}
      emptyMessage={t('intelPacks.audit.empty', 'No actions have been recorded yet.')}
      name="IntelligencePacksAuditLog"
    />
  );
}
