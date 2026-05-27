/**
 * Vehicle Cost Page — Phase-45 admin observability surface.
 *
 * Per-vehicle ingest cost report: signal_log row count, estimated
 * byte cost, ingest rate over the last 24 h, and DLQ failures. Shows
 * a fleet-total summary card row up top and a sortable per-vehicle
 * table below. Operators use this to spot vehicles whose telemetry
 * volume is disproportionate to their value (e.g. a misconfigured
 * Fleet Telemetry agent firehosing every signal at 1 Hz).
 *
 * Backed by GET /api/v1/admin/observability/vehicle-cost
 * (internal/handler/v1/admin_observability_handler.go).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, DataTable, type Column } from '@/components/ui';
import { PanelTitle, Caption } from '@/components/ui/Typography';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState, AlertBanner, SectionErrorBoundary } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, formatBytes } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import { useVehicleCost } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type { VehicleCostRow } from '@/types/admin-operator-confidence';

const WINDOW_OPTIONS: ReadonlyArray<{ days: number; labelKey: string; fallback: string }> = [
  { days: 1, labelKey: 'admin.vehicleCost.window1d', fallback: 'Last 1 day' },
  { days: 7, labelKey: 'admin.vehicleCost.window7d', fallback: 'Last 7 days' },
  { days: 30, labelKey: 'admin.vehicleCost.window30d', fallback: 'Last 30 days' },
  { days: 90, labelKey: 'admin.vehicleCost.window90d', fallback: 'Last 90 days' },
];

export default function VehicleCostPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.vehicleCost.pageTitle', 'Vehicle Ingest Cost'));

  const [windowDays, setWindowDays] = useState<number>(30);
  const since = useMemo(
    () => new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000),
    [windowDays],
  );

  const query = useVehicleCost(since, 100);
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const vehicles = query.data?.vehicles ?? [];
  const totals = query.data?.totals;

  const columns = useMemo<Column<VehicleCostRow>[]>(
    () => [
      {
        key: 'vehicle',
        header: t('admin.vehicleCost.colVehicle', 'Vehicle'),
        render: (r) => (
          <div className="flex flex-col">
            <span className="font-medium text-[var(--text-primary)]">
              {r.display_name ?? t('admin.vehicleCost.unnamed', 'Vehicle #{{id}}', { id: r.vehicle_id })}
            </span>
            <Caption>ID {fmtNumber(r.vehicle_id)}</Caption>
          </div>
        ),
      },
      {
        key: 'rows',
        header: t('admin.vehicleCost.colRows', 'Rows'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.signal_row_count)}</span>,
      },
      {
        key: 'bytes',
        header: t('admin.vehicleCost.colBytes', 'Bytes (est.)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{formatBytes(r.signal_bytes_est)}</span>,
      },
      {
        key: 'rate',
        header: t('admin.vehicleCost.colRate', 'Rate (rows/min, 24h)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.ingest_rate_per_minute_24h, 1)}</span>,
      },
      {
        key: 'failures',
        header: t('admin.vehicleCost.colFailures', 'DLQ (24h)'),
        align: 'right',
        render: (r) => {
          const failures = r.dlq_failures_24h ?? 0;
          const cls = failures > 0 ? 'text-amber-300 tabular-nums' : 'tabular-nums text-[var(--text-secondary)]';
          return <span className={cls}>{fmtNumber(failures)}</span>;
        },
      },
      {
        key: 'last',
        header: t('admin.vehicleCost.colLastSeen', 'Last seen'),
        render: (r) => (
          <span className="text-[var(--text-primary)]">{formatRelative(r.last_seen_at)}</span>
        ),
      },
    ],
    [t],
  );

  return (
    <PageContainer
      title={t('admin.vehicleCost.pageTitle', 'Vehicle Ingest Cost')}
      subtitle={t(
        'admin.vehicleCost.subtitle',
        'Per-vehicle telemetry cost over the selected window. Use this to spot vehicles whose ingest volume is disproportionate to the fleet baseline.',
      )}
      query={query}
    >
      <FadeIn>
        <div className="space-y-6">
          {subsystemMissing && (
            <AlertBanner variant="warning" title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
              {t(
                'admin.vehicleCost.notConfigured',
                'The ingest-x-ray subsystem is not configured on this deployment. Vehicle cost reporting requires the signal_log hypertable to be populated.',
              )}
            </AlertBanner>
          )}

          {totals && <FleetTotalsCards totals={totals} windowDays={windowDays} />}

          <GlassPanel className="p-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
              <PanelTitle>{t('admin.vehicleCost.tableTitle', 'Per-vehicle breakdown')}</PanelTitle>
              <label className="flex items-center gap-2">
                <Caption>{t('admin.vehicleCost.windowLabel', 'Window')}</Caption>
                <Select
                  value={String(windowDays)}
                  onChange={(e) => setWindowDays(Number(e.target.value))}
                  options={WINDOW_OPTIONS.map((opt) => ({
                    value: String(opt.days),
                    label: t(opt.labelKey, opt.fallback),
                  }))}
                />
              </label>
            </div>
            <SectionErrorBoundary name="vehicle-cost-table">
              {vehicles.length === 0 && !query.isLoading && !subsystemMissing ? (
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
                  data={vehicles}
                  keyExtractor={(r) => r.vehicle_id}
                  emptyMessage={t('admin.vehicleCost.emptyTable', 'No vehicle cost data')}
                />
              )}
            </SectionErrorBoundary>
          </GlassPanel>
        </div>
      </FadeIn>
    </PageContainer>
  );
}

interface FleetTotalsCardsProps {
  totals: NonNullable<ReturnType<typeof useVehicleCost>['data']>['totals'];
  windowDays: number;
}

function FleetTotalsCards({ totals, windowDays }: FleetTotalsCardsProps) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label={t('admin.vehicleCost.totalRows', 'Total rows')}
        value={fmtNumber(totals.total_rows)}
        sublabel={t('admin.vehicleCost.windowSub', 'Window: {{days}}d', { days: windowDays })}
      />
      <StatCard
        label={t('admin.vehicleCost.totalBytes', 'Total bytes (est.)')}
        value={formatBytes(totals.total_bytes_est)}
        sublabel={t('admin.vehicleCost.bytesSub', '96 bytes/row average')}
      />
      <StatCard
        label={t('admin.vehicleCost.totalRate', 'Rate (rows/min, 24h)')}
        value={fmtNumber(totals.total_rate_per_minute_24h, 1)}
        sublabel={t('admin.vehicleCost.rateSub', 'Across all vehicles')}
      />
      <StatCard
        label={t('admin.vehicleCost.totalFailures', 'DLQ failures (24h)')}
        value={fmtNumber(totals.total_failures_24h)}
        sublabel={t('admin.vehicleCost.failuresSub', 'Codec or writer rejections')}
      />
    </div>
  );
}
