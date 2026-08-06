import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Car, MapPin, Route, BatteryCharging, Zap, DollarSign, Gauge, Leaf,
  RefreshCw, LayoutDashboard, BarChart3,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, Button, Caption } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, StatGridSkeleton } from '@/components/feedback';
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
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

/** Fleet analytics distances are SI kilometres; efficiency is Wh/km. Convert at the boundary. */
const METERS_PER_KM = 1000;
const KM_PER_MILE = 1.609344;

const ANALYTICS_WINDOW_DAYS = 30;

export default function QuickStatsPage() {
  const { t } = useTranslation();
  usePageTitle(t('quickStats.title', 'Quick Stats'));
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
    error: analyticsError,
    refetch: refetchAnalytics,
  } = analyticsQuery;

  // Spotlight vehicle: URL > sticky store > first vehicle. The picker only
  // re-scopes the spotlight — the KPI band stays fleet-wide.
  const { vehicleId, vehicle, vehicles, setVehicleId } = useSelectedVehicle();
  const { isLoading: vehiclesLoading, error: vehiclesError, refetch: refetchVehicles } = useVehicles();
  const stateQuery = useVehicleState(vehicleId ?? 0);
  const { data: stateData, refetch: refetchState } = stateQuery;

  const onPickVehicle = (id: string) => {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0) setVehicleId(n);
  };

  const vehicleOptions = vehicles.map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {vehicles.length > 1 && (
        <Select
          options={vehicleOptions}
          value={vehicleId != null ? String(vehicleId) : ''}
          onChange={(e) => onPickVehicle(e.target.value)}
          placeholder={t('quickStats.selectVehicle', 'Select vehicle')}
          aria-label={t('quickStats.selectVehicle', 'Select vehicle')}
          size="sm"
        />
      )}
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
    <PageContainer
      title={t('quickStats.title', 'Quick Stats')}
      subtitle={t('quickStats.subtitle', 'Fleet snapshot · last 30 days')}
      actions={actions}
      query={[analyticsQuery, stateQuery]}
    >
      {/* 1 — Fleet KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section aria-label={t('quickStats.kpis', 'Fleet metrics')}>
          {analyticsLoading ? (
            <StatGridSkeleton cards={8} />
          ) : analyticsError ? (
            <QueryError error={analyticsError} onRetry={refetchAnalytics} />
          ) : !analytics ? (
            <GlassPanel className="p-4 sm:p-5">
              <EmptyState
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('quickStats.noData', 'No fleet metrics available yet')}
                action={{ label: t('common.retry', 'Retry'), onClick: refetchAnalytics }}
              />
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-8">
              <MetricCard
                label={t('quickStats.distanceDriven', 'Distance Driven')}
                value={`${fmtInt(fromKm(analytics.totalDistanceKm ?? 0))} ${distanceUnit}`}
                icon={<MapPin className="h-4 w-4" />}
                color="cyan"
              />
              <MetricCard
                label={t('quickStats.drives', 'Drives')}
                value={fmtInt(analytics.totalDrives ?? 0)}
                icon={<Route className="h-4 w-4" />}
                color="green"
              />
              <MetricCard
                label={t('quickStats.chargingSessions', 'Charging Sessions')}
                value={fmtInt(analytics.totalChargingSessions ?? 0)}
                icon={<BatteryCharging className="h-4 w-4" />}
                color="blue"
              />
              <MetricCard
                label={t('quickStats.energyUsed', 'Energy Used')}
                value={formatEnergy((analytics.totalEnergyKwh ?? 0) * 1000)}
                icon={<Zap className="h-4 w-4" />}
                color="amber"
              />
              <MetricCard
                label={t('quickStats.totalCost', 'Total Cost')}
                value={formatCurrency(analytics.totalCost ?? 0, 0)}
                icon={<DollarSign className="h-4 w-4" />}
                color="purple"
              />
              <MetricCard
                label={t('quickStats.avgEfficiency', 'Avg Efficiency')}
                value={`${fmtNumber(whPerKmToDisplay(analytics.avgEfficiencyWhKm ?? 0))} ${efficiencyUnit}`}
                icon={<Gauge className="h-4 w-4" />}
                color="green"
              />
              <MetricCard
                label={t('quickStats.co2Saved', 'CO₂ Saved')}
                value={`${fmtNumber(analytics.co2SavedKg ?? 0)} kg`}
                icon={<Leaf className="h-4 w-4" />}
                color="green"
              />
              <MetricCard
                label={t('quickStats.fleetVehicles', 'Fleet Vehicles')}
                value={fmtInt(analytics.totalVehicles ?? 0)}
                icon={<Car className="h-4 w-4" />}
                color="cyan"
              />
            </div>
          )}
        </section>
      </FadeIn>

      {/* 2 — Spotlight bento: hero vehicle (spans wide) + fleet comparison */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('quickStats.spotlight', 'Vehicle spotlight')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <div className="xl:col-span-2">
            {vehiclesLoading ? (
              <GlassPanel className="p-4 sm:p-5">
                <Skeleton height={300} />
              </GlassPanel>
            ) : vehiclesError ? (
              <GlassPanel className="p-4 sm:p-5">
                <QueryError error={vehiclesError} onRetry={refetchVehicles} />
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
            loading={analyticsLoading}
            error={analyticsError}
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
                {t('quickStats.openDashboard', 'Open Dashboard')}
              </Button>
              {vehicle && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Car className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => navigate(`/vehicles/${vehicle.id}`)}
                >
                  {t('quickStats.vehicleDetails', 'Vehicle Details')}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
                onClick={() => navigate('/statistics')}
              >
                {t('quickStats.viewAnalytics', 'View Analytics')}
              </Button>
            </div>
            <Caption>{t('quickStats.footer', 'Powered by TeslaSync')}</Caption>
          </div>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
