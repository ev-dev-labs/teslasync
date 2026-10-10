import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Car,
  RefreshCw, LayoutDashboard, BarChart3,
} from 'lucide-react';

import { PageLayout, Section } from '@/components/layout';
import { GlassPanel, Button, Caption } from '@/components/ui';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import { useDataState } from '@/hooks/useDataState';
import { FadeIn } from '@/components/motion';
import { VehicleHeroCard } from '@/components/vehicles';
import { FleetComparisonPanel } from '@/features/dashboard/components/FleetComparisonPanel';

import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useAnalyticsSummary } from '@/api/hooks/useAnalytics';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/** Fleet analytics distances are SI kilometres; efficiency is Wh/km. Convert at the boundary. */
const METERS_PER_KM = 1000;
const KM_PER_MILE = 1.609344;

const ANALYTICS_WINDOW_DAYS = 30;

export default function QuickStatsPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('quickStats.title', 'Quick stats'));
  const navigate = useNavigate();

  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  const fromKm = (km: number) => convertDistanceFromSI(km * METERS_PER_KM, distanceUnit);
  const whPerKmToDisplay = (whPerKm: number) =>
    distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;

  // Fleet-wide 30-day rollup (drives, energy, cost, per-vehicle comparison).
  const analyticsQuery = useAnalyticsSummary(ANALYTICS_WINDOW_DAYS);
  const {
    data: analytics,
    isLoading: analyticsLoading,
    refetch: refetchAnalytics,
  } = analyticsQuery;
  const analyticsState = useDataState(analyticsQuery, { provenance: 'historical' });
  const metrics: readonly StatMetric[] = [
    { metricId: 'distance', rawValue: analytics?.totalDistanceKm == null ? null : analytics.totalDistanceKm * METERS_PER_KM,
      label: t('quickStats.distanceDriven', 'Distance driven'),
      description: t('quickStats.summary.distanceHelp', 'Fleet distance over the last 30 days; source kilometres normalized to metres.'),
      display: { formatter: raw => ({ value: fmtNumber(fromKm(raw / METERS_PER_KM)), unit: distanceUnit }) } },
    { metricId: 'count', rawValue: analytics?.totalDrives, label: t('quickStats.drives', 'Drives'),
      description: t('quickStats.summary.drivesHelp', 'Fleet drive count in the 30-day rollup.') },
    { metricId: 'count', rawValue: analytics?.totalChargingSessions, label: t('quickStats.chargingSessions', 'Charging sessions'),
      description: t('quickStats.summary.sessionsHelp', 'Fleet charging-session count in the 30-day rollup.') },
    { metricId: 'energy', rawValue: analytics?.totalEnergyKwh == null ? null : analytics.totalEnergyKwh * 1000,
      label: t('quickStats.energyUsed', 'Energy used'),
      description: t('quickStats.summary.energyHelp', 'Fleet energy over the last 30 days; source kilowatt-hours normalized to watt-hours.'),
      display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'currency', rawValue: analytics?.totalCost, label: t('quickStats.totalCost', 'Total cost'),
      description: t('quickStats.summary.costHelp', 'Recorded fleet cost in the source denomination; no currency conversion.'),
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) } },
    { metricId: 'efficiency', rawValue: analytics?.avgEfficiencyWhKm == null ? null : analytics.avgEfficiencyWhKm / METERS_PER_KM,
      label: t('quickStats.avgEfficiency', 'Avg efficiency'),
      description: t('quickStats.summary.efficiencyHelp', 'Fleet average consumption over the last 30 days; source Wh/km normalized to Wh/m.'),
      display: { formatter: raw => ({ value: fmtNumber(whPerKmToDisplay(raw * METERS_PER_KM)), unit: efficiencyUnit }) } },
    { metricId: 'mass', rawValue: analytics?.co2SavedKg, label: t('quickStats.co2Saved', 'CO₂ saved'),
      description: t('quickStats.summary.carbonHelp', 'Source-reported fleet CO₂ savings in kilograms for the 30-day rollup.'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'kg' }) } },
    { metricId: 'count', rawValue: analytics?.totalVehicles, label: t('quickStats.fleetVehicles', 'Fleet vehicles'),
      description: t('quickStats.summary.vehiclesHelp', 'Fleet vehicle count reported by analytics, not the selected spotlight vehicle.') },
  ];

  // Workspace selection scopes the spotlight; the KPI band stays fleet-wide.
  const { vehicleId, vehicle } = useSelectedVehicle();
  const vehiclesQuery = useVehicles();
  const {
    isLoading: vehiclesLoading,
    refetch: refetchVehicles,
  } = vehiclesQuery;
  const vehiclesState = useDataState(vehiclesQuery);
  const stateQuery = useVehicleState(vehicleId ?? 0);
  const { data: stateData, refetch: refetchState } = stateQuery;
  const dataSources = useMemo(
    () => [
      {
        id: 'fleet-analytics',
        label: t('dataSources.labels.fleetAnalytics', 'Fleet analytics'),
        query: analyticsQuery,
      },
      {
        id: 'vehicle-registry',
        label: t('dataSources.labels.vehicleRegistry', 'Vehicle registry'),
        query: vehiclesQuery,
      },
      {
        id: 'live-vehicle-state',
        label: t('dataSources.labels.liveVehicleState', 'Live vehicle state'),
        query: stateQuery,
        enabled: vehicleId != null,
      },
    ],
    [analyticsQuery, stateQuery, t, vehicleId, vehiclesQuery],
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          refetchAnalytics();
          refetchState();
          refetchVehicles();
        }}
        aria-label={t('quickStats.refresh', 'Refresh quick stats')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <main>
    <PageLayout
      title={t('quickStats.title', 'Quick stats')}
      subtitle={t('quickStats.subtitle', 'Fleet snapshot · last 30 days')}
      actions={actions}
      query={[analyticsQuery, vehiclesQuery, stateQuery]}
      dataSources={dataSources}
    >
      <StaleRefreshWarning state={analyticsState} label={t('dataSources.labels.fleetAnalytics', 'Fleet analytics')} />
      <StaleRefreshWarning state={vehiclesState} label={t('dataSources.labels.vehicleRegistry', 'Vehicle registry')} />
      {/* 1 — Fleet KPI band: full-width responsive metric grid */}
      <FadeIn>
        <Section id="quick-stats-metrics" title={t('quickStats.kpis', 'Fleet metrics')}>
          <DashboardSourceBrief
            metrics={metrics}
            state={analyticsState}
            eyebrow={t('quickStats.summary.eyebrow', 'Fleet rollup')}
            title={t('quickStats.summary.title', 'Fleet operating summary')}
            description={t('quickStats.summary.description', 'Fleet-wide analytics for the last 30 days. The selected vehicle only scopes the spotlight; exact rollup bounds and source coverage are not supplied.')}
            scope={t('quickStats.summary.scope', 'All fleet vehicles · last 30 days')}
            loading={analyticsLoading && !analytics}
            testId="quick-stats-operational-brief"
          />
          {analyticsState.fatalError ? (
            <QueryError error={analyticsState.fatalError} onRetry={refetchAnalytics} />
          ) : !analytics && !analyticsLoading ? (
            <GlassPanel className="p-4 sm:p-5">
              <EmptyState
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('quickStats.noData', 'No fleet metrics available yet')}
                action={{ label: t('common.retry', 'Retry'), onClick: refetchAnalytics }}
              />
            </GlassPanel>
          ) : null}
        </Section>
      </FadeIn>

      {/* 2 — Spotlight bento: hero vehicle (spans wide) + fleet comparison */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('quickStats.spotlight', 'Vehicle spotlight')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <div className="xl:col-span-2">
            {vehiclesLoading && !vehicle ? (
              <GlassPanel className="p-4 sm:p-5">
                <Skeleton height={300} />
              </GlassPanel>
            ) : vehiclesState.fatalError ? (
              <GlassPanel className="p-4 sm:p-5">
                <QueryError error={vehiclesState.fatalError} onRetry={refetchVehicles} />
              </GlassPanel>
            ) : !vehicle ? (
              <GlassPanel className="p-4 sm:p-5">
                <EmptyState
                  icon={<Car className="h-8 w-8" />}
                  message={t('quickStats.noVehicle', 'No vehicle found')}
                  actionTo={{ label: t('quickStats.noVehicleCta', 'Go to vehicles'), to: '/vehicles' }}
                />
              </GlassPanel>
            ) : (
              <VehicleHeroCard
                vehicle={{
                  id: vehicle.id,
                  display_name: vehicle.display_name || t('quickStats.defaultName', 'Tesla'),
                  model: vehicle.model,
                  vin: vehicle.vin,
                  state: vehicle.state,
                }}
                vehicleState={stateData?.state ?? null}
              />
            )}
          </div>

          <FleetComparisonPanel
            entries={analytics?.vehicleComparison ?? []}
            loading={analyticsLoading && !analytics}
            error={analyticsState.fatalError}
            onRetry={refetchAnalytics}
            className="xl:col-span-1"
          />
        </section>
      </FadeIn>

      {/* 3 — Quick links: full-width navigation band */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<LayoutDashboard className="h-4 w-4" aria-hidden="true" />}
                onClick={() => navigate('/')}
              >
                {t('quickStats.openDashboard', 'Open dashboard')}
              </Button>
              {vehicle && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Car className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => navigate(`/vehicles/${vehicle.id}`)}
                >
                  {t('quickStats.vehicleDetails', 'Vehicle details')}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
                onClick={() => navigate('/statistics')}
              >
                {t('quickStats.viewAnalytics', 'View analytics')}
              </Button>
            </div>
            <Caption>{t('quickStats.footer', 'Powered by TeslaSync')}</Caption>
          </div>
        </GlassPanel>
      </FadeIn>
    </PageLayout>
    </main>
  );
}
