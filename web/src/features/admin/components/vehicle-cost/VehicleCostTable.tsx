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
import { Wallet } from 'lucide-react';

import { GlassPanel, PanelTitle, Caption, Text, DataTable, type Column } from '@/components/ui';
import { Skeleton, EmptyState, QueryError, SectionErrorBoundary } from '@/components/feedback';
import { fmtNumber, fmtInt, formatBytes } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import { vehicleName, type SectionState } from './helpers';
import type { VehicleCostRow } from '@/types/admin-operator-confidence';

interface VehicleCostTableProps extends SectionState {
  vehicles: VehicleCostRow[];
}

export function VehicleCostTable({ vehicles, loading, error, onRetry }: VehicleCostTableProps) {
  const { t } = useTranslation();

  // Defensive: the page passes `data?.vehicles ?? []`, but guard here too so a
  // partial payload (or a future caller) can never crash the render on
  // `.length` — this section owns its own empty/loading states below.
  const vehicleRows = vehicles ?? [];

  const columns = useMemo<Column<VehicleCostRow>[]>(
    () => [
      {
        key: 'vehicle',
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
        header: t('admin.vehicleCost.colRows', 'Rows'),
        align: 'right',
        render: (r) => <Text className="tabular-nums">{fmtNumber(r.signal_row_count)}</Text>,
      },
      {
        key: 'bytes',
        header: t('admin.vehicleCost.colBytes', 'Bytes (est.)'),
        align: 'right',
        render: (r) => <Text className="tabular-nums">{formatBytes(r.signal_bytes_est)}</Text>,
      },
      {
        key: 'rate',
        header: t('admin.vehicleCost.colRate', 'Rate (rows/min, 24h)'),
        align: 'right',
        render: (r) => (
          <Text className="tabular-nums">{fmtNumber(r.ingest_rate_per_minute_24h, 1)}</Text>
        ),
      },
      {
        key: 'failures',
        header: t('admin.vehicleCost.colFailures', 'DLQ (24h)'),
        align: 'right',
        render: (r) => {
          const failures = r.dlq_failures_24h ?? 0;
          const cls =
            failures > 0
              ? 'tabular-nums text-amber-300'
              : 'tabular-nums text-[var(--text-secondary)]';
          return <Text className={cls}>{fmtNumber(failures)}</Text>;
        },
      },
      {
        key: 'last',
        header: t('admin.vehicleCost.colLastSeen', 'Last seen'),
        render: (r) => (
          <Text color="primary">{formatRelative(r.last_seen_at)}</Text>
        ),
      },
    ],
    [t],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
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
            icon={<Wallet className="h-8 w-8" />}
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
            data={vehicleRows}
            keyExtractor={(r) => r.vehicle_id}
            emptyMessage={t('admin.vehicleCost.emptyTable', 'No vehicle cost data')}
          />
        )}
      </SectionErrorBoundary>
    </GlassPanel>
  );
}
