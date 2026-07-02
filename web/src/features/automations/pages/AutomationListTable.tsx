import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { GlassPanel, Badge, DataTable, PanelTitle, type Column } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import { formatRelative } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import type { Automation } from '@/api/types';

type RowKey = string | number;

interface AutomationListTableProps {
  /** Filtered rows to display (already null-safe from the page). */
  automations: Automation[];
  /** vehicle_id → display name, for the Vehicle column. */
  vehicleLookup: Map<number, string>;
  /** Controlled multi-selection (pruned to visible rows by the page). */
  selectedKeys: RowKey[];
  onSelectionChange: (keys: RowKey[]) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** Unfiltered total — distinguishes "no automations" from "no matches". */
  totalCount: number;
}

/**
 * AutomationListTable — the bulk-manage detail band.
 *
 * Wraps the shared `DataTable` with automation-specific columns, native
 * multi-selection (checkbox column + select-all + shift-range), functional
 * header sorting, and independent loading / empty / error states. Kept as a
 * sub-component so the page orchestrator stays lean.
 */
export function AutomationListTable({
  automations,
  vehicleLookup,
  selectedKeys,
  onSelectionChange,
  isLoading,
  error,
  onRetry,
  totalCount,
}: AutomationListTableProps) {
  const { t } = useTranslation();

  // Controlled sort — DataTable renders the indicators + calls onSort; the
  // ordering itself is applied here with field-correct accessors so numeric
  // columns (runs, failures) and the timestamp column sort correctly.
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const onSort = (key: string) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    const value = (a: Automation): string | number => {
      switch (sortKey) {
        case 'vehicle':
          return (a.vehicle_id != null ? vehicleLookup.get(a.vehicle_id) ?? '' : '').toLowerCase();
        case 'runs':
          return a.execution_count ?? 0;
        case 'failures':
          return a.failure_count ?? 0;
        case 'lastTriggered':
          return a.last_triggered_at ? new Date(a.last_triggered_at).getTime() : 0;
        case 'status':
          return a.auto_disabled ? 2 : a.enabled ? 0 : 1;
        case 'name':
        default:
          return (a.name ?? '').toLowerCase();
      }
    };
    return [...automations].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [automations, sortKey, sortDir, vehicleLookup]);

  const columns = useMemo<Column<Automation>[]>(
    () => [
      {
        key: 'name',
        header: t('automationList.col.name', 'Name'),
        sortable: true,
        render: (a) => (
          <Link
            to={`/automations/${a.id}`}
            className="font-medium text-cyan-300 underline-offset-2 hover:underline"
          >
            {a.name ?? t('automationList.unnamed', 'Untitled automation')}
          </Link>
        ),
      },
      {
        key: 'description',
        header: t('automationList.col.desc', 'Description'),
        render: (a) => (
          <span className="block max-w-[18rem] truncate text-[var(--text-secondary)]">
            {a.description ?? '—'}
          </span>
        ),
      },
      {
        key: 'vehicle',
        header: t('automationList.col.vehicle', 'Vehicle'),
        sortable: true,
        render: (a) => (
          <span className="text-[var(--text-secondary)]">
            {a.vehicle_id != null
              ? vehicleLookup.get(a.vehicle_id) ??
                t('automationList.vehicleUnknown', 'Vehicle #{{id}}', { id: a.vehicle_id })
              : t('automationList.allVehicles', 'All vehicles')}
          </span>
        ),
      },
      {
        key: 'runs',
        header: t('automationList.col.runs', 'Runs'),
        sortable: true,
        align: 'right',
        render: (a) => (
          <span className="tabular-nums text-[var(--text-primary)]">
            {fmtInt(a.execution_count ?? 0)}
          </span>
        ),
      },
      {
        key: 'failures',
        header: t('automationList.col.failures', 'Failures'),
        sortable: true,
        align: 'right',
        render: (a) => {
          const failures = a.failure_count ?? 0;
          return (
            <span
              className={
                failures > 0
                  ? 'tabular-nums text-rose-300'
                  : 'tabular-nums text-[var(--text-muted)]'
              }
            >
              {fmtInt(failures)}
            </span>
          );
        },
      },
      {
        key: 'lastTriggered',
        header: t('automationList.col.lastTriggered', 'Last triggered'),
        sortable: true,
        render: (a) => (
          <span className="text-[var(--text-secondary)]">
            {a.last_triggered_at ? formatRelative(a.last_triggered_at) : '—'}
          </span>
        ),
      },
      {
        key: 'status',
        header: t('automationList.col.status', 'Status'),
        sortable: true,
        render: (a) => {
          if (a.auto_disabled) {
            return (
              <Badge variant="danger" size="sm">
                {t('automationList.status.autoDisabled', 'Auto-disabled')}
              </Badge>
            );
          }
          return a.enabled ? (
            <Badge variant="success" size="sm">
              {t('common.enabled', 'Enabled')}
            </Badge>
          ) : (
            <Badge variant="neutral" size="sm">
              {t('common.disabled', 'Disabled')}
            </Badge>
          );
        },
      },
    ],
    [t, vehicleLookup],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Icons.workflow className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('automationList.table.title', 'All automations')}
      </PanelTitle>

      {isLoading ? (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <QueryError
          error={error}
          onRetry={onRetry}
          resourceName={t('automationList.resource', 'Automations')}
        />
      ) : totalCount === 0 ? (
        <EmptyState
          icon={<Icons.workflow className="h-8 w-8" />}
          title={t('automationList.empty.title', 'No automations yet')}
          message={t(
            'automationList.empty.body',
            'Create your first automation in the builder to manage it here.',
          )}
          actionTo={{
            label: t('automationList.empty.cta', 'Open builder'),
            to: '/automations/new',
          }}
        />
      ) : (
        <DataTable
          tableId="automations:bulk-list"
          columns={columns}
          data={sorted}
          keyExtractor={(row) => row.id}
          selectable="multi"
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          mobileColumns={['name', 'status']}
          pagination
          emptyMessage={t('automationList.noMatch', 'No automations match your filters')}
        />
      )}
    </GlassPanel>
  );
}
