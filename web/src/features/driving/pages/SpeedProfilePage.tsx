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
import { useSpeedProfile, useDrives } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import type { Drive } from '@/types/driving';

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
  const battUsed = (drive.startBatteryLevel ?? 0) - (drive.endBatteryLevel ?? 0);
  if (drive.distance > 0 && battUsed > 0) return (battUsed * 0.75 * 1000) / drive.distance;
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

  const { convertSpeed, speedUnit, convertEfficiency, efficiencyUnit } = useSettings();

  /* ---- Speed vs Efficiency scatter from drives ---- */
  const scatterData = useMemo(() => {
    if (!drives) return [];
    return drives
      .filter((d) => d.speedAvg && getEfficiency(d))
      .map((d) => {
        const eff = convertEfficiency(getEfficiency(d)!);
        return {
          speed: Math.round(convertSpeed(d.speedAvg!)),
          efficiency: Math.round(eff),
          color: eff < 140 ? '#10b981' : eff < 200 ? '#00f0ff' : eff < 260 ? '#f59e0b' : '#ef4444',
        };
      });
  }, [drives, convertSpeed, convertEfficiency]);

  /* ---- Per-bucket efficiency from drives ---- */
  const bucketEfficiency = useMemo(() => {
    if (!drives) return new Map<string, { avgEff: number; avgSpeed: number }>();
    const map = new Map<string, { totalEff: number; totalSpd: number; count: number }>();
    const ranges = data?.distribution ?? [];
    drives.forEach((d) => {
      if (d.speedAvg == null) return;
      const eff = getEfficiency(d);
      if (!eff) return;
      for (const r of ranges) {
        const parts = r.range.match(/(\d+)/g);
        if (!parts) continue;
        const lo = Number(parts[0]);
        const hi = parts.length > 1 ? Number(parts[1]) : 999;
        if (d.speedAvg >= lo && d.speedAvg < hi) {
          const existing = map.get(r.range) ?? { totalEff: 0, totalSpd: 0, count: 0 };
          existing.totalEff += eff;
          existing.totalSpd += d.speedAvg;
          existing.count++;
          map.set(r.range, existing);
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
      empty={!data}
      emptyMessage={t('speedProfile.empty', 'No speed data available.')}
    >
      {data && (
        <>
          {/* Hero gauges */}
          <FadeIn>
            <GlassPanel className="p-4 sm:p-6">
              <div className="grid grid-cols-3 gap-4 sm:gap-6 items-center">
                <RadialGauge
                  value={Math.round(convertSpeed(data.avgSpeedKmh ?? 0))}
                  max={Math.round(convertSpeed(200))}
                  label={t('speedProfile.avgSpeed', 'Avg Speed')}
                  unit={speedUnit}
                  color="#00f0ff"
                />
                <RadialGauge
                  value={Math.round(convertSpeed(data.peakSpeedKmh ?? 0))}
                  max={Math.round(convertSpeed(250))}
                  label={t('speedProfile.peakSpeed', 'Peak Speed')}
                  unit={speedUnit}
                  color="#ef4444"
                />
                <RadialGauge
                  value={Math.round(convertSpeed(data.optimalSpeedKmh ?? 0))}
                  max={Math.round(convertSpeed(200))}
                  label={t('speedProfile.optimalSpeed', 'Optimal Speed')}
                  unit={speedUnit}
                  color="#10b981"
                />
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Speed distribution bar chart */}
          <FadeIn>
            <ChartContainer title={t('speedProfile.distribution', 'Speed Distribution')} height={280}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(data.distribution ?? []).map((b) => ({ range: b.range, pct: b.percentage, count: b.driveCount }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="pct" name={`% ${t('speedProfile.timeSpent', 'time')}`} radius={[4, 4, 0, 0]}>
                    {(data.distribution ?? []).map((b, i) => (
                      <Cell key={i} fill={bucketColor(b.range)} fillOpacity={0.7} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>

          {/* Speed bucket detail cards */}
          <StaggerContainer className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(data.distribution ?? []).map((bucket) => {
              const effData = bucketEfficiency.get(bucket.range);
              return (
                <StaggerItem key={bucket.range}>
                  <GlassPanel className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      {categoryIcon(bucket.range)}
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{bucket.range}</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-[10px] text-[var(--text-muted)]">{t('speedProfile.timeShare', 'Time')}</span>
                        <span className={cn('text-sm font-bold', bucketTextClass(bucket.range))}>
                          {(bucket.percentage ?? 0).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] text-[var(--text-muted)]">{t('speedProfile.drives', 'Drives')}</span>
                        <span className="text-sm font-bold text-cyan-400">{bucket.driveCount}</span>
                      </div>
                      {effData && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-[10px] text-[var(--text-muted)]">{t('speedProfile.avgSpeed', 'Avg Speed')}</span>
                            <span className="text-sm font-bold text-[var(--text-secondary)]">
                              {Math.round(convertSpeed(effData.avgSpeed))} {speedUnit}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[10px] text-[var(--text-muted)]">{efficiencyUnit}</span>
                            <span className={cn('text-sm font-bold', effData.avgEff < 160 ? 'text-green-400' : effData.avgEff < 220 ? 'text-amber-400' : 'text-red-400')}>
                              {Math.round(convertEfficiency(effData.avgEff))}
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
              <ChartContainer
                title={t('speedProfile.effVsSpeed', 'Efficiency vs Speed')}
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
                        speed: Math.round(convertSpeed(data.optimalSpeedKmh ?? 0)),
                        unit: speedUnit,
                      })}
                    </p>
                  </div>
                </div>
              </GlassPanel>
            </FadeIn>
          )}
        </>
      )}
    </PageContainer>
  );
}
