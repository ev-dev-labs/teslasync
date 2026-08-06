import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap, Activity, Calendar, BatteryCharging, Leaf, Gauge, TrendingUp,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, HelpTooltip, PanelTitle, Text, DataTable, type Column } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard, MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartContainer, ChartTooltip, AREA_DEFAULTS, renderAnnotationLines,
  ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadialGauge,
} from '@/components/charts';

import { useRangeState } from '@/hooks/useRangeState';
import { useRegenEfficiency, useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Threshold color for a regen ratio (%). Higher recovery reads greener. */
export function regenColor(ratio: number): string {
  if (ratio >= 25) return chartTokens.series[1]; // emerald
  if (ratio >= 15) return chartTokens.series[5]; // cyan
  if (ratio >= 8) return chartTokens.series[2];  // amber
  return chartTokens.series[3];                   // rose
}

/**
 * Per-drive regen recovery ratio (regen energy ÷ energy used, as a %), or
 * `null` when the drive lacks the energy inputs.
 *
 * The ratio is a pure function of the two energy counters; it must NOT be
 * gated on `avgPowerW`. `avgPowerW` is an independently-nullable field, so the
 * old guard silently hid a valid ratio for every drive imported without power
 * telemetry — the recent-drives table showed "—" even though regen and energy
 * were both present.
 */
export function getRegenRatio(drive: Drive): number | null {
  const regen = drive.regenEnergyWh ?? 0;
  const used = drive.energyUsedWh ?? 0;
  if (regen <= 0 || used <= 0) return null;
  return (regen / used) * 100;
}

interface RegenDriveRow {
  id: number;
  date: string;
  distance: string;
  maxRegen: string;
  ratio: number | null;
}

// Type alias (not interface) so it carries an implicit index signature and
// stays assignable to ChartContainer's `ChartDataRow` fallback-table shape.
export type MonthlyTrendPoint = {
  month: string;
  regenKwh: number;
  drives: number;
};

/**
 * Aggregate in-range drives into a month-bucketed regen trend (most recent 12
 * months). Regen energy is summed in Wh then converted to kWh with a pure
 * numeric round to 1 decimal.
 *
 * Rounding is deliberately numeric (`Math.round(x * 10) / 10`) rather than
 * `parseFloat(fmtNumber(x, 1))`: the locale formatter injects a thousands
 * separator (en-US "1,234.5" → `parseFloat` truncates to `1`) and non-'.'
 * decimal locales (de-DE "1234,5") drop the fraction entirely, both of which
 * corrupt the chart series for high-regen months.
 */
export function buildMonthlyTrend(drives: Drive[]): MonthlyTrendPoint[] {
  if (drives.length === 0) return [];
  const byMonth = new Map<string, { totalRegen: number; count: number }>();
  for (const d of drives) {
    const month = d.startTs?.substring(0, 7);
    if (!month) continue;
    const existing = byMonth.get(month) ?? { totalRegen: 0, count: 0 };
    existing.totalRegen += d.regenEnergyWh ?? 0;
    existing.count += 1;
    byMonth.set(month, existing);
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, val]) => ({
      month,
      regenKwh: Math.round((val.totalRegen / 1000) * 10) / 10,
      drives: val.count,
    }));
}

const SERIES_REGEN = chartTokens.series[1];  // emerald
const SERIES_DRIVES = chartTokens.series[4]; // purple

/* ------------------------------------------------------------------ */
/*  RegenEfficiencyPage                                               */
/* ------------------------------------------------------------------ */

