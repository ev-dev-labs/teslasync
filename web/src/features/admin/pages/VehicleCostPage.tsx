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

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { DataStateNotice } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicleCost } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import {
  CostByVehicleChart,
  VehicleCostTable,
  VehicleCostToolbar,
  rankVehicles,
  vehicleName,
  TOP_N,
} from '../components/vehicle-cost';
import type { VehicleCostRow } from '@/types/admin-operator-confidence';
import { deriveDataState } from '@/api/dataState';
import { VehicleCostStatStrip } from '../components/statstrip-audit-vehicle-cost/VehicleCostStatStrip';
import { VehicleCostTalkers } from '../components/continuation-admin-1/VehicleCostTalkers';

// Stable empty-array reference for the no-data state. Feeding a fresh `[]`
// into the `costBars` / `topTalkers` `useMemo` dependency lists on every
// render would invalidate them needlessly before the first successful fetch
// lands; a shared constant keeps the derives stable.
const EMPTY_VEHICLES: VehicleCostRow[] = [];

export default function VehicleCostPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.vehicleCost.pageTitle', 'Vehicle ingest cost'));

  const [windowDays, setWindowDays] = useState<number>(30);
  const since = useMemo(
    () => new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000),
    [windowDays],
  );

  const query = useVehicleCost(since, 100);
  const costState = deriveDataState(query);
  const subsystemMissing = isApiError(costState.fatalError) && costState.fatalError.status === 503;

  // When the 503 subsystem-missing banner is already explaining the empty
  // page, suppress the raw query error for the individual sections so they
  // render calm empty states instead of a duplicate "server error" panel.
  const sectionError = subsystemMissing ? null : costState.fatalError;
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
    <PageLayout
      title={t('admin.vehicleCost.pageTitle', 'Vehicle ingest cost')}
      subtitle={t(
        'admin.vehicleCost.subtitle',
        'Per-vehicle telemetry cost over the selected window. Use this to spot vehicles whose ingest volume is disproportionate to the fleet baseline.',
      )}
      contextActions={actions}
      query={query}
      dataSources={!subsystemMissing
        ? [{ id: 'vehicle-cost', label: t('admin.vehicleCost.pageTitle', 'Vehicle ingest cost'), query }]
        : undefined}
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
          <VehicleCostStatStrip
            totals={totals}
            vehicleCount={Array.isArray(query.data?.vehicles) ? vehicles.length : null}
            windowDays={windowDays}
            loading={costState.status === 'initial'}
            error={sectionError}
            refreshError={costState.refreshError}
            retained={costState.hasData && (costState.isRefreshing || costState.status === 'stale')}
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
              loading={costState.status === 'initial'}
              error={sectionError}
              onRetry={retry}
            />
            <VehicleCostTalkers
              talkers={topTalkers}
              totalRows={totals?.total_rows}
              loading={costState.status === 'initial'}
              error={sectionError}
              onRetry={retry}
            />
          </section>
        </FadeIn>

        {/* 3 — Full-width per-vehicle breakdown table */}
        <FadeIn delay={0.2}>
          <VehicleCostTable
            vehicles={vehicles}
            loading={costState.status === 'initial'}
            error={sectionError}
            onRetry={retry}
          />
        </FadeIn>
      </div>
    </PageLayout>
  );
}
