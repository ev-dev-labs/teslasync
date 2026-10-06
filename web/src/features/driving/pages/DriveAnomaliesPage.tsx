import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Microscope, AlertTriangle, Sparkles } from 'lucide-react';

import { PageLayout, ChartCard, LayoutCard } from '@/components/layout';
import { Text, Badge, HelpTooltip } from '@/components/ui';
import { RangePicker } from '@/components/forms';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartTooltip,
  ComposedChart, Line, Scatter, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { formatDateShort } from '@/lib/dateFormat';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { summarizeAnomalies, type AnomalyReason } from '../lib/driveAnomalies';
import { DrivingSummaryBrief } from '../components/operationalbrief-a-m/DrivingSummaryBrief';

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
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
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

  const curveData = useMemo(() => summary.curve.map((c) => ({
    speed: toSpeed(c.speedKph),
    predicted: toEff(c.predicted),
    upper2: toEff(c.upper2),
    lower2: toEff(c.lower2),
  })), [summary.curve, isMiles]);
  const pointData = useMemo(() => summary.points.map((p) => ({
    speed: toSpeed(p.speedKph),
    normal: Math.abs(p.z) < 2 ? toEff(p.whPerKm) : null,
    outlier: Math.abs(p.z) >= 2 ? toEff(p.whPerKm) : null,
  })), [summary.points, isMiles]);
  const normalData = useMemo(
    () => pointData.filter((point) => point.normal != null),
    [pointData],
  );
  const outlierData = useMemo(
    () => pointData.filter((point) => point.outlier != null),
    [pointData],
  );
  const chartData = useMemo(
    () => [...curveData, ...pointData].sort((a, b) => a.speed - b.speed),
    [curveData, pointData],
  );
  const available = drivesState.data != null;
  const briefMetrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'analyzed', rawValue: available ? summary.analyzed : null,
      label: t('anomalies.analyzed', 'Drives Analyzed'),
      description: t('anomalies.brief.analyzed', 'Returned drives with usable speed and energy data in this window.') },
    { metricId: 'count', occurrenceId: 'outliers', rawValue: available ? summary.outliers.length : null,
      label: t('anomalies.outlierCount', 'Outliers'),
      description: t('anomalies.beyond2', 'beyond ±2σ of your baseline') },
    { metricId: 'efficiency', occurrenceId: 'sigma',
      rawValue: available && summary.sigma != null ? summary.sigma / 1000 : null,
      label: t('anomalies.sigma', 'Your Spread (σ)'),
      description: t('anomalies.sigmaHint', 'residual scatter around the fit'),
      display: { formatter: (raw) => ({ value: String(toEff(raw * 1000)), unit: effUnit }) } },
    { metricId: 'number', occurrenceId: 'best-surprise',
      rawValue: available ? summary.outliers.find((outlier) => outlier.z <= -2)?.z : null,
      label: t('anomalies.bestSurprise', 'Best Surprise'),
      description: t('anomalies.bestSurpriseHint', 'most efficient outlier'),
      display: { formatter: (raw) => ({ value: String(raw), unit: 'σ' }) } },
  ];

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('anomalies.title', 'Anomaly Detective')} />;
  }

  const isLoading = drivesState.status === 'initial';
  const isError = drivesState.fatalError != null;

  return (
    <PageLayout
      title={t('anomalies.title', 'Anomaly Detective')}
      subtitle={t('anomalies.subtitle', 'Drives that break your own consumption law, explained')}
      query={drivesQuery}
      contextActions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="drive-anomalies-range"
          />
        </div>
      }
    >
      <StaleRefreshWarning state={drivesState} label={t('anomalies.title', 'Anomaly Detective')} />
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('anomalies.kpis', 'Anomaly summary metrics')}
        >
          <DrivingSummaryBrief metrics={briefMetrics}
            title={t('anomalies.kpis', 'Anomaly summary metrics')}
            description={t('anomalies.brief.description', 'Speed-adjusted consumption outliers against your returned drive cohort; candidate explanations are not verified causes.')}
            scope={t('driving.brief.window', '{{start}}–{{end}}; returned drive subset, not a server-wide aggregate', { start, end })}
            provenance={t('anomalies.brief.source', 'Returned drive history; quadratic fit and ±2σ residual band.')}
            loading={isLoading} error={drivesState.fatalError}
            retained={drivesState.status === 'stale' || drivesState.refreshError != null}
            onRetry={() => void drivesQuery.refetch()} />
        </section>
      </FadeIn>

      {/* 2 — Scatter + band */}
      <FadeIn delay={0.1}>
          {/* chart-legend-audit:skip fitted baseline and two-sigma bounds form one analytical envelope and must remain visible together */}
          <ChartCard
            title={t('anomalies.chart', 'Your Consumption Law')}
            subtitle={t('anomalies.chartHint', 'Quadratic fit of consumption vs speed with a ±2σ band; red points break the law')}
            ariaLabel={t('anomalies.chart.aria', 'Scatter of drive consumption against speed with fitted curve and two-sigma band; outliers highlighted')}
            loading={isLoading}
            error={drivesState.fatalError}
            onRetry={() => void drivesQuery.refetch()}
            empty={summary.coefficients == null || chartData.length === 0}
            emptyMessage={t('anomalies.noFit', 'Not enough drives (8+ with speed and energy data) to fit your personal baseline yet.')}
            emptyIcon={<Microscope className="h-8 w-8" />}
            height={380}
            mobileHeight={260}
            toolbar
            exportable
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
                  allowDuplicatedCategory={false}
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
                  connectNulls={false}
                  data={curveData}
                />
                <Area
                  type="monotone"
                  dataKey="lower2"
                  name={t('anomalies.lowerBand', '−2σ')}
                  stroke="none"
                  fill="var(--surface-2)"
                  fillOpacity={1}
                  connectNulls={false}
                  data={curveData}
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  name={t('anomalies.baseline', 'Baseline')}
                  stroke={chartTokens.series[5]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  data={curveData}
                />
                <Scatter
                  dataKey="normal"
                  data={normalData}
                  name={t('anomalies.normal', 'Within band')}
                  fill={chartTokens.series[1]}
                  fillOpacity={0.7}
                />
                <Scatter
                  dataKey="outlier"
                  data={outlierData}
                  name={t('anomalies.outlier', 'Outlier')}
                  fill={chartTokens.series[3]}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
      </FadeIn>

      {/* 3 — Case files */}
      <FadeIn delay={0.2}>
        <LayoutCard
          title={t('anomalies.cases', 'Case Files')}
          actions={<>
            <AlertTriangle className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <HelpTooltip
              size="sm"
              i18nKey="help.driveAnomalies.body"
              defaultValue="Each drive is scored by how many standard deviations its consumption sits from your own speed-adjusted baseline. Outliers beyond ±2σ get candidate explanations by comparing their temperature and regen against your cohort medians."
              ariaLabel={t('help.driveAnomalies.iconLabel', 'More info about anomaly scoring')}
            />
          </>}
        >
          {isError ? (
            <QueryError error={drivesState.fatalError} onRetry={() => void drivesQuery.refetch()} />
          ) : isLoading ? (
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
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