export default function RegenEfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('regen.title', 'Regenerative Braking'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { start, end, setRange } = useRangeState({
    persistKey: 'regen-efficiency.range',
    defaultPresetId: 'all',
  });

  const regenQuery = useRegenEfficiency(vehicleIdStr, start, end);
  const { data, isLoading, isError, error, refetch } = regenQuery;

  const drivesQuery = useDrives(vehicleIdStr);
  const {
    data: allDrives,
    isLoading: drivesLoading,
    isError: drivesIsError,
    error: drivesError,
  } = drivesQuery;

  // Lifetime figures don't yet have a backing endpoint — surfaced as
  // placeholders so the KPI band stays structurally complete.
  const lifetimeRegenKwh: number | null = null;
  const lifetimeDriveKwh: number | null = null;

  const { formatDistance, formatEnergy, formatPower } = useUnits();

  // Narrow drives to the picked window so the client-side trend chart and
  // the recent-drives table stay in sync with the backend-side gauges/cards.
  const drives = useMemo<Drive[]>(() => {
    if (!allDrives?.length) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  /* ---- Monthly regen trend from drives ---- */
  const monthlyTrend = useMemo<MonthlyTrendPoint[]>(() => buildMonthlyTrend(drives), [drives]);

  /* ---- Per-drive regen list ---- */
  const regenDrives = useMemo<RegenDriveRow[]>(() => {
    return drives
      .filter((d) => d.regenEnergyWh && d.regenEnergyWh > 0)
      .slice(0, 20)
      .map((d) => ({
        id: d.id,
        date: d.startTs ? formatDateShort(d.startTs) : '—',
        distance: formatDistance(d.distanceM),
        maxRegen: d.regenEnergyWh != null ? formatEnergy(d.regenEnergyWh, { precision: 1 }) : '—',
        ratio: getRegenRatio(d),
      }));
  }, [drives, formatDistance, formatEnergy]);

  const columns = useMemo<Column<RegenDriveRow>[]>(() => [
    {
      key: 'date',
      header: t('regen.date', 'Date'),
      sortable: true,
      render: (r) => <Text variant="bodySm">{r.date}</Text>,
    },
    {
      key: 'distance',
      header: t('regen.distanceCol', 'Distance'),
      align: 'right',
      render: (r) => <Text variant="body" className="font-mono tabular-nums">{r.distance}</Text>,
    },
    {
      key: 'maxRegen',
      header: t('regen.maxRegenCol', 'Max Regen'),
      align: 'right',
      render: (r) => (
        <Text variant="body" className="font-mono tabular-nums text-cyan-300">{r.maxRegen}</Text>
      ),
    },
    {
      key: 'ratio',
      header: t('regen.ratioCol', 'Ratio'),
      align: 'right',
      sortable: true,
      render: (r) =>
        r.ratio != null ? (
          <Text
            variant="body"
            className="font-mono font-semibold tabular-nums"
            style={{ color: regenColor(r.ratio) }}
          >
            {fmtPercent(r.ratio)}
          </Text>
        ) : (
          <Text variant="caption">—</Text>
        ),
    },
  ], [t]);

  const recoveredCaption = t(
    'regen.recoveredInfo',
    "You've recovered {{energy}} — equivalent to ~{{charges}} free charges.",
    {
      energy: formatEnergy(data?.totalRegenWh ?? 0, { precision: 1 }),
      charges: fmtNumber(data?.freeCharges ?? 0),
    },
  );

  return (
    <PageContainer
      title={t('regen.title', 'Regenerative Braking')}
      subtitle={t('regen.subtitle', 'Energy recovery analysis and regen efficiency')}
      query={regenQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="regen-efficiency-range"
          />
        </div>
      }
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('regen.kpis', 'Regen summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 xl:grid-cols-6"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={error} onRetry={() => refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('regen.totalRegen', 'Total Regen')}
                value={formatEnergy(data?.totalRegenWh ?? 0, { precision: 1 })}
                icon={<Leaf className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('regen.ratioLabel', 'Recovery Rate')}
                value={fmtPercent(data?.regenRatio ?? 0)}
                icon={<Activity className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('regen.monthlyAvg', 'Monthly Avg kW')}
                value={formatPower(data?.monthlyAvgRegen ?? 0, { precision: 1 })}
                icon={<Calendar className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('regen.freeCharges', 'Free Charges')}
                value={fmtNumber(data?.freeCharges ?? 0)}
                icon={<BatteryCharging className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('regen.lifetimeRegen', 'Lifetime Regen kWh')}
                value={lifetimeRegenKwh != null ? fmtNumber(lifetimeRegenKwh, 1) : '—'}
                icon={<Zap className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('regen.lifetimeDrive', 'Lifetime Drive kWh')}
                value={lifetimeDriveKwh != null ? fmtNumber(lifetimeDriveKwh, 1) : '—'}
                icon={<Gauge className="h-5 w-5" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Hero gauge + monthly trend (1/3 + 2/3 bento) */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('regen.recoveryTitle', 'Energy Recovery')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={220} />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : !data ? (
              <EmptyState
                icon={<Gauge className="h-8 w-8" />}
                message={t('regen.noData', 'No regen efficiency data available yet')}
                actionTo={{ label: t('regen.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-2">
                <RadialGauge
                  value={Math.round(data.regenRatio ?? 0)}
                  max={100}
                  label={t('regen.regenRatio', 'Regen Ratio')}
                  unit="%"
                  color={regenColor(data.regenRatio ?? 0)}
                  size={168}
                />
                <Text variant="caption" as="p" className="max-w-xs text-center">
                  {recoveredCaption}
                </Text>
              </div>
            )}
          </GlassPanel>

          {drivesIsError ? (
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                {t('regen.monthlyTrend', 'Monthly Regen Trend')}
              </PanelTitle>
              <QueryError error={drivesError} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : (
            <ChartContainer
              className="xl:col-span-2"
              title={t('regen.monthlyTrend', 'Monthly Regen Trend')}
              ariaLabel={t('regen.monthlyTrend.aria', 'Monthly regen energy and drive count composed chart')}
              loading={drivesLoading}
              empty={monthlyTrend.length < 2}
              height={300}
              data={monthlyTrend}
              dataColumns={[
                { key: 'month', label: t('regen.col.month', 'Month') },
                { key: 'regenKwh', label: t('regen.col.regenKwh', 'Regen kWh') },
                { key: 'drives', label: t('regen.col.drives', 'Drives') },
              ]}
              annotations={{ vehicleId, scope: 'efficiency', chartId: 'regen-monthly-trend' }}
            >
              {({ annotations: chartAnnotations }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis yAxisId="kwh" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis yAxisId="drives" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    {renderAnnotationLines(chartAnnotations, (ts) => ts)}
                    <Bar yAxisId="drives" dataKey="drives" name={t('regen.drives', 'Drives')} fill={SERIES_DRIVES} fillOpacity={0.4} radius={[4, 4, 0, 0]} />
                    <Line {...AREA_DEFAULTS} yAxisId="kwh" dataKey="regenKwh" name={t('regen.regenKwh', 'Regen kWh')} stroke={SERIES_REGEN} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </ChartContainer>
          )}
        </section>
      </FadeIn>

      {/* 3 — Regen metrics + recent drives (1/3 + 2/3 bento) */}
      <FadeIn delay={0.2}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('regen.metrics', 'Regen Metrics')}
              <HelpTooltip
                size="sm"
                i18nKey="help.regenEfficiency.body"
                defaultValue="Energy recovered through regenerative braking divided by total energy used during driving. Higher is better — Tesla cars typically reach 15–30% recovery in mixed driving."
                ariaLabel={t('help.regenEfficiency.iconLabel', 'More info about regen metrics')}
              />
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={200} />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : !data ? (
              <EmptyState
                icon={<Activity className="h-8 w-8" />}
                message={t('regen.noData', 'No regen efficiency data available yet')}
                actionTo={{ label: t('regen.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <div className="space-y-4">
                <MetricBar
                  label={t('regen.totalRegenLabel', 'Total Regen')}
                  value={data.totalRegenWh ?? 0}
                  max={Math.max(data.totalRegenWh ?? 0, 100000)}
                  color={SERIES_REGEN}
                  sublabel={formatEnergy(data.totalRegenWh ?? 0, { precision: 1 })}
                />
                <MetricBar
                  label={t('regen.regenRatioBar', 'Regen Ratio')}
                  value={data.regenRatio ?? 0}
                  max={100}
                  color={chartTokens.series[5]}
                  sublabel={fmtPercent(data.regenRatio ?? 0)}
                />
                <MetricBar
                  label={t('regen.monthlyAvgBar', 'Monthly Avg')}
                  value={data.monthlyAvgRegen ?? 0}
                  max={Math.max(data.monthlyAvgRegen ?? 0, 50)}
                  color={SERIES_DRIVES}
                  sublabel={formatPower(data.monthlyAvgRegen ?? 0, { precision: 1 })}
                />
                <MetricBar
                  label={t('regen.freeChargesBar', 'Free Charges')}
                  value={data.freeCharges ?? 0}
                  max={Math.max(data.freeCharges ?? 0, 10)}
                  color={chartTokens.series[2]}
                  sublabel={fmtNumber(data.freeCharges ?? 0)}
                />
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('regen.recentDrives', 'Recent Regen Drives')}
            </PanelTitle>
            {drivesIsError ? (
              <QueryError error={drivesError} onRetry={() => drivesQuery.refetch()} />
            ) : drivesLoading ? (
              <Skeleton height={260} />
            ) : (
              <DataTable
                tableId="driving:regen-drives"
                columns={columns}
                data={regenDrives}
                keyExtractor={(r) => r.id}
                emptyMessage={t('regen.noRecentDrives', 'No regen drives in this period yet')}
                pagination
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
