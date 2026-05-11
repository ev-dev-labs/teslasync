import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Zap, TrendingUp, Car } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Select } from '@/components/ui/Select';
import {
  ChartContainer, ChartTooltip,
  BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from '@/components/charts';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useSpeedProfile, useDrives } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/numberFormat';
import type { Drive } from '@/types/driving';
import { convertSpeedFromSI } from '@/lib/unitConversion';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function bucketColor(range: string): string {
  if (range.startsWith('0') || range.includes('15')) return '#10b981';
  if (range.startsWith('30') || range.includes('45')) return '#00f0ff';
  if (range.startsWith('60') || range.includes('75')) return '#f59e0b';
  return '#ef4444';
}

function bucketTextClass(range: string): string {
  if (range.startsWith('0') || range.includes('15')) return 'text-emerald-500';
  if (range.startsWith('30') || range.includes('45')) return 'text-cyan-400';
  if (range.startsWith('60') || range.includes('75')) return 'text-amber-500';
  return 'text-red-500';
}

function categoryIcon(range: string): React.ReactNode {
  if (range.includes('30') || range.startsWith('0')) return <Car className="h-5 w-5 text-green-400" />;
  if (range.includes('60') || range.includes('90')) return <TrendingUp className="h-5 w-5 text-cyan-400" />;
  return <Gauge className="h-5 w-5 text-amber-400" />;
}

function getEfficiency(drive: Drive): number | null {
  const battUsed = (drive.startBatteryPct ?? 0) - (drive.endBatteryPct ?? 0);
  if (drive.distanceM > 0 && battUsed > 0) return (battUsed * 0.75 * 1000) / (drive.distanceM / 1000);
  return null;
}

/* ------------------------------------------------------------------ */
/*  SpeedProfilePage                                                  */
/* ------------------------------------------------------------------ */

