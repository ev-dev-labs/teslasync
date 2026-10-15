import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { GlassPanel, Badge, DataTable, PanelTitle, Text, type Column } from '@/components/ui';
import { DataSourceNotice, Skeleton, EmptyState, QueryError } from '@/components/feedback';
import type { DataState } from '@/api/dataState';
import { Icons } from '@/lib/icons';
import { formatRelative } from '@/lib/dateFormat';

import { automationNumber, automationStatus, automationTimestamp, type AutomationListItem as Automation } from '@/api/hooks/useAutomations';
import { VisuallyHidden } from '@/components/a11y';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

type RowKey = string | number;

/** Shared stable empties so undefined props never re-trigger the sort memo. */
const EMPTY_AUTOMATIONS: Automation[] = [];
const EMPTY_VEHICLE_LOOKUP = new Map<number, string>();

interface AutomationListTableProps {
  /** Filtered rows to display (already null-safe from the page). */
  automations: Automation[];
  /** vehicle_id → display name, for the Vehicle column. */
  vehicleLookup: Map<number, string>;
  /** Loaded selections may be hidden by filters; the page reviews them before writes. */
  selectedKeys: RowKey[];
  onSelectionChange: (keys: RowKey[]) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** Unfiltered total — distinguishes "no automations" from "no matches". */
  totalCount: number;
  hasData?: boolean;
  dataState?: DataState<unknown>;
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
  isLoading: loading,
  error: sourceError,
  onRetry,
  totalCount,
  hasData: loaded = true,
  dataState,
}: AutomationListTableProps) {
  const hasData = dataState?.hasData ?? loaded;
  const isLoading = dataState ? !hasData && !dataState.isRefreshBlocked && !dataState.fatalError && loading : loading;
  const error = dataState ? dataState.fatalError : sourceError;
  const { fmtNumber } = useNumberFormatting();
  const fmtInt = (value: unknown) => {
    const number = automationNumber(value);
    return number == null ? '—' : fmtNumber(number, Number.isInteger(number) ? 0 : undefined);
  };
  const { t } = useTranslation();

  // Defensive null-safety: the page contract passes null-safe values, but a
  // stray undefined must never crash the spread/iteration below.
  const rows = automations ?? EMPTY_AUTOMATIONS;
  const lookup = vehicleLookup ?? EMPTY_VEHICLE_LOOKUP;

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
    const value = (a: Automation): string | number | null => {
      switch (sortKey) {
        case 'vehicle':
          return (a.vehicle_id != null ? lookup.get(a.vehicle_id) ?? '' : '').toLowerCase();
        case 'runs':
          return automationNumber(a.execution_count);
        case 'failures':
          return automationNumber(a.failure_count);
        case 'lastTriggered': {
          // Guard against corrupt/non-ISO timestamps: an invalid Date yields
          // NaN, and a NaN comparator return leaves the sort order undefined.
          const timestamp = automationTimestamp(a.last_triggered_at);
          if (timestamp == null) return null;
          const ts = new Date(timestamp).getTime();
          return Number.isFinite(ts) ? ts : 0;
        }
        case 'status': {
          const status = automationStatus(a);
          return status == null ? null : status === 'active' ? 0 : status === 'disabled' ? 1 : 2;
        }
        case 'name':
        default:
          return (a.name ?? '').toLowerCase();
      }
    };
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, lookup]);

  const columns = useMemo<Column<Automation>[]>(
    () => [
      {
        key: 'name',
        header: t('automationList.col.name', 'Name'),
        filterValue: (a) => a.id,
        filterValueLabel: (_value, a) => a.name ?? t('automationList.unnamed', 'Untitled automation'),
        sortable: true,
        render: (a) => (
          <Link
            to={`/automations/${a.id}/edit`}
            className="inline-flex min-h-11 items-center break-words font-medium text-[var(--text-primary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {a.name ?? t('automationList.unnamed', 'Untitled automation')}
          </Link>
        ),
      },
      {
        key: 'description',
        header: t('automationList.col.desc', 'Description'),
        filterValue: (a) => a.description ?? null,
        render: (a) => (
          <Text as="span" color="secondary" className="block whitespace-pre-wrap break-words">
            {a.description ?? '—'}
          </Text>
        ),
      },
      {
        key: 'vehicle',
        header: t('automationList.col.vehicle', 'Vehicle'),
        filterValue: (a) => a.vehicle_id ?? null,
        filterValueLabel: (_value, a) => a.vehicle_id != null
          ? lookup.get(a.vehicle_id) ?? t('automationList.vehicleUnknown', 'Vehicle #{{id}}', { id: a.vehicle_id })
          : t('automationList.allVehicles', 'All vehicles'),
        sortable: true,
        render: (a) => (
          <Text as="span" color="secondary">
            {a.vehicle_id != null
              ? lookup.get(a.vehicle_id) ??
                t('automationList.vehicleUnknown', 'Vehicle #{{id}}', { id: a.vehicle_id })
              : t('automationList.allVehicles', 'All vehicles')}
          </Text>
        ),
      },
      {
        key: 'runs',
        header: t('automationList.col.runs', 'Runs'),
        filterValue: (a) => automationNumber(a.execution_count),
        filterValueLabel: (value) => fmtInt(value),
        groupStart: true,
        sortable: true,
        align: 'right',
        render: (a) => (
          <Text as="span" color="primary" className="tabular-nums">
            {fmtInt(a.execution_count)}
          </Text>
        ),
      },
      {
        key: 'failures',
        header: t('automationList.col.failures', 'Failures'),
        filterValue: (a) => automationNumber(a.failure_count),
        filterValueLabel: (value) => fmtInt(value),
        sortable: true,
        align: 'right',
        render: (a) => {
          const failures = automationNumber(a.failure_count);
          return (
            <Text
              as="span"
              className={
                failures != null && failures > 0
                  ? 'tabular-nums text-[var(--status-danger)]'
                  : 'tabular-nums text-[var(--text-muted)]'
              }
            >
              {fmtInt(failures)}
            </Text>
          );
        },
      },
      {
        key: 'lastTriggered',
        header: t('automationList.col.lastTriggered', 'Last triggered'),
        filterValue: (a) => automationTimestamp(a.last_triggered_at),
        filterValueLabel: (_value, a) => automationTimestamp(a.last_triggered_at) ? formatRelative(a.last_triggered_at!) : '—',
        sortable: true,
        render: (a) => (
          <Text as="span" color="secondary">
            {automationTimestamp(a.last_triggered_at) ? formatRelative(a.last_triggered_at!) : '—'}
          </Text>
        ),
      },
      {
        key: 'status',
        header: t('automationList.col.status', 'Status'),
        filterValue: (a) => automationStatus(a),
        filterValueLabel: (_value, a) => automationStatus(a) === 'auto-disabled'
          ? t('automationList.status.autoDisabled', 'Auto-disabled')
          : automationStatus(a) == null ? '—' : a.enabled ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled'),
        groupStart: true,
        sortable: true,
        render: (a) => {
          if (automationStatus(a) == null) return <Text as="span" color="secondary">—</Text>;
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
    [t, lookup, fmtInt],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Icons.workflow className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        {t('automationList.table.title', 'All automations')}
      </PanelTitle>

      {isLoading ? (
        <div role="status" aria-busy="true">
          <VisuallyHidden>
            {t('automationList.loading', 'Loading automations…')}
          </VisuallyHidden>
          <div className="space-y-2" aria-hidden="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ) : error ? (
        <QueryError
          error={error}
          onRetry={onRetry}
          resourceName={t('automationList.resource', 'Automations')}
        />
      ) : !hasData && dataState?.isRefreshBlocked ? (
        <DataSourceNotice sources={[{
          id: 'automation-inventory',
          label: t('automationList.resource', 'Automations'),
          query: { fetchStatus: 'paused', refetch: dataState.retry ?? onRetry },
        }]} />
      ) : !hasData ? (
        <Text role="status" color="secondary">—</Text>
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
          enableValueFilters
          keyExtractor={(row) => row.id}
          selectable="multi"
          rowLabel={(row) => row.name ?? t('automationList.unnamed', 'Untitled automation')}
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          mobileColumns={['name', 'status']}
          mobilePresentation={{
            roles: {
              name: 'title',
              status: 'badge',
              vehicle: 'meta',
              runs: 'meta',
              failures: 'meta',
              description: 'hidden',
              lastTriggered: 'hidden',
            },
            displayValue: (a, key) => {
              switch (key) {
                case 'name': return a.name ?? t('automationList.unnamed', 'Untitled automation');
                case 'description': return a.description;
                case 'vehicle': return a.vehicle_id != null
                  ? lookup.get(a.vehicle_id) ?? t('automationList.vehicleUnknown', 'Vehicle #{{id}}', { id: a.vehicle_id })
                  : t('automationList.allVehicles', 'All vehicles');
                case 'runs': return fmtInt(a.execution_count);
                case 'failures': return fmtInt(a.failure_count);
                case 'lastTriggered': return automationTimestamp(a.last_triggered_at)
                  ? formatRelative(a.last_triggered_at!) : null;
                case 'status': return automationStatus(a) === 'auto-disabled'
                  ? t('automationList.status.autoDisabled', 'Auto-disabled')
                  : automationStatus(a) == null ? null : a.enabled
                    ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled');
                default: return null;
              }
            },
          }}
          pagination
          exportable
          exportFilename="automations"
          exportRow={(a) => ({
            id: a.id,
            name: a.name ?? '',
            description: a.description ?? '',
            vehicle:
              a.vehicle_id != null
                ? lookup.get(a.vehicle_id) ?? `#${a.vehicle_id}`
                : t('automationList.allVehicles', 'All vehicles'),
            runs: automationNumber(a.execution_count),
            failures: automationNumber(a.failure_count),
            lastTriggered: automationTimestamp(a.last_triggered_at),
            status: automationStatus(a),
            enabled: typeof a.enabled === 'boolean' ? a.enabled : '',
            auto_disabled: typeof a.auto_disabled === 'boolean' ? a.auto_disabled : '',
          })}
          emptyMessage={t('automationList.noMatch', 'No automations match your filters')}
        />
      )}
    </GlassPanel>
  );
}
