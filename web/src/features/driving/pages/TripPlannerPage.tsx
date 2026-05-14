import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { PageContainer, Grid } from '@/components/layout';
import {
  GlassPanel, Button as ControlButton, Select as ControlSelect, Slider,
} from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { VehicleSelect } from '@/components/forms';
import { usePlanTrip } from '@/api/hooks/useDriving';
import { AddressInput } from '../components/AddressInput';
import { SOCRouteChart } from '../components/SOCRouteChart';
import { TripLegList } from '../components/TripLegList';
import { TripPlannerMap } from '../components/TripPlannerMap';
import {
  Navigation,
  Zap,
  Clock,
  Route,
  Battery,
  DollarSign,
  Thermometer,
  Send,
  AlertTriangle,
} from 'lucide-react';
import { request } from '@/api/client';
import type { TripLocation, TripPlan, TripPlanRequest } from '@/types/driving';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';

export default function TripPlannerPage() {
  const { t } = useTranslation();
  usePageTitle(t('tripPlanner.title', 'Trip Planner'));
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  const { vehicleId, vehicle: currentVehicle } = useSelectedVehicle();
  const planMutation = usePlanTrip();

  // Form state
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [origin, setOrigin] = useState<TripLocation | null>(null);
  const [destination, setDestination] = useState<TripLocation | null>(null);
  const [currentSOC, setCurrentSOC] = useState(80);
  const [minArrivalSOC, setMinArrivalSOC] = useState(20);
  const [speedFactor, setSpeedFactor] = useState(1.0);

  // Result state
  const [plan, setPlan] = useState<TripPlan | null>(null);

  const activeVehicle = vehicleId != null ? String(vehicleId) : '';

  const handlePlan = useCallback(() => {
    if (!origin || !destination || !activeVehicle) return;

    const req: TripPlanRequest = {
      vehicle_id: Number(activeVehicle),
      origin,
      destination,
      current_soc: currentSOC,
      charge_limit_soc: 90,
      min_arrival_soc: minArrivalSOC,
      preferences: {
        speed_factor: speedFactor,
        include_weather: true,
        prefer_superchargers: true,
      },
    };

    planMutation.mutate(req, {
      onSuccess: (data) => setPlan(data),
    });
  }, [origin, destination, activeVehicle, currentSOC, minArrivalSOC, speedFactor, planMutation]);

  const handleSendToCar = useCallback(async () => {
    if (!destination || !activeVehicle) return;
    try {
      await request(`/vehicles/${activeVehicle}/command`, {
        method: 'POST',
        body: JSON.stringify({
          command: 'navigation_request',
          params: { lat: destination.lat, lon: destination.lng },
        }),
      });
    } catch {
      // Error handled by mutation/toast
    }
  }, [destination, activeVehicle]);

  const canPlan = origin != null && destination != null && activeVehicle !== '';

  const speedOptions = useMemo(() => [
    { value: '0.8', label: t('tripPlanner.speed.relaxed', 'Relaxed (−20%)') },
    { value: '1.0', label: t('tripPlanner.speed.normal', 'Normal') },
    { value: '1.1', label: t('tripPlanner.speed.brisk', 'Brisk (+10%)') },
    { value: '1.2', label: t('tripPlanner.speed.fast', 'Fast (+20%)') },
  ], [t]);

  const route = plan?.route;
  const legs = plan?.legs ?? [];
  const chargeStops = plan?.charge_stops ?? [];
  const weather = plan?.weather_impact;
  const socCurve = plan?.soc_curve ?? [];

  return (
    <PageContainer
      title={t('tripPlanner.title', 'Trip Planner')}
      subtitle={t('tripPlanner.subtitle', 'Plan your route with range estimation and charging stops')}
      actions={<VehicleSelect />}
    >
      {/* Route Input Form */}
      <FadeIn>
        <GlassPanel className="p-6">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Navigation className="h-5 w-5 text-emerald-400" />
            {t('tripPlanner.form.title', 'Plan Your Trip')}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <AddressInput
              value={originText}
              onChange={setOriginText}
              onSelect={setOrigin}
              placeholder={t('tripPlanner.form.origin', 'Enter starting location...')}
              label={t('tripPlanner.form.from', 'From')}
            />
            <AddressInput
              value={destText}
              onChange={setDestText}
              onSelect={setDestination}
              placeholder={t('tripPlanner.form.destination', 'Enter destination...')}
              label={t('tripPlanner.form.to', 'To')}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            <Slider
              label={t('tripPlanner.form.currentSOC', 'Current SOC')}
              formatValue={(n) => `${n}%`}
              min={10}
              max={100}
              value={currentSOC}
              onChange={setCurrentSOC}
            />
            <Slider
              label={t('tripPlanner.form.minArrival', 'Min Arrival SOC')}
              formatValue={(n) => `${n}%`}
              min={5}
              max={50}
              value={minArrivalSOC}
              onChange={setMinArrivalSOC}
            />
            <ControlSelect
              label={t('tripPlanner.form.drivingSpeed', 'Driving Speed')}
              options={speedOptions}
              value={String(speedFactor)}
              onChange={(e) => setSpeedFactor(Number(e.target.value))}
            />
          </div>

          <div className="flex items-center gap-3">
            <ControlButton
              onClick={handlePlan}
              disabled={!canPlan || planMutation.isPending}
              className="gap-2"
            >
              <Route className="h-4 w-4" />
              {planMutation.isPending
                ? t('tripPlanner.form.planning', 'Planning...')
                : t('tripPlanner.form.planTrip', 'Plan Trip')}
            </ControlButton>
            {plan && destination && (
              <ControlButton
                onClick={handleSendToCar}
                variant="secondary"
                className="gap-2"
              >
                <Send className="h-4 w-4" />
                {t('tripPlanner.form.sendToCar', 'Send to Car')}
              </ControlButton>
            )}
            {currentVehicle?.battery_level != null && (
              <span className="text-sm text-[var(--text-muted)] flex items-center gap-1">
                <Battery className="h-3.5 w-3.5" />
                {t('tripPlanner.form.vehicleBattery', 'Vehicle at {{level}}%', {
                  level: currentVehicle.battery_level,
                })}
              </span>
            )}
          </div>

          {planMutation.isError && (
            <AlertBanner variant="danger" className="mt-3">
              {t('tripPlanner.form.error', 'Failed to compute trip plan. Please try again.')}
            </AlertBanner>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Estimate disclaimer */}
      {route?.is_estimate && (
        <FadeIn delay={0.02}>
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {t(
                'tripPlanner.disclaimer',
                'This is an estimate based on straight-line distance (×1.3 driving factor) and your vehicle\'s historical efficiency. Actual results may vary due to route geometry, traffic, elevation, and conditions.',
              )}
            </span>
          </div>
        </FadeIn>
      )}

      {/* Map */}
      <FadeIn delay={0.03}>
        <TripPlannerMap
          origin={origin}
          destination={destination}
          legs={legs}
          chargeStops={chargeStops}
        />
      </FadeIn>

      {/* Trip Summary Stats */}
      {route && (
        <FadeIn delay={0.04}>
          <Grid cols={{ default: 2, sm: 3, lg: 6 }} gap={4}>
            <StatCard
              label={t('tripPlanner.stats.distance', 'Distance')}
              value={`${toDistanceDisplay(route.total_distance_m).toFixed(0)} ${distanceUnit}`}
              icon={<Route className="h-4 w-4" />}
            />
            <StatCard
              label={t('tripPlanner.stats.totalTime', 'Total Time')}
              value={formatDuration(route.total_duration_s / 60)}
              icon={<Clock className="h-4 w-4" />}
            />
            <StatCard
              label={t('tripPlanner.stats.drivingTime', 'Driving')}
              value={formatDuration(route.driving_duration_s / 60)}
              icon={<Navigation className="h-4 w-4" />}
            />
            <StatCard
              label={t('tripPlanner.stats.chargingTime', 'Charging')}
              value={route.charging_duration_s > 0 ? formatDuration(route.charging_duration_s / 60) : '—'}
              icon={<Zap className="h-4 w-4" />}
            />
            <StatCard
              label={t('tripPlanner.stats.energy', 'Energy')}
              value={formatEnergy(route.total_energy_wh, { precision: 1 })}
              icon={<Battery className="h-4 w-4" />}
            />
            <StatCard
              label={t('tripPlanner.stats.cost', 'Est. Cost')}
              value={route.estimated_cost > 0 ? formatCurrency(route.estimated_cost) : t('common.free', 'Free')}
              icon={<DollarSign className="h-4 w-4" />}
            />
          </Grid>
        </FadeIn>
      )}

      {/* Feasibility warning */}
      {route && !route.feasible && (
        <FadeIn delay={0.05}>
          <AlertBanner variant="danger">
            {t(
              'tripPlanner.notFeasible',
              'This trip may not be feasible with the current battery level and available charging options. Consider starting with a higher SOC or adjusting your preferences.',
            )}
          </AlertBanner>
        </FadeIn>
      )}

      {/* Weather impact */}
      {weather && weather.efficiency_factor !== 1.0 && (
        <FadeIn delay={0.05}>
          <GlassPanel className="p-4">
            <div className="flex items-start gap-3">
              <Thermometer className="h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                  {t('tripPlanner.weather.title', 'Weather Impact')}
                </h4>
                <p className="text-sm text-[var(--text-secondary)] mt-1">{weather.note}</p>
                {weather.avg_temp_c != null && (
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {t('tripPlanner.weather.factor', 'Efficiency factor: {{factor}}×', {
                      factor: fmtNumber(weather.efficiency_factor, 2),
                    })}
                  </p>
                )}
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* SOC Route Chart */}
      <FadeIn delay={0.06}>
        <SOCRouteChart
          socCurve={socCurve}
          chargeStops={chargeStops}
          minArrivalSOC={minArrivalSOC}
        />
      </FadeIn>

      {/* Leg-by-leg breakdown */}
      <FadeIn delay={0.07}>
        <TripLegList legs={legs} chargeStops={chargeStops} />
      </FadeIn>
    </PageContainer>
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