export default function SpeedProfilePage() {
  const { t } = useTranslation();
  usePageTitle(t('speedProfile.title', 'Speed Profile'));

  const { data: vehicles } = useVehicles();
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { data, isLoading, error } = useSpeedProfile(vehicleIdStr);
  const { data: drives } = useDrives(vehicleIdStr);

  const { unitPrefs } = useUnits();
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);

  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toEfficiencyDisplay = (whPerKm: number) => unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;

  /* ---- Speed vs Efficiency scatter from drives ---- */
  const scatterData = useMemo(() => {
    if (!drives) return [];
    return drives
      .filter((d) => d.avgSpeedMps && getEfficiency(d))
      .map((d) => {
        const eff = toEfficiencyDisplay(getEfficiency(d)!);
        return {
          speed: Math.round(toSpeedDisplay(d.avgSpeedMps!)),
          efficiency: Math.round(eff),
          color: eff < 140 ? '#10b981' : eff < 200 ? '#00f0ff' : eff < 260 ? '#f59e0b' : '#ef4444',
        };
      });
  }, [drives, toSpeedDisplay, toEfficiencyDisplay]);

  /* ---- Per-bucket efficiency from drives ---- */
  const bucketEfficiency = useMemo(() => {
    if (!drives) return new Map<string, { avgEff: number; avgSpeed: number }>();
    const map = new Map<string, { totalEff: number; totalSpd: number; count: number }>();
    const ranges = data?.distribution ?? [];
    drives.forEach((d) => {
      if (d.avgSpeedMps == null) return;
      const eff = getEfficiency(d);
      if (!eff) return;
      const avgSpeed = toSpeedDisplay(d.avgSpeedMps);
      for (const r of ranges) {
        const bucket = r.speedBucket ?? r.speed_bucket ?? '';
        const parts = bucket.match(/(\d+)/g);
        if (!parts) continue;
        const lo = Number(parts[0]);
        const hi = parts.length > 1 ? Number(parts[1]) : 999;
        if (avgSpeed >= lo && avgSpeed < hi) {
          const existing = map.get(bucket) ?? { totalEff: 0, totalSpd: 0, count: 0 };
          existing.totalEff += eff;
          existing.totalSpd += avgSpeed;
          existing.count++;
          map.set(bucket, existing);
          break;
        }
      }
    });
    const result = new Map<string, { avgEff: number; avgSpeed: number }>();
    map.forEach((v, k) => {
      result.set(k, { avgEff: v.totalEff / v.count, avgSpeed: v.totalSpd / v.count });
    });
    return result;
  }, [drives, data]);

  const vehicleOptions = (vehicles ?? []).map((v) => ({
    value: String(v.id), label: v.display_name || v.vin,
  }));

  return (
    <PageContainer
      title={t('speedProfile.title', 'Speed Profile')}
      subtitle={t('speedProfile.subtitle', 'Speed distribution and driving pattern analysis')}
      error={error as Error | null}
      actions={vehicleOptions.length > 0 ? (
        <Select value={String(vehicleId ?? '')} onChange={(e) => setSelectedVehicle(Number(e.target.value))} options={vehicleOptions} />
      ) : undefined}
      loading={isLoading}

    >
      {data ? (
        <>
          {/* Hero gauges */}
          <FadeIn>
            <GlassPanel className="p-4 sm:p-6">
              <div className="grid grid-cols-3 gap-4 sm:gap-6 items-center">
                <RadialGauge
                  value={Math.round(toSpeedDisplay(data.avgSpeedKmh ?? 0))}
                  max={Math.round(toSpeedDisplay(200))}
                  label={t('speedProfile.avgSpeed', 'Avg Speed')}
                  unit={speedUnit}
                  color="#00f0ff"
                />
                <RadialGauge
                  value={Math.round(toSpeedDisplay(data.peakSpeedKmh ?? 0))}
                  max={Math.round(toSpeedDisplay(250))}
                  label={t('speedProfile.peakSpeed', 'Peak Speed')}
                  unit={speedUnit}
                  color="#ef4444"
                />
                <RadialGauge
                  value={Math.round(toSpeedDisplay(data.optimalSpeedKmh ?? 0))}
                  max={Math.round(toSpeedDisplay(200))}
                  label={t('speedProfile.optimalSpeed', 'Optimal Speed')}
                  unit={speedUnit}
                  color="#10b981"
                />
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Speed distribution bar chart */}
          <FadeIn>
            {/* chart-a11y:no-table per-bucket detail cards (below) provide the same numbers in an accessible format */}
            <ChartContainer
              title={t('speedProfile.distribution', 'Speed Distribution')}
              ariaLabel={t('speedProfile.distribution.aria', 'Speed-bucket time-share distribution bar chart')}
              height={280}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(data.distribution ?? []).map((b) => {
                  const range = b.speedBucket ?? b.speed_bucket ?? '';
                  return { range, pct: b.readings ?? 0, count: b.readings ?? 0 };
                })}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="pct" name={`% ${t('speedProfile.timeSpent', 'time')}`} radius={[4, 4, 0, 0]}>
                    {(data.distribution ?? []).map((b, i) => (
                      <Cell key={i} fill={bucketColor(b.speedBucket ?? b.speed_bucket ?? '')} fillOpacity={0.7} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>

          {/* Speed bucket detail cards */}
          <StaggerContainer className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(data.distribution ?? []).map((bucket) => {
              const range = bucket.speedBucket ?? bucket.speed_bucket ?? '';
              const totalReadings = (data.distribution ?? []).reduce((s, b) => s + (b.readings ?? 0), 0);
              const pct = totalReadings > 0 ? ((bucket.readings ?? 0) / totalReadings) * 100 : 0;
              const effData = bucketEfficiency.get(range);
              return (
                <StaggerItem key={range} className="h-full">
                  <GlassPanel className="p-4 h-full flex flex-col">
                    <div className="flex items-center gap-2 mb-2">
                      {categoryIcon(range)}
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{range}</span>
                    </div>
                    <div className="space-y-2 flex-1">
                      <div className="flex justify-between">
                        <span className="text-[10px] text-[var(--text-muted)]">{t('speedProfile.timeShare', 'Time')}</span>
                        <span className={cn('text-sm font-bold', bucketTextClass(range))}>
                          {fmtNumber(pct, 1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] text-[var(--text-muted)]">{t('speedProfile.drives', 'Drives')}</span>
                        <span className="text-sm font-bold text-cyan-400">{bucket.readings ?? 0}</span>
                      </div>
                      {effData && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-[10px] text-[var(--text-muted)]">{t('speedProfile.avgSpeed', 'Avg Speed')}</span>
                            <span className="text-sm font-bold text-[var(--text-secondary)]">
                              {fmtNumber(toSpeedDisplay(effData.avgSpeed))} {speedUnit}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[10px] text-[var(--text-muted)]">{efficiencyUnit}</span>
                            <span className={cn('text-sm font-bold', effData.avgEff < 160 ? 'text-green-400' : effData.avgEff < 220 ? 'text-amber-400' : 'text-red-400')}>
                              {fmtNumber(toEfficiencyDisplay(effData.avgEff))}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </GlassPanel>
                </StaggerItem>
              );
            })}
          </StaggerContainer>

          {/* Speed vs Efficiency scatter */}
          {scatterData.length > 3 && (
            <FadeIn>
              {/* chart-a11y:no-table per-drive scatter cloud — too dense for a tabular fallback */}
              <ChartContainer
                title={t('speedProfile.effVsSpeed', 'Efficiency vs Speed')}
                ariaLabel={t('speedProfile.effVsSpeed.aria', 'Per-drive efficiency versus speed scatter plot')}
                subtitle={`${t('speedProfile.lower', 'Lower')} ${efficiencyUnit} = ${t('speedProfile.better', 'better')}`}
                height={240}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="speed" name={t('speedProfile.speed', 'Speed')} unit={` ${speedUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis dataKey="efficiency" name={efficiencyUnit} unit={` ${efficiencyUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Scatter data={scatterData} fillOpacity={0.7}>
                      {scatterData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-3 mt-2 justify-end">
                  <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> {t('speedProfile.efficient', 'Efficient')}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500" /> {t('speedProfile.moderate', 'Moderate')}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500" /> {t('speedProfile.highConsumption', 'High consumption')}
                  </span>
                </div>
              </ChartContainer>
            </FadeIn>
          )}

          {/* Efficiency insight */}
          {(data.optimalSpeedKmh ?? 0) > 0 && (
            <FadeIn>
              <GlassPanel className="p-4 border-l-4 border-green-400">
                <div className="flex items-start gap-3">
                  <Zap className="h-5 w-5 text-green-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                      {t('speedProfile.insightTitle', 'Efficiency Insight')}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {t('speedProfile.insightText', 'Drives around {{speed}} {{unit}} show the best energy efficiency. Reducing highway speed could improve efficiency by ~15%.', {
                        speed: fmtNumber(toSpeedDisplay(data.optimalSpeedKmh ?? 0)),
                        unit: speedUnit,
                      })}
                    </p>
                  </div>
                </div>
              </GlassPanel>
            </FadeIn>
          )}
        </>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('speedProfile.noData', 'No speed profile data available yet')} />
      )}
    </PageContainer>
  );
}
