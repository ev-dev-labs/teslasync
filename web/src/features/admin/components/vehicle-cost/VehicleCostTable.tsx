import { Icons } from '@/lib/icons';
/**
 * Full-width per-vehicle breakdown table for the Vehicle Ingest Cost page.
 *
 * Preserves the original six sortable columns (vehicle, rows, bytes, ingest
 * rate, DLQ failures, last seen). Wrapped in a `SectionErrorBoundary` and owns
 * its own loading / empty / error rendering so a table crash never blanks the
 * KPI band or chart above it.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Caption, Text, DataTable, type Column } from '@/components/ui';
import { Skeleton, EmptyState, QueryError, SectionErrorBoundary } from '@/components/feedback';

import { useDateFormat } from '@/hooks/useDateFormat';
import { costReading, formatCostReading, vehicleName, type SectionState } from './helpers';
import type { VehicleCostRow } from '@/types/admin-operator-confidence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface VehicleCostTableProps extends SectionState {
  vehicles: VehicleCostRow[];
}

export function VehicleCostTable({ vehicles, loading, error, onRetry }: VehicleCostTableProps) {
  const { fmtInt, fmtNumber, formatBytes } = useNumberFormatting();
  const { formatRelative } = useDateFormat();
  const { t } = useTranslation();

  // Defensive: the page passes `data?.vehicles ?? []`, but guard here too so a
  // partial payload (or a future caller) can never crash the render on
  // `.length` — this section owns its own empty/loading states below.
  const vehicleRows = vehicles ?? [];

  const columns = useMemo<Column<VehicleCostRow>[]>(
    () => [
      {
        key: 'vehicle',
        filterValue: (r) => r.vehicle_id ?? null,
        filterValueLabel: (_value, r) => vehicleName(r, t('admin.vehicleCost.unnamed', 'Vehicle #{{id}}', { id: r.vehicle_id })),
        header: t('admin.vehicleCost.colVehicle', 'Vehicle'),
        render: (r) => (
          <div className="flex flex-col">
            <Text weight="medium" color="primary">
              {vehicleName(r, t('admin.vehicleCost.unnamed', 'Vehicle #{{id}}', { id: r.vehicle_id }))}
            </Text>
            <Caption>
              {t('admin.vehicleCost.rowId', 'ID {{id}}', { id: fmtInt(r.vehicle_id) })}
            </Caption>
          </div>
        ),
      },
      {
        key: 'rows',
        filterValue: (r) => costReading(r.signal_row_count),
        filterValueLabel: (_value, r) => formatCostReading(r.signal_row_count, fmtInt),
        groupStart: true,
        header: t('admin.vehicleCost.colRows', 'Rows'),
        align: 'right',
        render: (r) => <Text className="tabular-nums">{formatCostReading(r.signal_row_count, fmtInt)}</Text>,
      },
      {
        key: 'bytes',
        filterValue: (r) => costReading(r.signal_bytes_est),
        filterValueLabel: (_value, r) => formatCostReading(r.signal_bytes_est, formatBytes),
        header: t('admin.vehicleCost.colBytes', 'Bytes (est.)'),
        align: 'right',
        render: (r) => <Text className="tabular-nums">{formatCostReading(r.signal_bytes_est, formatBytes)}</Text>,
      },
      {
        key: 'rate',
        filterValue: (r) => costReading(r.ingest_rate_per_minute_24h),
        filterValueLabel: (_value, r) => formatCostReading(r.ingest_rate_per_minute_24h, fmtNumber),
        header: t('admin.vehicleCost.colRate', 'Rate (rows/min, 24h)'),
        align: 'right',
        render: (r) => (
          <Text className="tabular-nums">{formatCostReading(r.ingest_rate_per_minute_24h, fmtNumber)}</Text>
        ),
      },
      {
        key: 'failures',
        filterValue: (r) => costReading(r.dlq_failures_24h),
        filterValueLabel: (_value, r) => formatCostReading(r.dlq_failures_24h, fmtInt),
        header: t('admin.vehicleCost.colFailures', 'DLQ (24h)'),
        align: 'right',
        render: (r) => {
          const failures = costReading(r.dlq_failures_24h);
          const cls =
            failures !== null && failures > 0
              ? 'tabular-nums text-[var(--semantic-warning)]'
              : 'tabular-nums text-[var(--text-secondary)]';
          return <Text className={cls}>{formatCostReading(failures, fmtInt)}</Text>;
        },
      },
      {
        key: 'last',
        filterValue: (r) => r.last_seen_at ?? null,
        header: t('admin.vehicleCost.colLastSeen', 'Last seen'),
        render: (r) => (
          <Text color="primary">{formatRelative(r.last_seen_at)}</Text>
        ),
      },
    ],
    [t, fmtInt, fmtNumber, formatBytes, formatRelative],
  );

  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5">
      <PanelTitle className="mb-3">
        {t('admin.vehicleCost.tableTitle', 'Per-vehicle breakdown')}
      </PanelTitle>
      <SectionErrorBoundary name="vehicle-cost-table">
        {error ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : loading && vehicleRows.length === 0 ? (
          <Skeleton height={240} />
        ) : vehicleRows.length === 0 ? (
          // no-action: vehicles populate this view by ingesting telemetry; not a user-actionable surface
          <EmptyState
            icon={<Icons.wallet className="h-8 w-8" />}
            title={t('admin.vehicleCost.emptyTitle', 'No vehicle cost data')}
            message={t(
              'admin.vehicleCost.emptyMessage',
              'No vehicles have ingested signals during this window.',
            )}
          />
        ) : (
          <DataTable
            tableId="admin:vehicle-cost"
            columns={columns}
            mobileColumns={['vehicle', 'failures', 'last']}
            rowLabel={(r) => vehicleName(r, t('admin.vehicleCost.unnamed', 'Vehicle #{{id}}', { id: r.vehicle_id }))}
            mobilePresentation={{
              roles: {
                vehicle: 'title', rows: 'primary', bytes: 'meta',
                rate: 'hidden', failures: 'meta', last: 'meta',
              },
              displayValue: (r, key) => {
                switch (key) {
                  case 'vehicle': return vehicleName(r, t('admin.vehicleCost.unnamed', 'Vehicle #{{id}}', { id: r.vehicle_id }));
                  case 'rows': return formatCostReading(r.signal_row_count, fmtInt);
                  case 'bytes': return formatCostReading(r.signal_bytes_est, formatBytes);
                  case 'rate': return formatCostReading(r.ingest_rate_per_minute_24h, fmtNumber);
                  case 'failures': return formatCostReading(r.dlq_failures_24h, fmtInt);
                  case 'last': return formatRelative(r.last_seen_at);
                  default: return null;
                }
              },
            }}
            data={vehicleRows}
            enableValueFilters
            keyExtractor={(r) => r.vehicle_id}
            emptyMessage={t('admin.vehicleCost.emptyTable', 'No vehicle cost data')}
          />
        )}
      </SectionErrorBoundary>
    </GlassPanel>
  );
}
