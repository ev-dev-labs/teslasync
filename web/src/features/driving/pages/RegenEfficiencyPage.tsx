import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Activity, Calendar } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Select } from '@/components/ui/Select';
import {
  ChartContainer, ChartTooltip,
  ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { MetricBar } from '@/components/data-display/MetricBar';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useRegenEfficiency, useDrives } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtPercent, fmtWithUnit } from '@/lib/numberFormat';
import type { Drive } from '@/types/driving';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function regenColor(ratio: number): string {
  if (ratio >= 25) return '#10b981';
  if (ratio >= 15) return '#00f0ff';
  if (ratio >= 8) return '#f59e0b';
  return '#ef4444';
}

function getRegenRatio(drive: Drive): number | null {
  if (!drive.powerMin || drive.powerMin >= 0) return null;
  if (!drive.powerMax || drive.powerMax <= 0) return null;
  return Math.abs(drive.powerMin) / drive.powerMax * 100;
}

/* ------------------------------------------------------------------ */
/*  RegenEfficiencyPage                                               */
/* ------------------------------------------------------------------ */

export default function RegenEfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('regen.title', 'Regenerative Braking'));

  const { data: vehicles } = useVehicles();
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { data, isLoading, error } = useRegenEfficiency(vehicleIdStr);
  const { data: drives } = useDrives(vehicleIdStr);

  const { convertDistance, distanceUnit } = useSettings();

  /* ---- Monthly regen trend from drives ---- */
  const monthlyTrend = useMemo(() => {
    if (!drives || drives.length === 0) return [];
    const byMonth = new Map<string, { totalRegen: number; count: number; totalDist: number }>();
    drives.forEach((d) => {
      const month = d.startDate?.substring(0, 7);
      if (!month) return;
      const regen = d.powerMin && d.powerMin < 0 ? Math.abs(d.powerMin) * (d.durationMin / 60) : 0;
      const existing = byMonth.get(month) ?? { totalRegen: 0, count: 0, totalDist: 0 };
      existing.totalRegen += regen;
      existing.count++;
      existing.totalDist += d.distance;
      byMonth.set(month, existing);
    });
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, val]) => ({
        month,
        regenKwh: parseFloat(fmtNumber(val.totalRegen / 1000, 1)),
        drives: val.count,
        distance: Math.round(convertDistance(val.totalDist)),
      }));
  }, [drives, convertDistance]);

  /* ---- Per-drive regen list ---- */
  const regenDrives = useMemo(() => {
    if (!drives) return [];
    return drives
      .filter((d) => d.powerMin && d.powerMin < 0)
      .slice(0, 20)
      .map((d) => ({
        id: d.id,
        date: d.startDate ? formatDateShort(d.startDate) : '—',
        distance: fmtWithUnit(convertDistance(d.distance), distanceUnit),
        maxRegen: d.powerMin ? fmtWithUnit(Math.abs(d.powerMin), 'kW') : '—',
        ratio: getRegenRatio(d),
      }));
  }, [drives, convertDistance, distanceUnit]);

  const vehicleOptions = (vehicles ?? []).map((v) => ({
    value: String(v.id), label: v.display_name || v.vin,
  }));

  return (
    <PageContainer
      title={t('regen.title', 'Regenerative Braking')}
      subtitle={t('regen.subtitle', 'Energy recovery analysis and regen efficiency')}
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
            <GlassPanel className="p-6 flex flex-col items-center">
              <RadialGauge
                value={Math.round(data.regenRatio ?? 0)}
                max={100}
                label={t('regen.regenRatio', 'Regen Ratio')}
                unit="%"
                color={regenColor(data.regenRatio ?? 0)}
                size={160}
              />
              <p className="text-xs text-[var(--text-muted)] mt-2">
                {t('regen.recoveredInfo', 'You\'ve recovered {{kwh}} kWh — equivalent to ~{{charges}} free charges.', {
                  kwh: fmtNumber(data.totalRegenKwh ?? 0),
                  charges: fmtNumber(data.freeCharges ?? 0),
                })}
              </p>
            </GlassPanel>
          </FadeIn>

          {/* Stat cards */}
          <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Zap className="h-4 w-4 mx-auto mb-1 text-green-400" />
                <p className="text-lg font-bold text-[var(--text-primary)]"><AnimatedNumber value={data.totalRegenKwh ?? 0} decimals={1} /></p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('regen.totalRegen', 'Total Regen kWh')}</p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Activity className="h-4 w-4 mx-auto mb-1 text-cyan-400" />
                <p className="text-lg font-bold text-[var(--text-primary)]">{fmtPercent(data.regenRatio ?? 0)}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('regen.ratioLabel', 'Recovery Rate')}</p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Calendar className="h-4 w-4 mx-auto mb-1 text-amber-400" />
                <p className="text-lg font-bold text-[var(--text-primary)]"><AnimatedNumber value={data.monthlyAvgKw ?? 0} decimals={1} /></p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('regen.monthlyAvg', 'Monthly Avg kW')}</p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Zap className="h-4 w-4 mx-auto mb-1 text-purple-400" />
                <p className="text-lg font-bold text-[var(--text-primary)]"><AnimatedNumber value={data.freeCharges ?? 0} decimals={1} /></p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('regen.freeCharges', 'Free Charges')}</p>
              </GlassPanel>
            </StaggerItem>
          </StaggerContainer>

          {/* Monthly regen trend chart */}
          {monthlyTrend.length > 1 && (
            <FadeIn>
              <ChartContainer title={t('regen.monthlyTrend', 'Monthly Regen Trend')} height={260}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                    <YAxis yAxisId="kwh" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis yAxisId="drives" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar yAxisId="drives" dataKey="drives" name={t('regen.drives', 'Drives')} fill="#a855f7" fillOpacity={0.4} radius={[4, 4, 0, 0]} />
                    <Line yAxisId="kwh" type="monotone" dataKey="regenKwh" name={t('regen.regenKwh', 'Regen kWh')} stroke="#10b981" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartContainer>
            </FadeIn>
          )}

          {/* Regen metrics strip */}
          <FadeIn>
            <GlassPanel className="p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
                <Activity className="h-4 w-4 text-cyan-400" /> {t('regen.metrics', 'Regen Metrics')}
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
                <div>
                  <MetricBar label={t('regen.totalRegenLabel', 'Total Regen')} value={data.totalRegenKwh ?? 0} max={Math.max(data.totalRegenKwh ?? 0, 100)} color="#10b981" />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtNumber(data.totalRegenKwh ?? 0)} kWh</p>
                </div>
                <div>
                  <MetricBar label={t('regen.regenRatioBar', 'Regen Ratio')} value={data.regenRatio ?? 0} max={100} color="#00f0ff" />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtPercent(data.regenRatio ?? 0)}</p>
                </div>
                <div>
                  <MetricBar label={t('regen.monthlyAvgBar', 'Monthly Avg')} value={data.monthlyAvgKw ?? 0} max={Math.max(data.monthlyAvgKw ?? 0, 50)} color="#a855f7" />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtNumber(data.monthlyAvgKw ?? 0)} kW</p>
                </div>
                <div>
                  <MetricBar label={t('regen.freeChargesBar', 'Free Charges')} value={data.freeCharges ?? 0} max={Math.max(data.freeCharges ?? 0, 10)} color="#f59e0b" />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtNumber(data.freeCharges ?? 0)}</p>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Per-drive regen table */}
          <FadeIn>
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
                <Zap className="h-4 w-4 text-green-400" /> {t('regen.recentDrives', 'Recent Regen Drives')}
              </h3>
              {regenDrives.length > 0 ? (
                <div className="overflow-x-auto">
                  <div className="grid grid-cols-4 gap-2 text-xs font-medium text-[var(--text-muted)] mb-2 px-2">
                    <span>{t('regen.date', 'Date')}</span>
                    <span>{t('regen.distanceCol', 'Distance')}</span>
                    <span>{t('regen.maxRegenCol', 'Max Regen')}</span>
                    <span className="text-right">{t('regen.ratioCol', 'Ratio')}</span>
                  </div>
                  {regenDrives.map((rd) => (
                    <div key={rd.id} className="grid grid-cols-4 gap-2 text-xs py-2 px-2 border-t border-white/5">
                      <span className="text-[var(--text-secondary)]">{rd.date}</span>
                      <span className="font-mono text-[var(--text-primary)]">{rd.distance}</span>
                      <span className="font-mono text-cyan-400">{rd.maxRegen}</span>
                      <span className="text-right font-bold" style={{ color: rd.ratio ? regenColor(rd.ratio) : undefined }}>
                        {rd.ratio ? fmtPercent(rd.ratio) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
                  <Activity className="h-8 w-8 opacity-20" />
                  <p className="text-xs">{t('common.noData', 'No data available')}</p>
                </div>
              )}
            </GlassPanel>
          </FadeIn>
        </>
      ) : (
        <EmptyState message={t('regen.noData', 'No regen efficiency data available yet')} />
      )}
    </PageContainer>
  );
}
