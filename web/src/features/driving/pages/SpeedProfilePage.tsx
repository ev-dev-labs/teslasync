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
      .map((d) => ({
        speed: Math.round(convertSpeed(d.speedAvg!)),
        efficiency: Math.round(convertEfficiency(getEfficiency(d)!)),
      }));
  }, [drives, convertSpeed, convertEfficiency]);

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
                  value={Math.round(convertSpeed(data.avgSpeedKmh))}
                  max={Math.round(convertSpeed(200))}
                  label={t('speedProfile.avgSpeed', 'Avg Speed')}
                  unit={speedUnit}
                  color="#00f0ff"
                />
                <RadialGauge
                  value={Math.round(convertSpeed(data.peakSpeedKmh))}
                  max={Math.round(convertSpeed(250))}
                  label={t('speedProfile.peakSpeed', 'Peak Speed')}
                  unit={speedUnit}
                  color="#ef4444"
                />
                <RadialGauge
                  value={Math.round(convertSpeed(data.optimalSpeedKmh))}
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
            {(data.distribution ?? []).map((bucket) => (
              <StaggerItem key={bucket.range}>
                <GlassPanel className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {categoryIcon(bucket.range)}
                    <span className="text-xs font-semibold text-[var(--text-primary)]">{bucket.range}</span>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-lg font-bold" style={{ color: bucketColor(bucket.range) }}>
                        {bucket.percentage.toFixed(1)}%
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        {bucket.driveCount} {t('speedProfile.drives', 'drives')}
                      </p>
                    </div>
                    <div className="h-8 w-8 rounded-full flex items-center justify-center" style={{ background: `${bucketColor(bucket.range)}20` }}>
                      <span className="text-xs font-bold" style={{ color: bucketColor(bucket.range) }}>
                        {Math.round(bucket.percentage)}
                      </span>
                    </div>
                  </div>
                </GlassPanel>
              </StaggerItem>
            ))}
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
                    <Scatter data={scatterData} fill="#f59e0b" fillOpacity={0.6} />
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartContainer>
            </FadeIn>
          )}

          {/* Efficiency insight */}
          {data.optimalSpeedKmh > 0 && (
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
                        speed: Math.round(convertSpeed(data.optimalSpeedKmh)),
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
