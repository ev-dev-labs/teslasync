import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, TrendingUp, Thermometer, Fuel, Gauge } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { DataTable } from '@/components/ui/DataTable';
import { MetricBar } from '@/components/data-display/MetricBar';
import {
  ChartContainer, ChartTooltip, renderAnnotationLines, AddAnnotationPopover,
  AREA_DEFAULTS, areaGradient,
  AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from '@/components/charts';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { DateRangeFilter } from '@/components/forms/DateRangeFilter';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useDrivingStats, useDrives } from '@/api/hooks/useDriving';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAnnotations } from '@/hooks/useAnnotations';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { Drive } from '@/types/driving';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function efficiencyColor(wh: number): string {
  if (wh < 140) return '#39ff14';
  if (wh < 170) return '#10b981';
  if (wh < 200) return '#00f0ff';
  if (wh < 240) return '#f59e0b';
  return '#ef4444';
}

function getEfficiency(drive: Drive): number | null {
  const battUsed = (drive.startBatteryPct ?? 0) - (drive.endBatteryPct ?? 0);
  if (drive.distanceMi > 0 && battUsed > 0) return (battUsed * 0.75 * 1000) / drive.distanceMi;
  return null;
}

/* ------------------------------------------------------------------ */
/*  EfficiencyPage                                                    */
/* ------------------------------------------------------------------ */

