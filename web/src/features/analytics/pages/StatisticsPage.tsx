import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Car, Clock } from 'lucide-react';

import { PageLayout, Section, CardGrid, ChartCard } from '@/components/layout';
import { Button } from '@/components/ui';
import { SavedViewMenu, DataFreshnessAuto } from '@/components/data-display';
import {
  ChartTooltip, ChartLegend,
  chartGrid, axisTickSm,
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useFleetAnalytics, useMileageStats, useStateSummary } from '@/api/hooks/useAnalytics';
import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useRangeState } from '@/hooks/useRangeState';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import { request } from '@/api/client';
import {
  PeriodStatistics, BatteryStatistics, MileageStatistics,
  StatisticsChartPlacement, StatisticsSource, type PeriodStats,
} from '../components/statistics-modernization';

const KM_PER_MILE = 1.609344;
const METERS_PER_KM = 1000;

const STATE_COLORS: Record<string, string> = {
  driving: '#10b981',
  charging: '#00f0ff',
  parked: '#f59e0b',
  sleeping: '#64748b',
  online: '#3b82f6',
  idle: '#a855f7',
};

/* ── Page ─────────────────────────────────────────────────────────── */

export default function StatisticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('statistics.title', 'Statistics'));
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend `total_distance` and `vehicle_comparison[].distance` are SI km;
  // `avg_efficiency` is SI Wh/km. Convert at the display boundary so values
  // match the user's distance-unit preference.
  // Memoised so the derived `compData`/`stateData` charts keep a stable
  // dependency identity across re-renders (they close over `fromKm`).
  const fromKm = useCallback(
    (km: number) => convertDistanceFromSI(km * METERS_PER_KM, distanceUnit),
    [distanceUnit],
  );
  const whPerKmToDisplay = useCallback(
    (whPerKm: number) => (distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm),
    [distanceUnit],
  );
  const savedView = useSavedViewUrl();

  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const { start: startDate, end: endDate } = useRangeState({
    persistKey: 'statistics.range',
    defaultPresetId: '1y',
  });

  // Reactive chart palette: color-blind safe or neon per user preference.
  const palette = useChartPalette();

  // Persist hidden series in the URL so users can isolate one fleet metric
  // across the multi-vehicle distance/energy bar chart.
  const fleetCompareHidden = useHiddenSeries('fleet-vehicle-comparison');

  /* ── Data hooks ────────────────────────────────────────────────── */
  const statsQuery = useQuery({
    queryKey: ['period-stats', activeId],
    queryFn: () => request<PeriodStats>(`/analytics/period-stats?vehicle_id=${activeId}`),
    enabled: !!activeId,
  });
  const { data: stats, isLoading: statsLoading, error: statsError, refetch } = statsQuery;

  const batteryQuery = useBatteryHealthAnalytics(activeId || null);
  const mileageQuery = useMileageStats(activeId);
  const stateQuery = useStateSummary(activeId);
  const { data: stateSummary, isLoading: stateLoading } = stateQuery;
  const fleetQuery = useFleetAnalytics({ start: startDate, end: endDate });
  const { data: fleet, isLoading: fleetLoading, error: fleetError } = fleetQuery;

  /* ── Derived ───────────────────────────────────────────────────── */
  const stateData = useMemo(() => {
    if (!stateSummary?.length) return [];
    // Preserve both existing minute shapes at the display boundary.
    // The restored endpoint and inherited hook contract are parent-owned;
    // this presentation change does not reinterpret either source.
    const total = stateSummary.reduce((s, e) => {
      const minutes = (e as { totalMin?: number; total_min?: number }).totalMin
        ?? (e as { total_min?: number }).total_min ?? 0;
      return s + minutes;
    }, 0);
    return stateSummary.map((e) => {
      const minutes = (e as { totalMin?: number; total_min?: number }).totalMin
        ?? (e as { total_min?: number }).total_min ?? 0;
      return {
        name: e.state,
        value: Math.round((minutes / Math.max(total, 1)) * 100),
        fill: STATE_COLORS[e.state] ?? palette[5],
      };
    });
  }, [stateSummary, palette]);

  const compData = useMemo(() => {
    if (!fleet?.vehicle_comparison) return [];
    return fleet.vehicle_comparison.map((v) => ({
      name: v.name ?? `Vehicle ${v.id}`,
      distance: Math.round(fromKm(v.distance)),
      energy: Math.round(v.energy),
    }));
  }, [fleet, fromKm]);

  /* ── Toolbar ───────────────────────────────────────────────────── */
  const refreshAction = (
    <Button
      size="sm"
      onClick={() => { void refetch(); }}
      aria-label={t('common.refresh', 'Refresh')}
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  );

  /* ── Render ────────────────────────────────────────────────────── */
  return (
    <PageLayout
      title={t('statistics.title', 'Statistics')}
      subtitle={t('statistics.subtitle', 'Lifetime vehicle statistics and records')}
      metadataActions={<DataFreshnessAuto query={statsQuery} />}
      secondaryActions={refreshAction}
      overflowActions={
        <SavedViewMenu
          route="/statistics"
          currentQuery={savedView.currentQuery}
          onApply={savedView.apply}
        />
      }
    >
      {/* Period totals and averages retain the original source and scope. */}
      <Section id="statistics-period" title={t('statistics.periodSummary', 'Totals and averages')}>
        <FadeIn>
          <CardGrid label={t('statistics.periodSummary', 'Totals and averages')} items={[{
            id: 'statistics-period',
            size: 'full',
            content: <PeriodStatistics
              stats={stats}
              loading={statsLoading}
              error={statsError}
              onRetry={() => { void refetch(); }}
              fromKm={fromKm}
              whPerKmToDisplay={whPerKmToDisplay}
              distanceUnit={distanceUnit}
              efficiencyUnit={efficiencyUnit}
            />,
          }]} />
        </FadeIn>
      </Section>

      <Section id="statistics-health-state" title={t('statistics.healthAndState', 'Battery health and vehicle states')}>
        <FadeIn delay={0.1}>
          <CardGrid label={t('statistics.healthAndState', 'Battery health and vehicle states')} items={[
            { id: 'statistics-battery', size: 'half', content: <BatteryStatistics query={batteryQuery} /> },
            { id: 'statistics-state', size: 'half', content: (
          <StatisticsChartPlacement>
          <ChartCard
            size="standard"
            title={t('statistics.stateDistribution', 'State distribution')}
            ariaLabel={t('statistics.stateDistribution.aria', 'Vehicle state distribution pie chart')}
            exportable
            exportFilename="state-distribution"
            height={280}
            data={stateData}
            dataColumns={[
              { key: 'name', label: t('timeline.toState', 'To state') },
              { key: 'value', label: t('statistics.stateShare', 'Share of recorded state time (%)') },
            ]}
            exportData={stateData}
          >
            <StatisticsSource
              hasData={stateSummary != null}
              emptyWhen={stateData.length === 0}
              loading={stateLoading}
              error={stateQuery.error}
              onRetry={() => { void stateQuery.refetch(); }}
              skeleton={<Skeleton className="h-full w-full rounded-xl" />}
              empty={
                <EmptyState
                  icon={<Clock className="h-8 w-8" aria-hidden="true" />}
                  message={t('statistics.noStates', 'No state distribution data')}
                  description={t('statistics.noStatesDescription', 'Driving, charging, and parked-state history will populate this distribution over time.')}
                  actionTo={{ label: t('routes.stateMachineDebugger', 'State machine debugger'), to: '/state-debugger' }}
                  className="py-8"
                />
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stateData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3}>
                    {stateData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Legend />
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </StatisticsSource>
          </ChartCard>
          </StatisticsChartPlacement>
            ) },
          ]} />
        </FadeIn>
      </Section>

      <Section id="statistics-mileage-fleet" title={t('statistics.mileageAndFleet', 'Mileage and fleet comparison')}>
        <FadeIn delay={0.2}>
          <CardGrid label={t('statistics.mileageAndFleet', 'Mileage and fleet comparison')} items={[
            { id: 'statistics-mileage', size: 'third', content: <MileageStatistics query={mileageQuery} fromKm={fromKm} distanceUnit={distanceUnit} /> },
            { id: 'statistics-fleet', size: 'half', content: (
          <StatisticsChartPlacement>
          <ChartCard
            size="standard"
            title={t('statistics.vehicleComparison', 'Vehicle comparison')}
            ariaLabel={t('statistics.vehicleComparison.aria', 'Distance and energy bar chart comparing all vehicles in the fleet')}
            chartKey="fleet-vehicle-comparison"
            exportable
            exportFilename="vehicle-comparison"
            height={300}
            data={compData}
            dataColumns={[
              { key: 'name', label: t('compare.vehicle', 'Vehicle') },
              { key: 'distance', label: `${t('statistics.distance', 'Distance')} (${distanceUnit})` },
              { key: 'energy', label: t('statistics.energy', 'Energy (kWh)') },
            ]}
            exportData={compData}
          >
            <StatisticsSource
              hasData={fleet != null}
              emptyWhen={compData.length <= 1}
              loading={fleetLoading}
              error={fleetError}
              onRetry={() => { void fleetQuery.refetch(); }}
              skeleton={<Skeleton className="h-full w-full rounded-xl" />}
              empty={
                <EmptyState
                  icon={<Car className="h-8 w-8" aria-hidden="true" />}
                  message={t('statistics.singleVehicle', 'Add more vehicles to compare')}
                  description={t('statistics.singleVehicleDescription', 'Fleet comparison requires activity from at least two registered vehicles.')}
                  actionTo={{ label: t('statistics.manageVehicles', 'Manage vehicles'), to: '/vehicles' }}
                  className="py-8"
                />
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={compData}>
                  {chartGrid}
                  <XAxis dataKey="name" tick={axisTickSm} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <ChartLegend state={fleetCompareHidden} />
                  <Bar dataKey="distance" name={`${t('statistics.distance', 'Distance')} (${distanceUnit})`} fill={palette[0]} radius={[4, 4, 0, 0]} hide={fleetCompareHidden.isHidden('distance')} />
                  <Bar dataKey="energy" name={t('statistics.energy', 'Energy (kWh)')} fill={palette[1]} radius={[4, 4, 0, 0]} hide={fleetCompareHidden.isHidden('energy')} />
                </BarChart>
              </ResponsiveContainer>
            </StatisticsSource>
          </ChartCard>
          </StatisticsChartPlacement>
            ) },
          ]} />
        </FadeIn>
      </Section>
    </PageLayout>
  );
}
