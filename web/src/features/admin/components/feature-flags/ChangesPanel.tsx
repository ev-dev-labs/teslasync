/**
 * Feature Flags — change-audit panel.
 *
 * Renders the recent flag-change log, optionally scoped to a single
 * flag key. Always rendered in its own panel shell so the loading + empty
 * states surface in-place rather than gating the whole page.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  DataTable,
  Text,
  type Column,
  type PaginationConfig,
} from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
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

function compact(value: unknown): string {
  if (value == null) return '—';
  try {
    const s = JSON.stringify(value);
    if (s && s.length > 60) return `${s.slice(0, 57)}…`;
    return s ?? '—';
  } catch {
    return '—';
  }
}

export function ChangesPanel({ rows, loading, scopedKey }: ChangesPanelProps) {
  const { t } = useTranslation();

  // Null-guard: the parent always resolves `rows` to an array, but a
  // mid-flight or accidentally-undefined prop must never crash the panel —
  // `.length` and DataTable's `data.length` both throw on undefined.
  const safeRows = rows ?? [];

  const columns = useMemo<Column<FeatureFlagChange>[]>(
    () => [
      {
        key: 'changed_at',
        header: t('admin.flags.audit.cols.changedAt', 'Changed at'),
        visibleOnMobile: true,
        render: (row) => <TimeStamp value={row.changed_at} format="absolute" />,
      },
      {
        key: 'actor',
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
        header: t('admin.flags.audit.cols.flagKey', 'Key'),
        render: (row) => (
          <Text as="span" mono size="xs">{row.flag_key}</Text>
        ),
      },
      {
        key: 'operation',
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
        render: (row) => (
          <Text as="span" mono size="xs" color="muted">
            {compact(row.old_value)}
          </Text>
        ),
      },
      {
        key: 'new_value',
        header: t('admin.flags.audit.cols.newValue', 'New'),
        render: (row) => (
          <Text as="span" mono size="xs" color="muted">
            {compact(row.new_value)}
          </Text>
        ),
      },
      {
        key: 'reason',
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
    <DataTable<FeatureFlagChange>
      tableId={scopedKey ? 'admin:flag-changes-scoped' : 'admin:flag-changes'}
      name="flag-changes"
      columns={columns}
      data={safeRows}
      keyExtractor={(row) => row.id}
      emptyMessage={
        loading
          ? t('admin.flags.audit.loading', 'Loading audit log…')
          : t('admin.flags.audit.empty.title', 'No flag changes yet')
      }
      pagination={PAGINATION}
      mobileColumns={MOBILE_COLUMNS}
    />
  );
}
