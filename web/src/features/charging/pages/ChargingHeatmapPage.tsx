import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { Skeleton, EmptyState } from '@/components/feedback';
import { Currency } from '@/components/data-display';
import { Activity } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ChartTooltip, chartGrid, axisTickSm,
} from '@/components/charts';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { usePageTitle } from '@/hooks/usePageTitle';
import { durationMinutes } from '../components/charging-curve/helpers';
import { useSettings } from '@/hooks/useSettings';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { DAYS } from '@/lib/constants';
import type { ChargingSession } from '@/api/types';

function heatColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'rgba(0, 240, 255, 0.04)';
  const ratio = count / max;
  if (ratio < 0.25) return 'rgba(0, 240, 255, 0.15)';
  if (ratio < 0.5) return 'rgba(16, 185, 129, 0.4)';
  if (ratio < 0.75) return 'rgba(245, 158, 11, 0.55)';
  return 'rgba(239, 68, 68, 0.75)';
}

interface HeatCell {
  count: number;
  totalEnergy: number;
}

function buildGrid(sessions: ChargingSession[]) {
  const grid: HeatCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ count: 0, totalEnergy: 0 })),
  );
  let maxCount = 0;
  let favDay = 0;
  let favHour = 0;

  for (const s of sessions) {
    const d = new Date(s.started_at);
    const day = d.getDay();
    const hour = d.getHours();
    grid[day][hour].count += 1;
    grid[day][hour].totalEnergy += s.total_energy_added_wh;
    if (grid[day][hour].count > maxCount) {
      maxCount = grid[day][hour].count;
      favDay = day;
      favHour = hour;
    }
  }

  return { grid, maxCount, favDay, favHour };
}

