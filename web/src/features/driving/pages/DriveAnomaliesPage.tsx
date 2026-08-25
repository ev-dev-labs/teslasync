import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Microscope, AlertTriangle, Sigma, Sparkles } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  ComposedChart, Line, Scatter, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { summarizeAnomalies, type AnomalyReason } from '../lib/driveAnomalies';

/** km per statute mile, derived from the shared conversion lib. */
const KM_PER_MILE = convertDistanceToSI(1, 'mi') / 1000;

const REASON_I18N: Record<AnomalyReason, { key: string; fallback: string }> = {
  cold: { key: 'anomalies.reasonCold', fallback: 'much colder than usual' },
  hot: { key: 'anomalies.reasonHot', fallback: 'much hotter than usual' },
  lowRegen: { key: 'anomalies.reasonLowRegen', fallback: 'unusually little regen' },
  crawl: { key: 'anomalies.reasonCrawl', fallback: 'stop-and-go crawling' },
  unknown: { key: 'anomalies.reasonUnknown', fallback: 'no obvious cause in the data' },
  efficient: { key: 'anomalies.reasonEfficient', fallback: 'exceptionally efficient run' },
};

export default function DriveAnomaliesPage() {
  const { t } = useTranslation();
  usePageTitle(t('anomalies.title', 'Anomaly Detective'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { unitPrefs } = useUnits();

  const { start, end, setRange } = useRangeState({
    persistKey: 'drive-anomalies.range',
    defaultPresetId: 'all',
  });

  const drivesQuery = useDrives(vehicleIdStr);
  const allDrives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const drives = useMemo<Drive[]>(() => {
    if (!allDrives.length) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  const summary = useMemo(() => summarizeAnomalies(drives), [drives]);

  const isMiles = unitPrefs.distance === 'mi';
  const speedUnit = isMiles ? t('anomalies.mph', 'mph') : t('anomalies.kmh', 'km/h');
  const effUnit = isMiles ? t('anomalies.whPerMi', 'Wh/mi') : t('anomalies.whPerKm', 'Wh/km');
  const toSpeed = (kph: number) => Math.round(isMiles ? kph / KM_PER_MILE : kph);
  const toEff = (whPerKm: number) => Math.round(isMiles ? whPerKm * KM_PER_MILE : whPerKm);

  // One merged x-sorted dataset: curve rows carry band values, point rows
  // carry scatter values. Recharts renders each series from its own keys.
  const chartData = useMemo(() => {
    const rows: Record<string, number | null>[] = [];
    for (const c of summary.curve) {
      rows.push({
        speed: toSpeed(c.speedKph),
        predicted: toEff(c.predicted),
        upper2: toEff(c.upper2),
        lower2: toEff(c.lower2),
        normal: null,
        outlier: null,
      });
    }
    for (const p of summary.points) {
      rows.push({
        speed: toSpeed(p.speedKph),
        predicted: null,
        upper2: null,
        lower2: null,
        normal: Math.abs(p.z) < 2 ? toEff(p.whPerKm) : null,
        outlier: Math.abs(p.z) >= 2 ? toEff(p.whPerKm) : null,
      });
    }
    return rows.sort((a, b) => (a.speed ?? 0) - (b.speed ?? 0));
     
  }, [summary.curve, summary.points, isMiles]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('anomalies.title', 'Anomaly Detective')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('anomalies.title', 'Anomaly Detective')}
      subtitle={t('anomalies.subtitle', 'Drives that break your own consumption law, explained')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="drive-anomalies-range"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('anomalies.kpis', 'Anomaly summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('anomalies.analyzed', 'Drives Analyzed')}
                value={summary.analyzed}
                icon={<Microscope className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('anomalies.outlierCount', 'Outliers')}
                value={summary.outliers.length}
                subtitle={t('anomalies.beyond2', 'beyond ±2σ of your baseline')}
                icon={<AlertTriangle className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('anomalies.sigma', 'Your Spread (σ)')}
                value={summary.sigma != null ? `${toEff(summary.sigma)} ${effUnit}` : '—'}
                subtitle={t('anomalies.sigmaHint', 'residual scatter around the fit')}
                icon={<Sigma className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('anomalies.bestSurprise', 'Best Surprise')}
                value={
                  summary.outliers.find((o) => o.z <= -2) != null
                    ? `${summary.outliers.find((o) => o.z <= -2)!.z}σ`
                    : '—'
                }
                subtitle={t('anomalies.bestSurpriseHint', 'most efficient outlier')}
                icon={<Sparkles className="h-5 w-5" />}
                color="green"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Scatter + band */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && summary.coefficients == null ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: the personal baseline needs 8+ drives with speed and energy; the range picker above is the recovery surface. */
              icon={<Microscope className="h-8 w-8" />}
              message={t('anomalies.noFit', 'Not enough drives (8+ with speed and energy data) to fit your personal baseline yet.')}
            />
          </GlassPanel>
        ) : (
          // chart-legend-audit:skip fitted baseline and two-sigma bounds form one analytical envelope and must remain visible together
          <ChartContainer
            title={t('anomalies.chart', 'Your Consumption Law')}
            subtitle={t('anomalies.chartHint', 'Quadratic fit of consumption vs speed with a ±2σ band; red points break the law')}
            ariaLabel={t('anomalies.chart.aria', 'Scatter of drive consumption against speed with fitted curve and two-sigma band; outliers highlighted')}
            loading={isLoading}
            empty={chartData.length === 0}
            height={380}
            data={summary.points.map((p) => ({
              speed: toSpeed(p.speedKph),
              consumption: toEff(p.whPerKm),
              predicted: toEff(p.predicted),
              z: p.z,
            }))}
            dataColumns={[
              { key: 'speed', label: `${t('anomalies.col.speed', 'Speed')} (${speedUnit})` },
              { key: 'consumption', label: `${t('anomalies.col.consumption', 'Consumption')} (${effUnit})` },
              { key: 'predicted', label: t('anomalies.col.predicted', 'Baseline') },
              { key: 'z', label: t('anomalies.col.z', 'z-score') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="speed"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  unit={` ${speedUnit}`}
                />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="upper2"
                  name={t('anomalies.upperBand', '+2σ')}
                  stroke="none"
                  fill={chartTokens.series[5]}
                  fillOpacity={0.08}
                  connectNulls
                />
                <Area
                  type="monotone"
                  dataKey="lower2"
                  name={t('anomalies.lowerBand', '−2σ')}
                  stroke="none"
                  fill="var(--surface-2)"
                  fillOpacity={1}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  name={t('anomalies.baseline', 'Baseline')}
                  stroke={chartTokens.series[5]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                <Scatter
                  dataKey="normal"
                  name={t('anomalies.normal', 'Within band')}
                  fill={chartTokens.series[1]}
                  fillOpacity={0.7}
                />
                <Scatter
                  dataKey="outlier"
                  name={t('anomalies.outlier', 'Outlier')}
                  fill={chartTokens.series[3]}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Case files */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('anomalies.cases', 'Case Files')}
            <HelpTooltip
              size="sm"
              i18nKey="help.driveAnomalies.body"
              defaultValue="Each drive is scored by how many standard deviations its consumption sits from your own speed-adjusted baseline. Outliers beyond ±2σ get candidate explanations by comparing their temperature and regen against your cohort medians."
              ariaLabel={t('help.driveAnomalies.iconLabel', 'More info about anomaly scoring')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={140} />
          ) : summary.outliers.length === 0 ? (
            <EmptyState /* no-action: absence of outliers is the good outcome; the panel fills in as anomalous drives appear. */
              icon={<Sparkles className="h-8 w-8" />}
              message={t('anomalies.noOutliers', 'No drives beyond ±2σ — everything fits your usual pattern.')}
            />
          ) : (
            <ul className="space-y-2">
              {summary.outliers.map((o) => (
                <li
                  key={o.driveId}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <Badge variant={o.z > 0 ? 'warning' : 'success'}>
                    {o.z > 0 ? '+' : ''}{o.z}σ
                  </Badge>
                  <Text variant="bodySm">
                    {formatDateShort(o.startTs)} · {toSpeed(o.speedKph)} {speedUnit} · {toEff(o.whPerKm)} {effUnit}
                    {' '}({t('anomalies.expected', 'expected {{v}}', { v: toEff(o.predicted) })})
                  </Text>
                  <span className="flex flex-wrap gap-1.5">
                    {o.reasons.map((r) => (
                      <Badge key={r} variant="neutral">
                        {t(REASON_I18N[r].key, REASON_I18N[r].fallback)}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
