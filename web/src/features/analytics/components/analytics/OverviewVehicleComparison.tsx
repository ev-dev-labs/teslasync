import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart as PieChartIcon, Trophy, Radar as RadarIcon, BarChart3 } from 'lucide-react';
import {
  ChartTooltip,
  ChartLegend,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import { AnalyticsPanel } from './AnalyticsPanel';
import { AnalyticsChartPanel } from './AnalyticsChartPanel';
import { PIE_COLORS } from './constants';
import type { FleetAnalyticsQuery } from './constants';

const KM_PER_MILE = 1.609344;

/**
 * The four fleet-comparison panels (Fleet Usage, Efficiency Leaderboard,
 * Vehicle Comparison radar, Energy & Activity). Rendered as bare grid items
 * (a fragment) so they flow into the Overview tab's single bento grid.
 */
export function OverviewVehicleComparison({ query }: { query: FleetAnalyticsQuery }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // Backend efficiency is Wh/km — project to Wh/mi when the user prefers miles.
  // Stable per active unit so the memoised derives below only recompute when the
  // preference actually changes.
  const whPerKmToDisplay = useCallback(
    (whPerKm: number) => (distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm),
    [distanceUnit],
  );

  const { data, isLoading, isError, error, refetch } = query;
  const err = isError ? error : undefined;
  const vehicles = data?.vehicle_comparison ?? [];

  const leaderboard = useMemo(() => {
    // Rank most-efficient first: efficiency is Wh/km, so a lower value is better.
    const sorted = [...vehicles].sort((a, b) => safe(a.efficiency) - safe(b.efficiency));
    // The bar length must encode "how good", consistent with the radar spoke
    // that inverts efficiency below. The leader (smallest positive Wh/km) fills
    // the bar and less-efficient vehicles taper off proportionally. The previous
    // `efficiency / maxEfficiency` ratio inverted the meaning — it gave the
    // *worst* vehicle the fullest bar. Guard against non-positive/edge values.
    const bestEff = sorted.reduce((best, v) => {
      const e = safe(v.efficiency);
      return e > 0 && e < best ? e : best;
    }, Infinity);
    const hasBest = Number.isFinite(bestEff);
    return sorted.map((v) => {
      const eff = safe(v.efficiency);
      const pct = hasBest && eff > 0 ? Math.min(100, (bestEff / eff) * 100) : 0;
      return { ...v, pct };
    });
  }, [vehicles]);

  const radarData = useMemo(() => {
    if (vehicles.length < 2) return [];
    const maxDist = Math.max(...vehicles.map((v) => safe(v.distance)), 1);
    const maxEnergy = Math.max(...vehicles.map((v) => safe(v.energy)), 1);
    const maxDrives = Math.max(...vehicles.map((v) => safe(v.drives)), 1);
    const maxEff = Math.max(...vehicles.map((v) => safe(v.efficiency)), 1);
    // Stable switch key kept separate from the localized spoke label so the
    // radar axis renders translated text while the math stays key-driven.
    const metrics = [
      { key: 'distance' as const, label: t('analytics.overview.radar.distance', 'Distance') },
      { key: 'energy' as const, label: t('analytics.overview.radar.energy', 'Energy') },
      { key: 'drives' as const, label: t('analytics.overview.radar.drives', 'Drives') },
      { key: 'efficiency' as const, label: t('analytics.overview.radar.efficiency', 'Efficiency') },
    ];
    return metrics.map(({ key, label }) => {
      const row: Record<string, string | number> = { metric: label };
      vehicles.forEach((v) => {
        switch (key) {
          case 'distance': row[v.name] = (safe(v.distance) / maxDist) * 100; break;
          case 'energy': row[v.name] = (safe(v.energy) / maxEnergy) * 100; break;
          case 'drives': row[v.name] = (safe(v.drives) / maxDrives) * 100; break;
          case 'efficiency': row[v.name] = ((maxEff - safe(v.efficiency)) / maxEff) * 100; break;
        }
      });
      return row;
    });
  }, [vehicles, t]);

  // Fleet-usage donut plots each vehicle's distance share. Backend distance is
  // SI-floor km, so project to the active unit at the boundary. Derived once per
  // data/unit change instead of rebuilding a fresh array literal inline on every
  // render (which would defeat any downstream chart memoisation).
  const pieData = useMemo(
    () =>
      vehicles.map((v) => ({
        name: v.name,
        value: convertDistanceFromSI(safe(v.distance) * 1000, distanceUnit),
      })),
    [vehicles, distanceUnit],
  );

  return (
    <>
      {/* Fleet Usage Donut */}
      <AnalyticsChartPanel
        title={t('analytics.overview.fleetUsage', 'Fleet Usage')}
        icon={<PieChartIcon className="h-4 w-4" />}
        loading={isLoading}
        error={err}
        onRetry={refetch}
        isEmpty={vehicles.length === 0}
        emptyMessage={t('analytics.overview.noVehicles', 'No vehicle data')}
        ariaLabel={`${t('analytics.overview.fleetUsageAria', 'Fleet distance share by vehicle')} (${distanceUnit})`}
        data={pieData}
        dataColumns={[
          { key: 'name', label: t('analytics.overview.vehicle', 'Vehicle') },
          { key: 'value', label: `${t('analytics.driving.distance', 'Distance')} (${distanceUnit})` },
        ]}
        exportFilename="fleet-distance-share"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={95}
              paddingAngle={3}
            >
              {vehicles.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
            <ChartLegend />
          </PieChart>
        </ResponsiveContainer>
      </AnalyticsChartPanel>

      {/* Efficiency Leaderboard */}
      <AnalyticsPanel
        title={t('analytics.overview.effLeaderboard', 'Efficiency Leaderboard')}
        icon={<Trophy className="h-4 w-4" />}
        loading={isLoading}
        error={err}
        onRetry={refetch}
        isEmpty={leaderboard.length === 0}
        emptyMessage={t('analytics.overview.noEfficiency', 'No efficiency data')}
      >
        <div className="space-y-3">
          {leaderboard.map((v, idx) => (
            <div key={v.id}>
              <div className="mb-1 flex items-center justify-between">
                <Text size="xs" weight="medium" color="primary">
                  #{idx + 1} {v.name}
                </Text>
                <Text size="xs" color="muted">
                  {fmtNumber(whPerKmToDisplay(safe(v.efficiency)), 1)} {efficiencyUnit}
                </Text>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]" aria-hidden="true">
                <div
                  data-testid="efficiency-leader-fill"
                  className="h-full rounded-full bg-[var(--theme-primary)] transition-all duration-slow"
                  style={{ width: `${v.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </AnalyticsPanel>

      {/* Radar Vehicle Comparison */}
      <AnalyticsChartPanel
        title={t('analytics.overview.vehicleComparison', 'Vehicle Comparison')}
        icon={<RadarIcon className="h-4 w-4" />}
        loading={isLoading}
        error={err}
        onRetry={refetch}
        isEmpty={radarData.length === 0}
        emptyMessage={t('analytics.overview.noComparison', 'Need 2+ vehicles for comparison')}
        ariaLabel={t('analytics.overview.vehicleComparisonAria', 'Normalized vehicle metric comparison')}
        data={radarData}
        dataColumns={[
          { key: 'metric', label: t('analytics.overview.metric', 'Metric') },
          ...vehicles.map((vehicle) => ({ key: vehicle.name, label: vehicle.name })),
        ]}
        exportFilename="fleet-vehicle-comparison"
        chartKey="analytics-vehicle-radar-comparison"
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="var(--glass-border)" />
              <PolarAngleAxis dataKey="metric" tick={axisTick} />
              {vehicles.map((v, i) => (
                <Radar
                  key={v.id}
                  name={v.name}
                  dataKey={v.name}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  fillOpacity={0.15}
                  strokeWidth={2}
                  hide={hiddenSeries?.isHidden(v.name)}
                />
              ))}
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </AnalyticsChartPanel>

      {/* Energy & Activity */}
      <AnalyticsChartPanel
        title={t('analytics.overview.energyActivity', 'Energy & Activity')}
        icon={<BarChart3 className="h-4 w-4" />}
        loading={isLoading}
        error={err}
        onRetry={refetch}
        isEmpty={vehicles.length === 0}
        emptyMessage={t('analytics.overview.noVehicles', 'No vehicle data')}
        ariaLabel={t('analytics.overview.energyActivityAria', 'Energy and drive count by vehicle')}
        data={vehicles}
        dataColumns={[
          { key: 'name', label: t('analytics.overview.vehicle', 'Vehicle') },
          { key: 'energy', label: t('analytics.overview.energykWh', 'Energy (kWh)') },
          { key: 'drives', label: t('analytics.overview.drives', 'Drives') },
        ]}
        exportFilename="fleet-energy-activity"
        chartKey="analytics-energy-activity"
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={vehicles} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="name" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              <Bar dataKey="energy" name={t('analytics.overview.energykWh', 'Energy (kWh)')} fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('energy')} />
              <Bar dataKey="drives" name={t('analytics.overview.drives', 'Drives')} fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('drives')} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </AnalyticsChartPanel>
    </>
  );
}
