import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
  CheckCircle2,
  Info,
} from 'lucide-react';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, Select, Slider, PanelTitle, Text, Caption } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { VehicleSelect } from '@/components/forms';
import { AITripPlannerLLMAgent } from '@/components/ai/AITripPlannerLLMAgent';
import { usePlanTrip } from '@/api/hooks/useDriving';
import { useVehicleCommand } from '@/api/hooks/useVehicleCommand';
import { AddressInput } from '../components/AddressInput';
import { SOCRouteChart } from '../components/SOCRouteChart';
import { TripLegList } from '../components/TripLegList';
import { TripPlannerMap } from '../components/TripPlannerMap';
import { TripShareImportBanner } from '../components/TripShareImportBanner';
import { useTripShareTarget } from '../hooks/useTripShareTarget';
import type { TripLocation, TripPlan, TripPlanRequest } from '@/types/driving';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

const PLACEHOLDER = '—';

export default function TripPlannerPage() {
  const { t } = useTranslation();
  usePageTitle(t('tripPlanner.title', 'Trip Planner'));
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();
  const distanceUnit = unitPrefs.distance;

  const { vehicleId, vehicle: currentVehicle } = useSelectedVehicle();
  const planMutation = usePlanTrip();
  const commandMutation = useVehicleCommand();

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
  const canPlan = origin != null && destination != null && activeVehicle !== '';

  const handleSharedDestination = useCallback(
    ({ text, location }: { text: string; location: TripLocation | null }) => {
      setDestText(text);
      setDestination(location);
    },
    [],
  );
  const shareImport = useTripShareTarget(handleSharedDestination);

  const handleOriginTextChange = useCallback((value: string) => {
    setOriginText(value);
    setOrigin(null);
  }, []);

  const handleDestinationTextChange = useCallback((value: string) => {
    setDestText(value);
    setDestination(null);
  }, []);

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

  const handleSendToCar = useCallback(() => {
    if (!destination || !activeVehicle) return;
    commandMutation.mutate({
      vehicleId: Number(activeVehicle),
      command: 'navigation_request',
      params: { lat: destination.lat, lon: destination.lng },
    });
  }, [destination, activeVehicle, commandMutation]);

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

  // Stable input bag for the opt-in AI agent — grouped + memoized so the
  // memoized feature card doesn't re-render on unrelated state changes.
  const aiAgentInputs = useMemo(
    () => ({
      vehicleId: vehicleId ?? undefined,
      origin,
      destination,
      currentSoc: currentSOC,
      minArrivalSoc: minArrivalSOC,
      chargeLimitSoc: 90,
      speedFactor,
    }),
    [vehicleId, origin, destination, currentSOC, minArrivalSOC, speedFactor],
  );

  const kpis = useMemo(() => [
    {
      key: 'distance',
      label: t('tripPlanner.stats.distance', 'Distance'),
      value: route
        ? `${convertDistanceFromSI(route.total_distance_m, distanceUnit).toFixed(0)} ${distanceUnit}`
        : PLACEHOLDER,
      icon: <Route className="h-4 w-4" />,
      color: 'cyan' as const,
    },
    {
      key: 'totalTime',
      label: t('tripPlanner.stats.totalTime', 'Total Time'),
      value: route ? formatDuration(route.total_duration_s / 60) : PLACEHOLDER,
      icon: <Clock className="h-4 w-4" />,
      color: 'blue' as const,
    },
    {
      key: 'drivingTime',
      label: t('tripPlanner.stats.drivingTime', 'Driving'),
      value: route ? formatDuration(route.driving_duration_s / 60) : PLACEHOLDER,
      icon: <Navigation className="h-4 w-4" />,
      color: 'green' as const,
    },
    {
      key: 'chargingTime',
      label: t('tripPlanner.stats.chargingTime', 'Charging'),
      value: route && route.charging_duration_s > 0 ? formatDuration(route.charging_duration_s / 60) : PLACEHOLDER,
      icon: <Zap className="h-4 w-4" />,
      color: 'amber' as const,
    },
    {
      key: 'energy',
      label: t('tripPlanner.stats.energy', 'Energy'),
      value: route ? formatEnergy(route.total_energy_wh, { precision: 1 }) : PLACEHOLDER,
      icon: <Battery className="h-4 w-4" />,
      color: 'purple' as const,
    },
    {
      key: 'cost',
      label: t('tripPlanner.stats.cost', 'Est. Cost'),
      value: route
        ? (route.estimated_cost > 0 ? formatCurrency(route.estimated_cost) : t('common.free', 'Free'))
        : PLACEHOLDER,
      icon: <DollarSign className="h-4 w-4" />,
      color: 'green' as const,
    },
  ], [route, distanceUnit, formatEnergy, formatCurrency, t]);

  return (
    <PageContainer
      title={t('tripPlanner.title', 'Trip Planner')}
      subtitle={t('tripPlanner.subtitle', 'Plan your route with range estimation and charging stops')}
      actions={<VehicleSelect />}
    >
      {/* Opt-in AI trip-planner agent — renders zero DOM in off mode (ADR-015
          §I5+§I6). The deterministic form below is the canonical view. */}
      <FadeIn>
        <AITripPlannerLLMAgent {...aiAgentInputs} />
      </FadeIn>

      <TripShareImportBanner status={shareImport} />

      {/* Row 1 — Hero: control form (left rail) + route map (spans wide) */}
      <FadeIn>
        <section
          aria-label={t('tripPlanner.form.title', 'Plan Your Trip')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5 3xl:grid-cols-4"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Navigation className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('tripPlanner.form.title', 'Plan Your Trip')}
            </PanelTitle>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-1">
              <AddressInput
                value={originText}
                onChange={handleOriginTextChange}
                onSelect={setOrigin}
                placeholder={t('tripPlanner.form.origin', 'Enter starting location...')}
                label={t('tripPlanner.form.from', 'From')}
              />
              <AddressInput
                value={destText}
                onChange={handleDestinationTextChange}
                onSelect={setDestination}
                placeholder={t('tripPlanner.form.destination', 'Enter destination...')}
                label={t('tripPlanner.form.to', 'To')}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3 xl:grid-cols-1">
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
              <Select
                label={t('tripPlanner.form.drivingSpeed', 'Driving Speed')}
                options={speedOptions}
                value={String(speedFactor)}
                onChange={(e) => setSpeedFactor(Number(e.target.value))}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                onClick={handlePlan}
                disabled={!canPlan || planMutation.isPending}
                className="min-h-11 gap-2"
              >
                <Route className="h-4 w-4" aria-hidden="true" />
                {planMutation.isPending
                  ? t('tripPlanner.form.planning', 'Planning...')
                  : t('tripPlanner.form.planTrip', 'Plan Trip')}
              </Button>
              {plan && destination && (
                <Button
                  onClick={handleSendToCar}
                  variant="secondary"
                  disabled={commandMutation.isPending}
                  className="min-h-11 gap-2"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {t('tripPlanner.form.sendToCar', 'Send to Car')}
                </Button>
              )}
              {currentVehicle?.battery_level != null && (
                <Text as="span" variant="bodySm" className="flex items-center gap-1.5">
                  <Battery className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('tripPlanner.form.vehicleBattery', 'Vehicle at {{level}}%', {
                    level: currentVehicle.battery_level,
                  })}
                </Text>
              )}
            </div>

            {planMutation.isError && (
              <AlertBanner variant="danger" className="mt-4">
                {t('tripPlanner.form.error', 'Failed to compute trip plan. Please try again.')}
              </AlertBanner>
            )}
          </GlassPanel>

          <div className="xl:col-span-2 3xl:col-span-3">
            <TripPlannerMap
              origin={origin}
              destination={destination}
              legs={legs}
              chargeStops={chargeStops}
            />
          </div>
        </section>
      </FadeIn>

      {/* Row 2 — KPI band: always rendered, placeholders until a plan exists */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('tripPlanner.stats.title', 'Trip summary')}
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
        >
          {kpis.map((kpi) => (
            <MetricCard
              key={kpi.key}
              label={kpi.label}
              value={kpi.value}
              icon={kpi.icon}
              color={kpi.color}
            />
          ))}
        </section>
      </FadeIn>

      {/* Row 3 — Feasibility: loud, full-width critical alert when infeasible */}
      {route && !route.feasible && (
        <FadeIn delay={0.15}>
          <AlertBanner variant="danger" icon={<AlertTriangle className="h-5 w-5" />}>
            {t(
              'tripPlanner.notFeasible',
              'This trip may not be feasible with the current battery level and available charging options. Consider starting with a higher SOC or adjusting your preferences.',
            )}
          </AlertBanner>
        </FadeIn>
      )}

      {/* Row 4 — Analysis bento: SOC curve (hero) + trip insights side panel */}
      <FadeIn delay={0.2}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <div className="xl:col-span-2">
            <SOCRouteChart
              socCurve={socCurve}
              chargeStops={chargeStops}
              minArrivalSOC={minArrivalSOC}
            />
          </div>

          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Info className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('tripPlanner.insights.title', 'Trip Insights')}
            </PanelTitle>

            {!route ? (
              <EmptyState
                /* no-action: transient empty state — insights populate after a plan is computed */
                icon={<Route className="h-8 w-8" />}
                message={t('tripPlanner.insights.empty', 'Plan a trip to see feasibility, estimates, and weather impact.')}
              />
            ) : (
              <div className="space-y-3">
                <div
                  className={cn(
                    'flex items-start gap-2 rounded-lg border p-3',
                    route.feasible
                      ? 'border-emerald-500/20 bg-emerald-500/5'
                      : 'border-rose-500/20 bg-rose-500/5',
                  )}
                >
                  {route.feasible ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <Text as="p" size="sm" weight="medium" color="primary">
                      {route.feasible
                        ? t('tripPlanner.insights.feasible', 'Trip is feasible')
                        : t('tripPlanner.insights.infeasible', 'Trip may not be feasible')}
                    </Text>
                    <Text as="p" variant="bodySm" className="mt-0.5">
                      {route.feasible
                        ? t('tripPlanner.insights.feasibleNote', 'Reaches the destination above your minimum arrival SOC.')
                        : t('tripPlanner.insights.infeasibleNote', 'Start with a higher SOC or add charging headroom.')}
                    </Text>
                  </div>
                </div>

                {route.is_estimate && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                    <Text as="p" variant="bodySm">
                      {t(
                        'tripPlanner.disclaimer',
                        'This is an estimate based on straight-line distance (×1.3 driving factor) and your vehicle\'s historical efficiency. Actual results may vary due to route geometry, traffic, elevation, and conditions.',
                      )}
                    </Text>
                  </div>
                )}

                {weather && weather.efficiency_factor !== 1.0 ? (
                  <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <Thermometer className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                    <div className="min-w-0">
                      <Text as="p" size="sm" weight="medium" color="primary">
                        {t('tripPlanner.weather.title', 'Weather Impact')}
                      </Text>
                      <Text as="p" variant="bodySm" className="mt-0.5">{weather.note}</Text>
                      {weather.avg_temp_c != null && (
                        <Caption className="mt-1 block">
                          {t('tripPlanner.weather.factor', 'Efficiency factor: {{factor}}×', {
                            factor: fmtNumber(weather.efficiency_factor, 2),
                          })}
                        </Caption>
                      )}
                    </div>
                  </div>
                ) : (
                  <Caption className="block">
                    {t('tripPlanner.insights.noWeather', 'No significant weather impact expected.')}
                  </Caption>
                )}
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* Row 5 — Leg-by-leg breakdown: full-width detail band */}
      <FadeIn delay={0.25}>
        <TripLegList legs={legs} chargeStops={chargeStops} />
      </FadeIn>
    </PageContainer>
  );
}

function formatDuration(minutes: number): string {
  // API-sourced durations can be malformed (NaN/Infinity) or negative — never
  // render "NaNm" or a negative clock in a KPI tile.
  if (!Number.isFinite(minutes) || minutes < 0) return PLACEHOLDER;
  // Round to whole minutes *before* splitting so a fractional value that rounds
  // up to 60 (e.g. 119.99 → "1h 60m") rolls over into the next hour ("2h 0m")
  // instead of showing an impossible 60-minute remainder.
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
