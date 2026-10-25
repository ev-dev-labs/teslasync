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
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui';
import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { AlertBanner, DataStateNotice, SectionErrorBoundary } from '@/components/feedback';
import { useRangeState } from '@/hooks/useRangeState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicleCost } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import {
  CostByVehicleChart,
  VehicleCostTable,
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

  const { tz: timezone } = useDateFormat();
  const { startInstant, endInstantExclusive } = useRangeState({ timezone });
  const since = useMemo(() => new Date(startInstant), [startInstant]);
  const until = useMemo(() => new Date(endInstantExclusive), [endInstantExclusive]);
  const windowDays = Math.ceil((until.getTime() - since.getTime()) / 86_400_000);
  const rangeSupported = windowDays > 0 && windowDays <= 90;
  const query = useVehicleCost(since, 100, until, rangeSupported);
  const costState = deriveDataState(query);
  const subsystemMissing = isApiError(costState.fatalError)
    && costState.fatalError.status === 503
    && costState.fatalError.code === 'SUBSYSTEM_NOT_CONFIGURED';

  // When the confirmed subsystem-missing banner is already explaining the empty
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
    <Button variant="ghost" className="min-h-11 min-w-11 md:min-h-10" onClick={retry}
      disabled={query.isFetching || !rangeSupported} aria-busy={query.isFetching || undefined}
      aria-label={t('admin.vehicleCost.refresh', 'Refresh vehicle cost data')}>
      <RefreshCw className={query.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />
    </Button>
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
      <div className="min-w-0 space-y-6">
        {!rangeSupported && <AlertBanner variant="warning">{t('admin.vehicleCost.rangeLimit', 'Choose a workspace range of at most 90 days to view vehicle ingest cost.')}</AlertBanner>}
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
          <SectionErrorBoundary name="vehicle-cost-summary">
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
          </SectionErrorBoundary>
        </FadeIn>

        {/* 2 — Hero cost chart + top-talkers side panel */}
        <FadeIn delay={0.1}>
          <section
            aria-label={t('admin.vehicleCost.breakdownRegion', 'Ingest cost breakdown')}
            className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
          >
            <SectionErrorBoundary name="vehicle-cost-chart">
              <CostByVehicleChart
                bars={costBars}
                loading={costState.status === 'initial'}
                error={sectionError}
                onRetry={retry}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="vehicle-cost-talkers">
              <VehicleCostTalkers
                talkers={topTalkers}
                totalRows={totals?.total_rows}
                loading={costState.status === 'initial'}
                error={sectionError}
                onRetry={retry}
              />
            </SectionErrorBoundary>
          </section>
        </FadeIn>

        {/* 3 — Full-width per-vehicle breakdown table */}
        <FadeIn delay={0.2}>
          <SectionErrorBoundary name="vehicle-cost-breakdown">
            <VehicleCostTable
              vehicles={vehicles}
              loading={costState.status === 'initial'}
              error={sectionError}
              onRetry={retry}
            />
          </SectionErrorBoundary>
        </FadeIn>
      </div>
    </PageLayout>
  );
}