export default function EfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('efficiency.title', 'Efficiency'));

  // Phase 40 / Prompt 16: header VehiclePicker is the source of truth.
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { data: stats } = useDrivingStats(vehicleIdStr);
  const { data: drives } = useDrives(vehicleIdStr);

  /* Annotations */
  const { annotations, addAnnotation, removeAnnotation } = useAnnotations('efficiency', vehicleId);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [pendingTimestamp, setPendingTimestamp] = useState<string | null>(null);

  const handleChartClick = useCallback(
    (state: { activeLabel?: string }) => {
      if (isAnnotating && state?.activeLabel) {
        setPendingTimestamp(String(state.activeLabel));
      }
    },
    [isAnnotating],
  );

  const handleAddAnnotation = useCallback(
    (label: string, category: Parameters<typeof addAnnotation>[2], description?: string) => {
      if (pendingTimestamp) {
        addAnnotation(pendingTimestamp, label, category, description);
        setPendingTimestamp(null);
        setIsAnnotating(false);
      }
    },
    [pendingTimestamp, addAnnotation],
  );

  const {
    convertDistance, convertSpeed, convertTemp, convertEfficiency,
    distanceUnit, speedUnit, tempUnit, efficiencyUnit, isFahrenheit,
  } = useSettings();

  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  /* ---- Filtered drives ---- */
  const filteredDrives = useMemo(() => {
    if (!drives) return [];
    return drives.filter((d) => {
      const driveDate = d.startTs?.split('T')[0];
      if (!driveDate) return true;
      if (startDate && driveDate < startDate) return false;
      if (endDate && driveDate > endDate) return false;
      return true;
    });
  }, [drives, startDate, endDate]);

  /* ---- Daily efficiency trend ---- */
  const dailyTrend = useMemo(() => {
    return filteredDrives
      .filter((d) => getEfficiency(d) !== null)
      .slice(0, 30)
      .reverse()
      .map((d) => ({
        date: formatDateShort(d.startTs),
        efficiency: Math.round(convertEfficiency(getEfficiency(d)!)),
        distance: parseFloat(fmtNumber(convertDistance(d.distanceMi ?? 0), 1)),
      }));
  }, [filteredDrives, convertEfficiency, convertDistance]);

  /* ---- Speed vs Efficiency scatter ---- */
  const speedVsEff = useMemo(() => {
    return filteredDrives
      .filter((d) => d.avgSpeedMph && getEfficiency(d))
      .map((d) => ({
        speed: Math.round(convertSpeed(d.avgSpeedMph!)),
        efficiency: Math.round(convertEfficiency(getEfficiency(d)!)),
      }));
  }, [filteredDrives, convertSpeed, convertEfficiency]);

  /* ---- Temp vs Efficiency scatter ---- */
  const tempVsEff = useMemo(() => {
    return filteredDrives
      .filter((d) => d.outsideTempAvgC !== null && getEfficiency(d))
      .map((d) => ({
        temp: Math.round(convertTemp(d.outsideTempAvgC!)),
        efficiency: Math.round(convertEfficiency(getEfficiency(d)!)),
      }));
  }, [filteredDrives, convertTemp, convertEfficiency]);

  /* ---- Speed distribution ---- */
  const speedDist = useMemo(() => {
    const buckets = [
      { range: `0–30`, min: 0, max: 30, count: 0, totalEff: 0 },
      { range: `30–60`, min: 30, max: 60, count: 0, totalEff: 0 },
      { range: `60–90`, min: 60, max: 90, count: 0, totalEff: 0 },
      { range: `90–120`, min: 90, max: 120, count: 0, totalEff: 0 },
      { range: `120+`, min: 120, max: 999, count: 0, totalEff: 0 },
    ];
    filteredDrives.forEach((d) => {
      if (d.avgSpeedMph == null) return;
      const eff = getEfficiency(d);
      if (!eff) return;
      const b = buckets.find((bk) => d.avgSpeedMph! >= bk.min && d.avgSpeedMph! < bk.max);
      if (b) { b.count++; b.totalEff += eff; }
    });
    return buckets.filter((b) => b.count > 0).map((b) => ({
      range: `${b.range} ${speedUnit}`,
      avgEff: Math.round(convertEfficiency(b.totalEff / b.count)),
      count: b.count,
    }));
  }, [filteredDrives, speedUnit, convertEfficiency]);

  /* ---- Temperature-bucketed efficiency ---- */
  const tempBuckets = useMemo(() => {
    const ranges = isFahrenheit
      ? [
          { range: '< 32°F', min: -999, max: 0 },
          { range: '32–50°F', min: 0, max: 10 },
          { range: '50–68°F', min: 10, max: 20 },
          { range: '68–86°F', min: 20, max: 30 },
          { range: '> 86°F', min: 30, max: 999 },
        ]
      : [
          { range: '< 0°C', min: -999, max: 0 },
          { range: '0–10°C', min: 0, max: 10 },
          { range: '10–20°C', min: 10, max: 20 },
          { range: '20–30°C', min: 20, max: 30 },
          { range: '> 30°C', min: 30, max: 999 },
        ];
    const buckets = ranges.map((r) => ({
      ...r,
      count: 0,
      totalEff: 0,
      totalDist: 0,
      totalSpeed: 0,
    }));
    filteredDrives.forEach((d) => {
      if (d.outsideTempAvgC == null) return;
      const eff = getEfficiency(d);
      if (!eff) return;
      const b = buckets.find((bk) => d.outsideTempAvgC! >= bk.min && d.outsideTempAvgC! < bk.max);
      if (b) {
        b.count++;
        b.totalEff += eff;
        b.totalDist += d.distanceMi;
        b.totalSpeed += d.avgSpeedMph ?? 0;
      }
    });
    return buckets
      .filter((b) => b.count > 0)
      .map((b) => ({
        range: b.range,
        count: b.count,
        avgEff: b.totalEff / b.count,
        totalDist: b.totalDist,
        avgSpeed: b.totalSpeed / b.count,
      }));
  }, [filteredDrives, isFahrenheit]);

  /* ---- Computed metrics ---- */
  const costPerKm = stats && stats.totalDistanceKm > 0
    ? fmtNumber((stats.avgEfficiencyWhKm / 1000) * 0.12, 3)
    : '—';
  const kmPerKwh = stats && stats.avgEfficiencyWhKm > 0
    ? fmtNumber(1000 / stats.avgEfficiencyWhKm, 1)
    : '—';

  return (
    <PageContainer
      title={t('efficiency.title', 'Efficiency')}
      subtitle={t('efficiency.subtitle', 'Energy consumption and driving efficiency analysis')}
      error={null}
    >
      {/* Date filter */}
      <FadeIn>
        <DateRangeFilter
          startDate={startDate} endDate={endDate}
          onStartDateChange={setStartDate} onEndDateChange={setEndDate}
        />
      </FadeIn>

      {/* Hero gauges */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          {stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 items-center">
              <RadialGauge
                value={Math.round(convertEfficiency(stats.avgEfficiencyWhKm))}
                max={300}
                label={`${t('efficiency.avg', 'Avg')} ${efficiencyUnit}`}
                color={efficiencyColor(stats.avgEfficiencyWhKm)}
              />
              <div className="flex flex-col items-center text-center">
                <p className="text-2xl font-bold text-[var(--text-primary)]">
                  <AnimatedNumber value={Number(kmPerKwh) || 0} decimals={1} />
                </p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">
                  {t('efficiency.kmPerKwh', 'km/kWh')}
                </p>
              </div>
              <div className="flex flex-col items-center text-center">
                <p className="text-2xl font-bold text-green-400">
                  <AnimatedNumber value={Math.round(stats.co2SavedKg)} />
                </p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">
                  {t('efficiency.co2Saved', 'CO₂ Saved (kg)')}
                </p>
              </div>
              <div className="flex flex-col items-center text-center">
                <p className="text-2xl font-bold text-cyan-400">
                  <AnimatedNumber value={Math.round(convertDistance(stats.totalDistanceKm))} />
                </p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">
                  {t('efficiency.totalDistance', 'Total')} {distanceUnit}
                </p>
              </div>
            </div>
          ) : (
            <EmptyState message={t('efficiency.noStats', 'No efficiency data available yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Stat cards */}
      {stats ? (
        <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StaggerItem>
            <GlassPanel className="p-4 text-center">
              <Zap className="h-4 w-4 mx-auto mb-1 text-amber-400" />
              <p className="text-lg font-bold text-[var(--text-primary)]">{fmtNumber(convertEfficiency(stats.avgEfficiencyWhKm))}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{t('efficiency.avgConsumption', 'Avg')} {efficiencyUnit}</p>
            </GlassPanel>
          </StaggerItem>
          <StaggerItem>
            <GlassPanel className="p-4 text-center">
              <TrendingUp className="h-4 w-4 mx-auto mb-1 text-green-400" />
              <p className="text-lg font-bold text-[var(--text-primary)]">{fmtNumber(convertSpeed(stats.avgSpeedKmh))}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{t('efficiency.avgSpeed', 'Avg Speed')} {speedUnit}</p>
            </GlassPanel>
          </StaggerItem>
          <StaggerItem>
            <GlassPanel className="p-4 text-center">
              <Fuel className="h-4 w-4 mx-auto mb-1 text-cyan-400" />
              <p className="text-lg font-bold text-[var(--text-primary)]">${costPerKm}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{t('efficiency.costPerKm', 'Est. Cost/km')}</p>
            </GlassPanel>
          </StaggerItem>
          <StaggerItem>
            <GlassPanel className="p-4 text-center">
              <Gauge className="h-4 w-4 mx-auto mb-1 text-purple-400" />
              <p className="text-lg font-bold text-[var(--text-primary)]">{stats.totalDrives}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{t('efficiency.drivesAnalyzed', 'Drives Analyzed')}</p>
            </GlassPanel>
          </StaggerItem>
        </StaggerContainer>
      ) : (
        <GlassPanel className="p-6">
          <EmptyState message={t('efficiency.noStatCards', 'No driving statistics available yet')} />
        </GlassPanel>
      )}

      {/* Charts row 1 */}
      {dailyTrend.length > 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FadeIn>
            <ChartContainer
              title={t('efficiency.dailyTrend', `Daily Efficiency (${efficiencyUnit})`)}
              height={240}
              annotations={annotations}
              isAnnotating={isAnnotating}
              onAnnotateToggle={() => setIsAnnotating((v) => !v)}
              onRemoveAnnotation={removeAnnotation}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyTrend} onClick={handleChartClick}>
                  {areaGradient('effGrad', '#00f0ff')}
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  {renderAnnotationLines(annotations, (ts) => ts)}
                  <Area {...AREA_DEFAULTS} dataKey="efficiency" stroke="#00f0ff" fill="url(#effGrad)" name={efficiencyUnit} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
            <AddAnnotationPopover
              open={pendingTimestamp != null}
              timestamp={pendingTimestamp ?? ''}
              onAdd={handleAddAnnotation}
              onCancel={() => setPendingTimestamp(null)}
            />
          </FadeIn>

          <FadeIn>
            <ChartContainer title={t('efficiency.speedDist', 'Efficiency by Speed Range')} height={240}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={speedDist}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="avgEff" name={`${t('efficiency.avg', 'Avg')} ${efficiencyUnit}`} radius={[4, 4, 0, 0]}>
                    {speedDist.map((entry, i) => (
                      <Cell key={i} fill={efficiencyColor(entry.avgEff)} fillOpacity={0.7} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>
        </div>
      )}

      {/* Charts row 2: scatter plots */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {speedVsEff.length > 3 && (
          <FadeIn>
            <ChartContainer title={t('efficiency.speedVsEfficiency', 'Speed vs Efficiency')} height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="speed" name={t('efficiency.speed', 'Speed')} unit={` ${speedUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis dataKey="efficiency" name={efficiencyUnit} unit={` ${efficiencyUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Scatter data={speedVsEff} fill="#f59e0b" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>
        )}

        {tempVsEff.length > 3 && (
          <FadeIn>
            <ChartContainer title={t('efficiency.tempVsEfficiency', 'Temperature vs Efficiency')} height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="temp" name={t('efficiency.temp', 'Temp')} unit={` ${tempUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis dataKey="efficiency" name={efficiencyUnit} unit={` ${efficiencyUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Scatter data={tempVsEff} fill="#a855f7" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>
        )}
      </div>

      {/* Temperature-Bucketed Efficiency Table */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
            <Thermometer className="h-4 w-4 text-orange-400" /> {t('efficiency.tempEfficiency', 'Efficiency by Temperature Range')}
          </h3>
          {tempBuckets.length > 0 ? (
            <DataTable
              data={tempBuckets}
              keyExtractor={(b) => b.range}
              compact
              pagination
              columns={[
                {
                  key: 'range',
                  header: t('efficiency.tempRange', 'Temp Range'),
                  render: (b) => <span className="font-medium text-[var(--text-primary)]">{b.range}</span>,
                },
                {
                  key: 'count',
                  header: t('efficiency.drives', 'Drives'),
                  className: 'text-right',
                  render: (b) => <span className="text-[var(--text-secondary)]">{b.count}</span>,
                },
                {
                  key: 'avgEff',
                  header: `${t('efficiency.avg', 'Avg')} ${efficiencyUnit}`,
                  className: 'text-right',
                  render: (b) => (
                    <span style={{ color: efficiencyColor(b.avgEff) }}>
                      {fmtInt(convertEfficiency(b.avgEff))}
                    </span>
                  ),
                },
                {
                  key: 'kmPerKwh',
                  header: `${distanceUnit}/kWh`,
                  className: 'text-right',
                  render: (b) => (
                    <span className="text-cyan-400">{b.avgEff > 0 ? fmtNumber(1000 / convertEfficiency(b.avgEff)) : '—'}</span>
                  ),
                },
                {
                  key: 'totalDist',
                  header: `${t('efficiency.total', 'Total')} ${distanceUnit}`,
                  className: 'text-right',
                  render: (b) => <span className="text-[var(--text-secondary)]">{fmtInt(convertDistance(b.totalDist))}</span>,
                },
                {
                  key: 'avgSpeed',
                  header: t('efficiency.avgSpeedCol', 'Avg Speed'),
                  className: 'text-right',
                  render: (b) => <span className="text-[var(--text-secondary)]">{fmtInt(convertSpeed(b.avgSpeed))} {speedUnit}</span>,
                },
              ]}
            />
          ) : (
            <EmptyState message={t('efficiency.noTempData', 'Not enough data for temperature breakdown')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Metric bars summary */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          {stats ? (
            <>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
                <Zap className="h-4 w-4 text-amber-400" /> {t('efficiency.summary', 'Efficiency Summary')}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <MetricBar label={t('efficiency.avgConsumption', 'Avg Consumption')} value={convertEfficiency(stats.avgEfficiencyWhKm)} max={300} color="#00f0ff" />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtNumber(convertEfficiency(stats.avgEfficiencyWhKm))} {efficiencyUnit}</p>
                </div>
                <div>
                  <MetricBar label={t('efficiency.avgSpeed', 'Avg Speed')} value={convertSpeed(stats.avgSpeedKmh)} max={150} color="#10b981" />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtInt(convertSpeed(stats.avgSpeedKmh))} {speedUnit}</p>
                </div>
                <div>
                  <MetricBar label={t('efficiency.regenRatio', 'Regen Ratio')} value={stats.regenRatio * 100} max={100} color="#a855f7" />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtNumber(stats.regenRatio * 100)}%</p>
                </div>
                <div>
                  <MetricBar label={t('efficiency.totalDriveTime', 'Total Drive Time')} value={stats.totalDurationMin} max={Math.max(stats.totalDurationMin, 600)} color="#f59e0b" />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtInt(stats.totalDurationMin / 60)} {t('efficiency.hours', 'h')}</p>
                </div>
              </div>
            </>
          ) : (
            <EmptyState message={t('efficiency.noSummary', 'No efficiency summary available yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Energy insights */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          {stats ? (
            <>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
                <Thermometer className="h-4 w-4 text-orange-400" /> {t('efficiency.insights', 'Energy Insights')}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('efficiency.totalRegen', 'Total Regen')}</p>
                  <p className="text-lg font-bold text-green-400">{fmtNumber(stats.totalRegenKwh)} <span className="text-xs text-[var(--text-muted)]">kWh</span></p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('efficiency.regenRatioLabel', 'Regen Ratio')}</p>
                  <p className="text-lg font-bold text-cyan-400">{fmtNumber(stats.regenRatio * 100)}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('efficiency.co2Label', 'CO₂ Saved')}</p>
                  <p className="text-lg font-bold text-green-400">{fmtInt(stats.co2SavedKg)} <span className="text-xs text-[var(--text-muted)]">kg</span></p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('efficiency.totalDistLabel', 'Total Distance')}</p>
                  <p className="text-lg font-bold text-cyan-400">{fmtInt(convertDistance(stats.totalDistanceKm))} <span className="text-xs text-[var(--text-muted)]">{distanceUnit}</span></p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('efficiency.topSpeed', 'Top Speed')}</p>
                  <p className="text-lg font-bold text-purple-400">{fmtInt(convertSpeed(stats.topSpeedKmh))} <span className="text-xs text-[var(--text-muted)]">{speedUnit}</span></p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-1">{t('efficiency.costPerKmLabel', 'Est. Cost/km')}</p>
                  <p className="text-lg font-bold text-amber-400">${costPerKm}</p>
                </div>
              </div>
            </>
          ) : (
            <EmptyState message={t('efficiency.noInsights', 'No energy insights available yet')} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
