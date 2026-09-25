import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, type Column } from '@/components/ui';
import { DateTime } from '@/components/data-display';
import type { AutomationHistory } from '@/api/types';
import { formatDurationMs } from '@/lib/dateFormat';

export function AutomationHistoryTable({ rows, onOpen }: {
  rows: AutomationHistory[];
  onOpen: (id: number) => void;
}) {
  const { t } = useTranslation();
  const columns = useMemo<Column<AutomationHistory>[]>(() => [
    { key: 'time', header: t('automations.historyPage.time', 'Triggered'), render: (row) => <DateTime value={row.triggered_at} in="user" /> },
    { key: 'rule', header: t('automations.historyPage.rule', 'Automation'), visibleOnMobile: true, render: (row) =>
      <Button variant="ghost" className="!h-auto !justify-start !p-0 text-left" onClick={() => onOpen(row.id)}>
        {row.automation_name || t('automations.historyPage.ruleId', 'Rule #{{id}}', { id: row.automation_id })}
      </Button> },
    { key: 'status', header: t('automations.historyPage.outcome', 'Outcome'), visibleOnMobile: true, render: (row) =>
      t(`automations.historyPage.status.${row.status}`, row.status) },
    { key: 'trigger', header: t('automations.historyPage.trigger', 'Trigger'), render: (row) => row.trigger_type || '—' },
    { key: 'actions', header: t('automations.historyPage.actions', 'Actions'), render: (row) => `${row.actions_succeeded}/${row.actions_total}` },
    { key: 'duration', header: t('automations.historyPage.durationColumn', 'Duration'), render: (row) => row.duration_ms != null ? formatDurationMs(row.duration_ms) : '—' },
    { key: 'error', header: t('automations.historyPage.error', 'Error'), render: (row) => row.error || '—' },
  ], [t, onOpen]);
  return (
    <DataTable
      tableId="automations:history"
      caption={t('automations.historyPage.title', 'Automation History')}
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      rowLabel={(row) => row.automation_name}
      mobileColumns={['rule', 'status']}
      density="compact"
      columnVisibility
    />
  );
}
