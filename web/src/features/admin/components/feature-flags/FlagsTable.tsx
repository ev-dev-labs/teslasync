/**
 * Feature Flags — main table.
 *
 * Renders the current registry of flag rows with a JSON-pretty value
 * preview, sortable key column, and per-row Edit + Delete actions.
 * Editing opens a parent-owned drawer; delete opens a parent-owned
 * ConfirmDialog with a required reason input (because the audit row
 * needs a reason and silent deletes break the change-log story).
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';

import {
  Button,
  DataTable,
  Text,
  useSortToggle,
  type Column,
  type PaginationConfig,
} from '@/components/ui';
import type { FeatureFlagEntry } from '@/types/admin-diagnostics';

interface FlagsTableProps {
  rows: FeatureFlagEntry[];
  loading: boolean;
  onEdit: (entry: FeatureFlagEntry) => void;
  onAskDelete: (entry: FeatureFlagEntry) => void;
}

/**
 * Static table config, hoisted to module scope so its object / array
 * identity stays stable across renders (no fresh literal in the hot JSX
 * path, which would defeat DataTable's internal memoisation).
 */
const FLAGS_PAGINATION: PaginationConfig = {
  defaultPageSize: 25,
  pageSizeOptions: [25, 50, 100],
};
const FLAGS_MOBILE_COLUMNS = ['key', 'value', 'actions'];

/** Longest preview we allow in a single table cell before eliding. */
const MAX_PREVIEW_LEN = 120;

/**
 * Elide an over-long preview so a single pathological value (a giant
 * string blob or a deeply-nested object) can never blow out the row
 * height or force horizontal scroll of the table.
 */
function truncatePreview(text: string): string {
  return text.length > MAX_PREVIEW_LEN
    ? `${text.slice(0, MAX_PREVIEW_LEN - 3)}…`
    : text;
}

/**
 * Compact JSON preview suitable for a single table cell. Falls back
 * to `String(value)` for primitives so booleans / numbers don't get
 * extra quoting noise, and returns an em-dash for anything that can't
 * be serialised (circular refs, functions, symbols, bigint).
 *
 * Exported so the formatting contract can be unit-tested in isolation
 * without rendering the whole table.
 */
export function previewValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  const tx = typeof value;
  if (tx === 'string') return truncatePreview(JSON.stringify(value));
  if (tx === 'boolean' || tx === 'number') return String(value);
  try {
    const json = JSON.stringify(value);
    if (json == null) return '—';
    return truncatePreview(json);
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

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...(rows ?? [])].sort((a, b) => {
      if (sortKey === 'key') {
        return (a.key ?? '').localeCompare(b.key ?? '') * dir;
      }
      return 0;
    });
  }, [rows, sortKey, sortDir]);

  const keyExtractor = useCallback((row: FeatureFlagEntry) => row.key ?? '', []);

  const columns = useMemo<Column<FeatureFlagEntry>[]>(
    () => [
      {
        key: 'key',
        header: t('admin.flags.cols.key', 'Flag key'),
        sortable: true,
        visibleOnMobile: true,
        render: (row) => (
          <Text as="span" mono size="sm" color="primary">
            {row.key}
          </Text>
        ),
      },
      {
        key: 'value',
        header: t('admin.flags.cols.value', 'Value'),
        visibleOnMobile: true,
        render: (row) => (
          <Text as="span" mono size="xs" color="muted">
            {previewValue(row.value)}
          </Text>
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
              icon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
              aria-label={t('admin.flags.actions.editFlag', 'Edit flag {{key}}', {
                key: row.key,
              })}
              onClick={() => onEdit(row)}
            >
              {t('admin.flags.actions.edit', 'Edit')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              aria-label={t('admin.flags.actions.deleteFlag', 'Delete flag {{key}}', {
                key: row.key,
              })}
              onClick={() => onAskDelete(row)}
            >
              {t('admin.flags.actions.delete', 'Delete')}
            </Button>
          </div>
        ),
      },
    ],
    [t, onEdit, onAskDelete],
  );

  return (
    <DataTable<FeatureFlagEntry>
      tableId="admin:feature-flags"
      name="feature-flags"
      columns={columns}
      data={sorted}
      keyExtractor={keyExtractor}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      emptyMessage={
        loading
          ? t('admin.flags.table.loading', 'Loading flags…')
          : t('admin.flags.table.empty', 'No feature flags are set on this server.')
      }
      pagination={FLAGS_PAGINATION}
      mobileColumns={FLAGS_MOBILE_COLUMNS}
    />
  );
}
