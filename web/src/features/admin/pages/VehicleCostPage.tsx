/**
 * Vehicle Ingest Cost page.
 *
 * Per-vehicle telemetry ingest cost report over a trailing window: signal_log
 * row count, estimated byte cost, 24 h ingest rate, and DLQ failures. The page
 * is a full-width modern-ui bento:
 *
 *   1. Fleet-total KPI band (rows, bytes, rate, DLQ failures + derived
 *      vehicles-tracked and avg rows/vehicle) that reflows 2 → 3 → 6 columns.
 *   2. Hero "ingest cost by vehicle" bar chart (heaviest consumer highlighted)
 *      beside a "top talkers" share-of-rows side panel on wide screens.
 *   3. Full-width per-vehicle breakdown table.
 *
 * Operators use this to spot vehicles whose telemetry volume is
 * disproportionate to their value (e.g. a misconfigured Fleet Telemetry agent
 * firehosing every signal at 1 Hz).
 *
 * Backed by GET /api/v1/admin/observability/vehicle-cost
 * (internal/handler/v1/admin_observability_handler.go). The counters are
 * operational (counts / bytes / rates) — no physical measurement units, so no
 * unit conversion is required; bytes are formatted at the display boundary.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { DataStateNotice } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicleCost } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import {
  CostByVehicleChart,
  FleetCostKpis,
  TopTalkersPanel,
  VehicleCostTable,
  VehicleCostToolbar,
  rankVehicles,
  vehicleName,
  TOP_N,
} from '../components/vehicle-cost';
import type { VehicleCostRow } from '@/types/admin-operator-confidence';

// Stable empty-array reference for the no-data state. Feeding a fresh `[]`
// into the `costBars` / `topTalkers` `useMemo` dependency lists on every
// render would invalidate them needlessly before the first successful fetch
// lands; a shared constant keeps the derives stable.
const EMPTY_VEHICLES: VehicleCostRow[] = [];

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

  // When the 503 subsystem-missing banner is already explaining the empty
  // page, suppress the raw query error for the individual sections so they
  // render calm empty states instead of a duplicate "server error" panel.
  const sectionError = subsystemMissing ? null : query.error;
  const retry = () => {
    void query.refetch();
  };

  const vehicles = query.data?.vehicles ?? EMPTY_VEHICLES;
  const totals = query.data?.totals;

  const nameOf = useMemo(
    () => (row: VehicleCostRow) =>
      vehicleName(row, t('admin.vehicleCost.unnamed', 'Vehicle #{{id}}', { id: row.vehicle_id })),
    [t],
  );

  const costBars = useMemo(
    () => rankVehicles(vehicles, nameOf, 'bytes', TOP_N),
    [vehicles, nameOf],
  );
  const topTalkers = useMemo(
    () => rankVehicles(vehicles, nameOf, 'rows', TOP_N),
    [vehicles, nameOf],
  );

  const actions = (
    <VehicleCostToolbar
      windowDays={windowDays}
      onWindowChange={setWindowDays}
      onRefresh={retry}
      refreshing={query.isFetching}
    />
  );

  return (
    <PageContainer
      title={t('admin.vehicleCost.pageTitle', 'Vehicle Ingest Cost')}
      subtitle={t(
        'admin.vehicleCost.subtitle',
        'Per-vehicle telemetry cost over the selected window. Use this to spot vehicles whose ingest volume is disproportionate to the fleet baseline.',
      )}
      actions={actions}
      query={query}
    >
      <div className="space-y-6">
        {subsystemMissing && (
          <DataStateNotice
            state="unsupported"
            title={t('admin.subsystem.unsupportedTitle', 'Feature not supported')}
          >
            {t(
              'admin.vehicleCost.notConfigured',
              'The ingest-x-ray subsystem is not configured on this deployment. Vehicle cost reporting requires the signal_log hypertable to be populated.',
            )}
          </DataStateNotice>
        )}

        {/* 1 — Fleet-total KPI band */}
        <FadeIn>
          <FleetCostKpis
            totals={totals}
            vehicleCount={vehicles.length}
            windowDays={windowDays}
            loading={query.isLoading}
            error={sectionError}
            onRetry={retry}
          />
        </FadeIn>

        {/* 2 — Hero cost chart + top-talkers side panel */}
        <FadeIn delay={0.1}>
          <section
            aria-label={t('admin.vehicleCost.breakdownRegion', 'Ingest cost breakdown')}
            className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
          >
            <CostByVehicleChart
              bars={costBars}
              loading={query.isLoading}
              error={sectionError}
              onRetry={retry}
            />
            <TopTalkersPanel
              talkers={topTalkers}
              totalRows={totals?.total_rows ?? 0}
              loading={query.isLoading}
              error={sectionError}
              onRetry={retry}
            />
          </section>
        </FadeIn>

        {/* 3 — Full-width per-vehicle breakdown table */}
        <FadeIn delay={0.2}>
          <VehicleCostTable
            vehicles={vehicles}
            loading={query.isLoading}
            error={sectionError}
            onRetry={retry}
          />
        </FadeIn>
      </div>
    </PageContainer>
  );
}
