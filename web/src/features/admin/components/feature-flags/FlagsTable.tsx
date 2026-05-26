/**
 * Feature Flags — main table.
 *
 * Renders the current registry of flag rows with a JSON-pretty value
 * preview, sortable key column, and per-row Edit + Delete actions.
 * Editing opens a parent-owned drawer; delete opens a parent-owned
 * ConfirmDialog with a required reason input (because the audit row
 * needs a reason and silent deletes break the change-log story).
 */
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';

import {
  Button,
  DataTable,
  useSortToggle,
  type Column,
} from '@/components/ui';
import type { FeatureFlagEntry } from '@/types/admin-diagnostics';

interface FlagsTableProps {
  rows: FeatureFlagEntry[];
  loading: boolean;
  onEdit: (entry: FeatureFlagEntry) => void;
  onAskDelete: (entry: FeatureFlagEntry) => void;
}

/**
 * Compact JSON preview suitable for a single table cell. Falls back
 * to `String(value)` for primitives so booleans / numbers don't get
 * extra quoting noise.
 */
function previewValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  const tx = typeof value;
  if (tx === 'string') return JSON.stringify(value);
  if (tx === 'boolean' || tx === 'number') return String(value);
  try {
    const json = JSON.stringify(value);
    if (json && json.length > 120) return `${json.slice(0, 117)}…`;
    return json ?? '—';
  } catch {
    return '—';
  }
}

export function FlagsTable({
  rows,
  loading,
  onEdit,
  onAskDelete,
}: FlagsTableProps) {
  const { t } = useTranslation();
  const { sortKey, sortDir, onSort } = useSortToggle('key', 'asc');

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'key') return a.key.localeCompare(b.key) * dir;
    return 0;
  });

  const columns: Column<FeatureFlagEntry>[] = [
    {
      key: 'key',
      header: t('admin.flags.cols.key', 'Flag key'),
      sortable: true,
      visibleOnMobile: true,
      render: (row) => (
        <span className="font-mono text-sm text-[var(--text-primary)]">
          {row.key}
        </span>
      ),
    },
    {
      key: 'value',
      header: t('admin.flags.cols.value', 'Value'),
      visibleOnMobile: true,
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {previewValue(row.value)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('admin.flags.cols.actions', 'Actions'),
      visibleOnMobile: true,
      render: (row) => (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => onEdit(row)}
          >
            {t('admin.flags.actions.edit', 'Edit')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => onAskDelete(row)}
          >
            {t('admin.flags.actions.delete', 'Delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable<FeatureFlagEntry>
      tableId="admin:feature-flags"
      name="feature-flags"
      columns={columns}
      data={sorted}
      keyExtractor={(row) => row.key}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      emptyMessage={
        loading
          ? t('admin.flags.table.loading', 'Loading flags…')
          : t('admin.flags.table.empty', 'No feature flags are set on this server.')
      }
      pagination={{ defaultPageSize: 25, pageSizeOptions: [25, 50, 100] }}
      mobileColumns={['key', 'value', 'actions']}
    />
  );
}