export default function ChargingHeatmapPage() {
  const { t } = useTranslation();
  usePageTitle(t('charging.heatmap.title', 'Charging Patterns'));
  useSettings();

  // Phase 40 / Prompt 16: header VehiclePicker is the source of truth.
  const { vehicleId } = useSelectedVehicle();

  const { data: sessions, isLoading, error } = useChargingSessionsPaginated(vehicleId, {
    limit: 2000,
  });

  const stats = useMemo(() => {
    if (!sessions?.length) return null;
    const totalEnergy = sessions.reduce((s, c) => s + c.total_energy_added_wh, 0);
    const totalCost = sessions.reduce((s, c) => s + (c.cost_decimal ?? 0), 0);
    const totalDuration = sessions.reduce((s, c) => s + durationMinutes(c.started_at, c.ended_at), 0);
    return {
      count: sessions.length,
      totalEnergy,
      totalCost,
      avgDuration: totalDuration / sessions.length,
    };
  }, [sessions]);

  const { grid, maxCount, favDay, favHour } = useMemo(
    () => (sessions?.length ? buildGrid(sessions) : { grid: [], maxCount: 0, favDay: 0, favHour: 0 }),
    [sessions],
  );

  const locationData = useMemo(() => {
    if (!sessions?.length) return [];
    const counts: Record<string, number> = {};
    for (const s of sessions) {
      const name = s.start_place ?? 'Unknown';
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return Object.entries(counts)
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [sessions]);

  const [hovered, setHovered] = useState<{ day: number; hour: number } | null>(null);

  if (isLoading) {
    return (
      <PageContainer title={t('charging.heatmap.title', 'Charging Patterns')} subtitle={t('charging.heatmap.subtitle', 'When and where you charge')}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={80} />
          ))}
        </div>
        <Skeleton height={320} className="mt-6" />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={t('charging.heatmap.title', 'Charging Patterns')}
      subtitle={t('charging.heatmap.subtitle', 'When and where you charge')}
      error={error as Error | null}
    >
      {/* ── Stat cards ── */}
      <StaggerContainer className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StaggerItem>
          <GlassPanel glow="cyan" hover className="p-4">
            <p className="text-xs text-[var(--text-secondary)]">{t('charging.heatmap.totalSessions', 'Total Sessions')}</p>
            <p className="text-xl font-semibold text-[var(--text-primary)]">{fmtInt(stats?.count ?? 0)}</p>
          </GlassPanel>
        </StaggerItem>
        <StaggerItem>
          <GlassPanel glow="green" hover className="p-4">
            <p className="text-xs text-[var(--text-secondary)]">{t('charging.heatmap.totalEnergy', 'Total Energy')}</p>
            <p className="text-xl font-semibold text-[var(--text-primary)]">{fmtNumber(stats?.totalEnergy ?? 0, 1)} kWh</p>
          </GlassPanel>
        </StaggerItem>
        <StaggerItem>
          <GlassPanel glow="purple" hover className="p-4">
            <p className="text-xs text-[var(--text-secondary)]">{t('charging.heatmap.totalCost', 'Total Cost')}</p>
            <p className="text-xl font-semibold text-[var(--text-primary)]"><Currency value={stats?.totalCost ?? 0} /></p>
          </GlassPanel>
        </StaggerItem>
        <StaggerItem>
          <GlassPanel hover className="p-4">
            <p className="text-xs text-[var(--text-secondary)]">{t('charging.heatmap.avgDuration', 'Avg Duration')}</p>
            <p className="text-xl font-semibold text-[var(--text-primary)]">{fmtInt(stats?.avgDuration ?? 0)} min</p>
          </GlassPanel>
        </StaggerItem>
      </StaggerContainer>

      {/* ── Favorite charging time ── */}
      {maxCount > 0 && (
        <FadeIn delay={0.1}>
          <GlassPanel glow="cyan" className="mt-6 border border-cyan-500/30 p-4">
            <p className="text-sm text-[var(--text-secondary)]">{t('charging.heatmap.favorite', 'Favorite Charging Time')}</p>
            <p className="text-lg font-semibold text-[var(--text-primary)]">
              {DAYS[favDay]}s at {favHour.toString().padStart(2, '0')}:00
              <span className="ml-2 text-sm text-[var(--text-secondary)]">({maxCount} sessions)</span>
            </p>
          </GlassPanel>
        </FadeIn>
      )}

      {/* ── Heatmap grid ── */}
      <FadeIn delay={0.2}>
        <GlassPanel className="mt-6 overflow-x-auto p-4">
          <h3 className="mb-3 text-base font-semibold text-[var(--text-primary)]">
            {t('charging.heatmap.gridTitle', 'Weekly Charging Heatmap')}
          </h3>
          <div className="grid gap-[2px] grid-cols-[56px_repeat(24,1fr)]">
            {/* Hour header row */}
            <div className="text-[10px] text-[var(--text-muted)]" />
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="text-center text-[10px] text-[var(--text-muted)]">{h}</div>
            ))}

            {/* Day rows */}
            {DAYS.map((dayLabel, day) => (
              <>
                <div key={`label-${day}`} className="flex items-center text-xs text-[var(--text-secondary)]">
                  {dayLabel}
                </div>
                {Array.from({ length: 24 }).map((_, hour) => {
                  const cell = grid[day]?.[hour] ?? { count: 0, totalEnergy: 0 };
                  const isHovered = hovered?.day === day && hovered?.hour === hour;
                  return (
                    <div
                      key={`${day}-${hour}`}
                      className={`relative h-7 rounded-sm transition-transform ${isHovered ? 'z-10 scale-125' : ''}`}
                      style={{ backgroundColor: heatColor(cell.count, maxCount) }}
                      onMouseEnter={() => setHovered({ day, hour })}
                      onMouseLeave={() => setHovered(null)}
                    >
                      {isHovered && cell.count > 0 && (
                        <div className="absolute -top-14 left-1/2 z-20 -translate-x-1/2 rounded bg-gray-900 px-2 py-1 text-[10px] text-[var(--text-primary)] shadow-lg whitespace-nowrap">
                          <div>{DAYS[day]} {hour}:00</div>
                          <div>{cell.count} sessions · {fmtNumber(cell.totalEnergy, 1)} kWh avg</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            ))}
          </div>

          {/* Legend */}
          <div className="mt-3 flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
            <span>{t('charging.heatmap.less', 'Less')}</span>
            {['rgba(0,240,255,0.04)', 'rgba(0,240,255,0.15)', 'rgba(16,185,129,0.4)', 'rgba(245,158,11,0.55)', 'rgba(239,68,68,0.75)'].map((c) => (
              <div key={c} className="h-3 w-6 rounded-sm" style={{ backgroundColor: c }} />
            ))}
            <span>{t('charging.heatmap.more', 'More')}</span>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Top charging locations ── */}
      <FadeIn delay={0.3}>
        <GlassPanel className="mt-6 p-4">
          <h3 className="mb-3 text-base font-semibold text-[var(--text-primary)]">
            {t('charging.heatmap.topLocations', 'Top Charging Locations')}
          </h3>
          {locationData.length > 0 ? (
            <ResponsiveContainer width="100%" height={locationData.length * 36 + 20}>
              <BarChart data={locationData} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                {chartGrid}
                <XAxis type="number" tick={axisTickSm} />
                <YAxis type="category" dataKey="name" tick={axisTickSm} width={120} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill="rgba(0, 240, 255, 0.6)" radius={[0, 4, 4, 0]} name="Sessions" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Activity className="h-8 w-8 opacity-20" />}
              message={t('common.noData', 'No data available')}
              className="py-8"
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
