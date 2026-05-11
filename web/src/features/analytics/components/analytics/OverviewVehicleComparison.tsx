import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import {
  ChartTooltip,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import type { FleetAnalytics } from '@/api/types';
import { SectionTitle } from './helpers';
import { PIE_COLORS } from './constants';

const KM_PER_MILE = 1.609344;

export function OverviewVehicleComparison({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend efficiency is Wh/km — convert to Wh/mi when the user prefers miles.
  const whPerKmToDisplay = (whPerKm: number) =>
    distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;

  const vehicles = data?.vehicle_comparison ?? [];

  const leaderboard = useMemo(() => {
    const sorted = [...vehicles].sort((a, b) => safe(a.efficiency) - safe(b.efficiency));
    const maxEff = sorted.length > 0 ? safe(sorted[sorted.length - 1].efficiency) : 1;
    return sorted.map((v) => ({ ...v, pct: maxEff > 0 ? (safe(v.efficiency) / maxEff) * 100 : 0 }));
  }, [vehicles]);

  const radarData = useMemo(() => {
    if (vehicles.length < 2) return [];
    const maxDist = Math.max(...vehicles.map((v) => safe(v.distance)), 1);
    const maxEnergy = Math.max(...vehicles.map((v) => safe(v.energy)), 1);
    const maxDrives = Math.max(...vehicles.map((v) => safe(v.drives)), 1);
    const maxEff = Math.max(...vehicles.map((v) => safe(v.efficiency)), 1);
    return ['Distance', 'Energy', 'Drives', 'Efficiency'].map((metric) => {
      const row: Record<string, string | number> = { metric };
      vehicles.forEach((v) => {
        switch (metric) {
          case 'Distance': row[v.name] = (safe(v.distance) / maxDist) * 100; break;
          case 'Energy': row[v.name] = (safe(v.energy) / maxEnergy) * 100; break;
          case 'Drives': row[v.name] = (safe(v.drives) / maxDrives) * 100; break;
          case 'Efficiency': row[v.name] = ((maxEff - safe(v.efficiency)) / maxEff) * 100; break;
        }
      });
      return row;
    });
  }, [vehicles]);

  return (
    <>
      {/* Fleet Usage Donut + Efficiency Leaderboard */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.overview.fleetUsage', 'Fleet Usage')}</SectionTitle>
          {vehicles.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={vehicles.map((v) => ({ name: v.name, value: convertDistanceFromSI(safe(v.distance) * 1000, distanceUnit) }))}
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
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('analytics.overview.noVehicles', 'No vehicle data')} />
          )}
        </GlassPanel>

        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.overview.effLeaderboard', 'Efficiency Leaderboard')}</SectionTitle>
          {leaderboard.length > 0 ? (
            <div className="mt-3 space-y-3">
              {leaderboard.map((v, idx) => (
                <div key={v.id}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--text-primary)] font-medium">
                      #{idx + 1} {v.name}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      {fmtNumber(whPerKmToDisplay(safe(v.efficiency)), 1)} {efficiencyUnit}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-neon-cyan transition-all duration-slow"
                      style={{ width: `${v.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('analytics.overview.noEfficiency', 'No efficiency data')} />
          )}
        </GlassPanel>
      </div>

      {/* Radar Vehicle Comparison + Energy & Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.overview.vehicleComparison', 'Vehicle Comparison')}</SectionTitle>
          {radarData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="rgba(255,255,255,0.06)" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                {vehicles.map((v, i) => (
                  <Radar
                    key={v.id}
                    name={v.name}
                    dataKey={v.name}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                ))}
                <Tooltip content={<ChartTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('analytics.overview.noComparison', 'Need 2+ vehicles for comparison')} />
          )}
        </GlassPanel>

        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.overview.energyActivity', 'Energy & Activity')}</SectionTitle>
          {vehicles.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={vehicles} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="name" tick={axisTickSm} />
                <YAxis tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Bar dataKey="energy" name={t('analytics.overview.energykWh', 'Energy (kWh)')} fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
                <Bar dataKey="drives" name={t('analytics.overview.drives', 'Drives')} fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('analytics.overview.noVehicles', 'No vehicle data')} />
          )}
        </GlassPanel>
      </div>
    </>
  );
}
