/**
 * Feature Flags — change-audit panel.
 *
 * Renders the recent flag-change log, optionally scoped to a single
 * flag key. Always rendered in its own panel shell so the loading + empty
 * states surface in-place rather than gating the whole page.
 * Read-only row disclosure retains every mobile field and full historical
 * values; export accessors preserve raw values independently of previews.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { VisuallyHidden } from '@/components/a11y';

import {
  Badge,
  DataTable,
  Text,
  useTableExpansion,
  type Column,
  type PaginationConfig,
} from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { EmptyState, TableSkeleton } from '@/components/feedback';
import { normalizeCsvCellValue } from '@/lib/csvValidation';
import type {
  FeatureFlagChange,
  FeatureFlagOperation,
} from '@/types/admin-diagnostics';

interface ChangesPanelProps {
  rows: FeatureFlagChange[];
  loading: boolean;
  scopedKey?: string | null;
}

const OP_VARIANT: Record<FeatureFlagOperation, 'success' | 'danger'> = {
  set: 'success',
  delete: 'danger',
};

// Referentially-stable table config. Hoisted to module scope so a fresh
// object/array literal on every render doesn't invalidate DataTable's
// internal `mobileColumns`/pagination memoisation.
const PAGINATION: PaginationConfig = {
  defaultPageSize: 25,
  pageSizeOptions: [25, 50, 100],
};
const MOBILE_COLUMNS = ['changed_at', 'actor', 'operation'];

function fullValue(value: unknown): string {
  if (value == null) return '—';
  try {
    return JSON.stringify(value) ?? '—';
  } catch {
    return '—';
  }
}

function compact(value: unknown): string {
  const valueText = fullValue(value);
  return valueText.length > 60 ? `${valueText.slice(0, 57)}…` : valueText;
}

export function ChangesPanel({ rows, loading, scopedKey }: ChangesPanelProps) {
  const { t } = useTranslation();
  const { expandedKeys, setExpandedKeys } = useTableExpansion<number>();

  // Null-guard: the parent always resolves `rows` to an array, but a
  // mid-flight or accidentally-undefined prop must never crash the panel —
  // `.length` and DataTable's `data.length` both throw on undefined.
  const safeRows = rows ?? [];

  const columns = useMemo<Column<FeatureFlagChange>[]>(
    () => [
      {
        key: 'changed_at',
        filterValue: (row) => row.changed_at ?? null,
        header: t('admin.flags.audit.cols.changedAt', 'Changed at'),
        visibleOnMobile: true,
        render: (row) => <TimeStamp value={row.changed_at} format="absolute" />,
      },
      {
        key: 'actor',
        filterValue: (row) => row.actor || null,
        header: t('admin.flags.audit.cols.actor', 'Actor'),
        visibleOnMobile: true,
        render: (row) => (
          <Text as="span" mono size="xs" color="muted">
            {row.actor || '—'}
          </Text>
        ),
      },
      {
        key: 'flag_key',
        filterValue: (row) => row.flag_key ?? null,
        header: t('admin.flags.audit.cols.flagKey', 'Key'),
        render: (row) => (
          <Text as="span" mono size="xs">{row.flag_key}</Text>
        ),
      },
      {
        key: 'operation',
        filterValue: (row) => row.operation ?? null,
        header: t('admin.flags.audit.cols.operation', 'Op'),
        visibleOnMobile: true,
        render: (row) => (
          <Badge variant={OP_VARIANT[row.operation] ?? 'neutral'}>
            {row.operation}
          </Badge>
        ),
      },
      {
        key: 'old_value',
        header: t('admin.flags.audit.cols.oldValue', 'Old'),
        exportValue: (row) => normalizeCsvCellValue(row.old_value),
        render: (row) => (
          <Text as="span" mono size="xs" color="muted">
            {compact(row.old_value)}
          </Text>
        ),
      },
      {
        key: 'new_value',
        header: t('admin.flags.audit.cols.newValue', 'New'),
        exportValue: (row) => normalizeCsvCellValue(row.new_value),
        render: (row) => (
          <Text as="span" mono size="xs" color="muted">
            {compact(row.new_value)}
          </Text>
        ),
      },
      {
        key: 'reason',
        filterValue: (row) => row.reason || null,
        header: t('admin.flags.audit.cols.reason', 'Reason'),
        render: (row) => (
          <Text as="span" size="xs" color="muted">
            {row.reason || '—'}
          </Text>
        ),
      },
    ],
    [t],
  );

  if (loading && safeRows.length === 0) {
    return (
      <div role="region" aria-busy="true" aria-label={t('admin.flags.audit.loading', 'Loading audit log…')}>
        <VisuallyHidden liveRegion>
          {t('admin.flags.audit.loading', 'Loading audit log…')}
        </VisuallyHidden>
        <div aria-hidden="true">
          <TableSkeleton rows={5} cols={7} />
        </div>
      </div>
    );
  }

  if (!loading && safeRows.length === 0) {
    return (
      <EmptyState
        title={t('admin.flags.audit.empty.title', 'No flag changes yet')}
        message={
          scopedKey
            ? t(
                'admin.flags.audit.empty.scopedMessage',
                'No audit rows for "{{key}}" — edit the value above to start the trail.',
                { key: scopedKey },
              )
            : t(
                'admin.flags.audit.empty.globalMessage',
                'Flag changes will appear here once an operator edits a value.',
              )
        }
        // no-action: the trigger surface is the flags table directly above.
      />
    );
  }

  return (
    <div aria-busy={loading || undefined}>
    <DataTable<FeatureFlagChange>
      tableId={scopedKey ? 'admin:flag-changes-scoped' : 'admin:flag-changes'}
      name="flag-changes"
      columns={columns}
      data={safeRows}
      enableValueFilters
      keyExtractor={(row) => row.id}
      emptyMessage={
        loading
          ? t('admin.flags.audit.loading', 'Loading audit log…')
          : t('admin.flags.audit.empty.title', 'No flag changes yet')
      }
      pagination={PAGINATION}
      mobileColumns={MOBILE_COLUMNS}
      expandable
      expandedKeys={expandedKeys}
      onExpandedChange={(keys) => setExpandedKeys(keys.filter((key): key is number => typeof key === 'number'))}
      rowLabel={(row) => row.flag_key ?? ''}
      renderExpanded={(row) => (
        <dl className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          {columns.map((column) => (
            <div key={column.key} className="min-w-0">
              <Text as="dt" size="xs" color="muted">{column.header}</Text>
              <Text as="dd" size="sm" className="whitespace-pre-wrap break-all">
                {column.key === 'old_value'
                  ? fullValue(row.old_value)
                  : column.key === 'new_value'
                    ? fullValue(row.new_value)
                    : column.render(row)}
              </Text>
            </div>
          ))}
        </dl>
      )}
    />
    </div>
  );
}
