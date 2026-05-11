import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Activity, Calendar } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { HelpTooltip } from '@/components/ui/HelpTooltip';
import { Select } from '@/components/ui/Select';
import {
  ChartContainer, ChartTooltip, AREA_DEFAULTS, renderAnnotationLines,
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
import { RangePicker } from '@/components/forms';
import { useRangeState } from '@/hooks/useRangeState';
import { useRegenEfficiency, useDrives } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtPercent, fmtWithUnit } from '@/lib/numberFormat';
import type { Drive } from '@/types/driving';
import { convertDistanceFromSI } from '@/lib/unitConversion';

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
  if (!drive.avgPowerW || drive.avgPowerW <= 0) return null;
  if (!drive.regenEnergyWh || !drive.energyUsedWh || drive.energyUsedWh <= 0) return null;
  return (drive.regenEnergyWh / drive.energyUsedWh) * 100;
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

  const { start, end, setRange } = useRangeState({
    persistKey: 'regen-efficiency.range',
    defaultPresetId: 'all',
  });

  const { data, isLoading, error } = useRegenEfficiency(vehicleIdStr, start, end);
  const { data: allDrives } = useDrives(vehicleIdStr);
  const lifetimeRegenKwh: number | null = null;
  const lifetimeDriveKwh: number | null = null;

  // Narrow drives feeding the client-side monthly trend chart and the
  // recent-drives table to the picked window so they stay in sync with the
  // backend-side gauges/cards.
  const drives = useMemo(() => {
    if (!allDrives?.length) return allDrives;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter((d) => {
      if (!d.startTs) return false;
      const t = new Date(d.startTs).getTime();
      return t >= startMs && t <= endMs;
    });
  }, [allDrives, start, end]);

  const { unitPrefs, formatEnergy, formatPower } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  /* ---- Monthly regen trend from drives ---- */
  const monthlyTrend = useMemo(() => {
    if (!drives || drives.length === 0) return [];
    const byMonth = new Map<string, { totalRegen: number; count: number; totalDist: number }>();
    drives.forEach((d) => {
      const month = d.startTs?.substring(0, 7);
      if (!month) return;
      const regen = d.regenEnergyWh ?? 0;
      const existing = byMonth.get(month) ?? { totalRegen: 0, count: 0, totalDist: 0 };
      existing.totalRegen += regen;
      existing.count++;
      existing.totalDist += d.distanceM;
      byMonth.set(month, existing);
    });
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, val]) => ({
        month,
        regenKwh: parseFloat(fmtNumber(val.totalRegen / 1000, 1)),
        drives: val.count,
        distance: Math.round(toDistanceDisplay(val.totalDist)),
      }));
  }, [drives, toDistanceDisplay]);

  /* ---- Per-drive regen list ---- */
  const regenDrives = useMemo(() => {
    if (!drives) return [];
    return drives
      .filter((d) => d.regenEnergyWh && d.regenEnergyWh > 0)
      .slice(0, 20)
      .map((d) => ({
        id: d.id,
        date: d.startTs ? formatDateShort(d.startTs) : '—',
        distance: fmtWithUnit(toDistanceDisplay(d.distanceM), distanceUnit),
        maxRegen: d.regenEnergyWh ? fmtWithUnit(d.regenEnergyWh / 1000, 'kWh') : '—',
        ratio: getRegenRatio(d),
      }));
  }, [drives, toDistanceDisplay, distanceUnit]);

  const vehicleOptions = (vehicles ?? []).map((v) => ({
    value: String(v.id), label: v.display_name || v.vin,
  }));

  return (
    <PageContainer
      title={t('regen.title', 'Regenerative Braking')}
      subtitle={t('regen.subtitle', 'Energy recovery analysis and regen efficiency')}
      error={error as Error | null}
      actions={
        <div className="flex items-center gap-3">
          {vehicleOptions.length > 0 ? (
            <Select value={String(vehicleId ?? '')} onChange={(e) => setSelectedVehicle(Number(e.target.value))} options={vehicleOptions} />
          ) : null}
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="regen-efficiency-range"
          />
        </div>
      }
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
                {t('regen.recoveredInfo', 'You\'ve recovered {{energy}} — equivalent to ~{{charges}} free charges.', {
                  energy: formatEnergy(data.totalRegenWh ?? 0, { precision: 1 }),
                  charges: fmtNumber(data.freeCharges ?? 0),
                })}
              </p>
            </GlassPanel>
          </FadeIn>

          {/* Stat cards */}
          <StaggerContainer className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Zap className="h-4 w-4 mx-auto mb-1 text-green-400" />
                <p className="text-lg font-bold text-[var(--text-primary)]">{formatEnergy(data.totalRegenWh ?? 0, { precision: 1 })}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('regen.totalRegen', 'Total Regen')}</p>
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
                <p className="text-lg font-bold text-[var(--text-primary)]">{formatPower(data.monthlyAvgRegen ?? 0, { precision: 1 })}</p>
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
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Zap className="h-4 w-4 mx-auto mb-1 text-emerald-400" />
                <p className="text-lg font-bold text-[var(--text-primary)]">
                  {lifetimeRegenKwh != null ? (
                    <AnimatedNumber value={lifetimeRegenKwh} decimals={1} />
                  ) : (
                    '—'
                  )}
                </p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {t('regen.lifetimeRegen', 'Lifetime Regen kWh')}
                </p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Activity className="h-4 w-4 mx-auto mb-1 text-orange-400" />
                <p className="text-lg font-bold text-[var(--text-primary)]">
                  {lifetimeDriveKwh != null ? (
                    <AnimatedNumber value={lifetimeDriveKwh} decimals={1} />
                  ) : (
                    '—'
                  )}
                </p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {t('regen.lifetimeDrive', 'Lifetime Drive kWh')}
                </p>
              </GlassPanel>
            </StaggerItem>
          </StaggerContainer>

          {/* Monthly regen trend chart */}
          {monthlyTrend.length > 1 && (
            <FadeIn>
              <ChartContainer
                title={t('regen.monthlyTrend', 'Monthly Regen Trend')}
                ariaLabel={t('regen.monthlyTrend.aria', 'Monthly regen energy and drive count composed chart')}
                data={monthlyTrend.map((m) => ({
                  month: m.month,
                  regenKwh: m.regenKwh,
                  drives: m.drives,
                }))}
                dataColumns={[
                  { key: 'month', label: t('regen.col.month', 'Month') },
                  { key: 'regenKwh', label: t('regen.col.regenKwh', 'Regen kWh') },
                  { key: 'drives', label: t('regen.col.drives', 'Drives') },
                ]}
                height={260}
                annotations={{ vehicleId, scope: 'efficiency', chartId: 'regen-monthly-trend' }}
              >
                {({ annotations: chartAnnotations }) => (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={monthlyTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                      <YAxis yAxisId="kwh" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <YAxis yAxisId="drives" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} />
                      {renderAnnotationLines(chartAnnotations, (ts) => ts)}
                      <Bar yAxisId="drives" dataKey="drives" name={t('regen.drives', 'Drives')} fill="#a855f7" fillOpacity={0.4} radius={[4, 4, 0, 0]} />
                      <Line {...AREA_DEFAULTS} yAxisId="kwh" dataKey="regenKwh" name={t('regen.regenKwh', 'Regen kWh')} stroke="#10b981" />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </ChartContainer>
            </FadeIn>
          )}

          {/* Regen metrics strip */}
          <FadeIn>
            <GlassPanel className="p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
                <Activity className="h-4 w-4 text-cyan-400" /> {t('regen.metrics', 'Regen Metrics')}
                <HelpTooltip
                  size="sm"
                  i18nKey="help.regenEfficiency.body"
                  defaultValue="Energy recovered through regenerative braking divided by total energy used during driving. Higher is better — Tesla cars typically reach 15–30% recovery in mixed driving."
                  ariaLabel={t('help.regenEfficiency.iconLabel', { defaultValue: 'More info about regen metrics' })}
                />
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
                <div>
                  <MetricBar label={t('regen.totalRegenLabel', 'Total Regen')} value={data.totalRegenWh ?? 0} max={Math.max(data.totalRegenWh ?? 0, 100000)} color="#10b981" />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{formatEnergy(data.totalRegenWh ?? 0, { precision: 1 })}</p>
                </div>
                <div>
                  <MetricBar label={t('regen.regenRatioBar', 'Regen Ratio')} value={data.regenRatio ?? 0} max={100} color="#00f0ff" />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtPercent(data.regenRatio ?? 0)}</p>
                </div>
                <div>
                  <MetricBar label={t('regen.monthlyAvgBar', 'Monthly Avg')} value={data.monthlyAvgRegen ?? 0} max={Math.max(data.monthlyAvgRegen ?? 0, 50)} color="#a855f7" />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{formatPower(data.monthlyAvgRegen ?? 0, { precision: 1 })}</p>
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
                    <div key={rd.id} className="grid grid-cols-4 gap-2 text-xs py-2 px-2 border-t border-[var(--border-subtle)]">
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
                <EmptyState
                  icon={<Activity className="h-8 w-8 opacity-20" />}
                  message={t('common.noData', 'No data available')}
                  className="py-8"
                />
              )}
            </GlassPanel>
          </FadeIn>
        </>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('regen.noData', 'No regen efficiency data available yet')} />
      )}
    </PageContainer>
  );
}
