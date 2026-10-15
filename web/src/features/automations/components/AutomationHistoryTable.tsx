import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, type Column } from '@/components/ui';
import { DateTime } from '@/components/data-display';
import type { AutomationHistory } from '@/api/types';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function AutomationHistoryTable({ rows, onOpen }: {
  rows: AutomationHistory[];
  onOpen: (id: number) => void;
}) {
  const { formatDurationMs, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const ruleName = (row: AutomationHistory) =>
    row.automation_name || t('automations.historyPage.ruleId', 'Rule #{{id}}', { id: row.automation_id });
  const executionLabel = (row: AutomationHistory) => `${ruleName(row)} #${row.id}`;
  const columns = useMemo<Column<AutomationHistory>[]>(() => [
    { key: 'time', header: t('automations.historyPage.time', 'Triggered'), render: (row) => <DateTime value={row.triggered_at} in="user" /> },
    { key: 'rule', header: t('automations.historyPage.rule', 'Automation'), visibleOnMobile: true, render: (row) =>
      <Button variant="ghost" wrapLabel className="min-h-11 min-w-11 justify-start text-left" onClick={() => onOpen(row.id)}>
        {row.automation_name || t('automations.historyPage.ruleId', 'Rule #{{id}}', { id: row.automation_id })}
      </Button> },
    { key: 'status', header: t('automations.historyPage.outcome', 'Outcome'), visibleOnMobile: true, render: (row) =>
      t(`automations.historyPage.status.${row.status}`, row.status) },
    { key: 'trigger', header: t('automations.historyPage.trigger', 'Trigger'), render: (row) => row.trigger_type || '—' },
    { key: 'actions', header: t('automations.historyPage.actions', 'Actions'), align: 'right', render: (row) => {
      const count = (value: number) => Number.isSafeInteger(value) && value >= 0 ? fmtInt(value) : '—';
      return `${count(row.actions_succeeded)}/${count(row.actions_total)}`;
    } },
    { key: 'duration', header: t('automations.historyPage.durationColumn', 'Duration'), align: 'right', render: (row) => row.duration_ms != null ? formatDurationMs(row.duration_ms) : '—' },
    { key: 'error', header: t('automations.historyPage.error', 'Error'), render: (row) => row.error || '—' },
  ], [t, onOpen, formatDurationMs, fmtInt]);
  return (
    <DataTable
      tableId="automations:history"
      caption={t('automations.historyPage.title', 'Automation history')}
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      rowLabel={executionLabel}
      mobilePresentation={{
        roles: { rule: 'title', status: 'badge' },
        displayValue: (row, key) => key === 'rule' ? executionLabel(row)
          : key === 'status' ? t(`automations.historyPage.status.${row.status}`, row.status) : null,
        onOpenRow: (row) => onOpen(row.id),
      }}
      mobileColumns={['rule', 'status']}
      density="compact"
      columnVisibility
    />
  );
}
