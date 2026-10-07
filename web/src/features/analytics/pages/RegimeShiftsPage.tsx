import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, Layers } from 'lucide-react';

import { PageLayout, LayoutCard, ChartCard, SourceContent } from '@/components/layout';
import { Text, Badge, HelpTooltip } from '@/components/ui';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { Skeleton, EmptyState, StaleRefreshWarning } from '@/components/feedback';
import { deriveDataState } from '@/api/dataState';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartLegend, ChartTooltip,
  ComposedChart, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';

import { summarizeRegimes } from '../lib/regimeShifts';

/** km per statute mile, derived from the shared conversion lib. */
const KM_PER_MILE = convertDistanceToSI(1, 'mi') / 1000;

export default function RegimeShiftsPage() {
  const { t } = useTranslation();
  usePageTitle(t('regimes.title', 'Regime shifts'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatTemperature, unitPrefs } = useUnits();

  const drivesQuery = useDrives(vehicleIdStr);

  const summary = useMemo(() => summarizeRegimes(drivesQuery.data ?? []), [drivesQuery.data]);

  const isMiles = unitPrefs.distance === 'mi';
  const effUnit = isMiles ? t('regimes.whPerMi', 'Wh/mi') : t('regimes.whPerKm', 'Wh/km');
  const toEff = (whPerKm: number) => Math.round(isMiles ? whPerKm * KM_PER_MILE : whPerKm);

  // Chart: weekly line + per-week segment mean as a step overlay.
  const chartData = useMemo(() => {
    const segmentByWeek = new Map<string, number>();
    for (const seg of summary.segments) {
      for (const w of summary.series) {
        if (w.weekStart >= seg.startWeek && w.weekStart <= seg.endWeek) {
          segmentByWeek.set(w.weekStart, seg.meanWhPerKm);
        }
      }
    }
    return summary.series.map((w) => ({
      week: w.weekStart.substring(2),
      consumption: toEff(w.whPerKm),
      regime: segmentByWeek.has(w.weekStart) ? toEff(segmentByWeek.get(w.weekStart)!) : null,
    }));
     
  }, [summary.series, summary.segments, isMiles]);

  const latest = summary.segments[summary.segments.length - 1] ?? null;
  const lastShift = summary.shifts[summary.shifts.length - 1] ?? null;

  const source = deriveDataState(drivesQuery, { provenance: 'historical' });
  const isLoading = source.status === 'initial';
  const isError = source.fatalError != null;
  const retry = () => { void drivesQuery.refetch(); };
  const metrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'regimes-count',
      label: t('regimes.regimeCount', 'Regimes detected'),
      rawValue: source.hasData ? summary.segments.length : null,
      context: source.hasData ? t('regimes.overWeeks', 'over {{count}} weeks', { count: summary.analyzedWeeks }) : undefined,
    },
    {
      metricId: 'efficiency', occurrenceId: 'regimes-current',
      label: t('regimes.currentRegime', 'Current regime'),
      rawValue: source.hasData && latest ? latest.meanWhPerKm / 1000 : null,
      display: { formatter: raw => ({ value: String(toEff(raw * 1000)), unit: effUnit }) },
      context: latest ? t('regimes.since', 'since {{date}}', { date: formatDateShort(latest.startWeek) }) : undefined,
    },
    {
      metricId: 'percent', occurrenceId: 'regimes-last-shift',
      label: t('regimes.lastShift', 'Last shift'),
      rawValue: source.hasData && lastShift ? lastShift.deltaShare * 100 : null,
      display: { formatter: raw => ({ value: `${raw > 0 ? '+' : ''}${Math.round(raw)}`, unit: '%' }) },
      context: source.hasData ? lastShift ? formatDateShort(lastShift.weekStart) : t('regimes.noShifts', 'none detected') : undefined,
    },
    {
      metricId: 'temperature', occurrenceId: 'regimes-temperature',
      label: t('regimes.tempLink', 'Temp link'),
      rawValue: source.hasData ? lastShift?.tempDeltaC : null,
      display: { formatter: raw => ({ value: `${raw > 0 ? '+' : ''}${formatTemperature(Math.abs(raw))}`, unit: '' }) },
      context: t('regimes.tempLinkHint', 'avg temp change at last shift'),
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const sourceLabels = {
    initial: t('regimes.brief.status.initial', 'Loading drive history'),
    ok: t('regimes.brief.status.ok', 'Returned drive history'),
    stale: t('regimes.brief.status.stale', 'Retained drive history'),
    partial: t('regimes.brief.status.partial', 'Partial drive history'),
    unavailable: t('regimes.brief.status.unavailable', 'Drive history unavailable'),
    initialFailure: t('regimes.brief.status.initialFailure', 'Drive history failed'),
  };
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('regimes.title', 'Regime shifts')} />;
  }

  return (
    <PageLayout
      title={t('regimes.title', 'Regime shifts')}
      subtitle={t('regimes.subtitle', 'Statistical changepoints in your weekly consumption')}
      query={drivesQuery}
      dataSources={[{ id: 'regime-drives', label: t('dataSources.labels.driveHistory', 'Drive history'), query: drivesQuery }]}
    >
      <StaleRefreshWarning state={source} />
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('regimes.kpis', 'Regime summary metrics')}
        >
          <OperationalBrief
            compact
            testId="regime-summary"
            eyebrow={t('regimes.brief.eyebrow', 'Consumption evidence')}
            title={t('regimes.kpis', 'Regime summary metrics')}
            description={t('regimes.subtitle', 'Statistical changepoints in your weekly consumption')}
            statusLabel={sourceLabels[source.status]}
            statusTone={source.refreshError || isError ? 'warning' : 'neutral'}
            metrics={operationalMetrics}
            scope={t('regimes.sourceWindow', 'Returned drive-history window')}
            freshness={t('regimes.coverageUnknown', 'Continuous observation coverage is unknown.')}
            provenance={t('dataSources.labels.driveHistory', 'Drive history')}
            loading={isLoading}
          />
          {isError && <SourceContent state="error" label={t('regimes.kpis', 'Regime summary metrics')} emptyMessage="" errorMessage={t('error.loadFailed', 'Failed to load data')} error={source.fatalError} errorRecovery={{ onRetry: retry }}>{null}</SourceContent>}
        </section>
      </FadeIn>

      {/* 2 — Series with regime steps */}
      <FadeIn delay={0.1}>
          <ChartCard
            title={t('regimes.chart', 'Weekly consumption & detected regimes')}
            subtitle={t('regimes.chartHint', 'The stepped line is each regime’s mean; vertical lines mark detected shifts')}
            ariaLabel={t('regimes.chart.aria', 'Weekly consumption line with stepped regime means and changepoint markers')}
            chartKey="regime-shifts-weekly-consumption"
            loading={isLoading}
            error={source.fatalError}
            onRetry={retry}
            empty={chartData.length === 0}
            emptyIcon={<GitBranch className="h-8 w-8" />}
            emptyMessage={t('regimes.noData', 'Not enough weekly history yet — six or more driving weeks are needed.')}
            height={360}
            size="standard"
            exportable
            data={chartData}
            dataColumns={[
              { key: 'week', label: t('regimes.col.week', 'Week') },
              { key: 'consumption', label: `${t('regimes.col.consumption', 'Consumption')} (${effUnit})` },
              { key: 'regime', label: t('regimes.col.regime', 'Regime mean') },
            ]}
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="week" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend />
                {summary.shifts.map((s) => (
                  <ReferenceLine
                    key={s.weekStart}
                    x={s.weekStart.substring(2)}
                    stroke={chartTokens.series[3]}
                    strokeDasharray="6 4"
                    strokeOpacity={0.7}
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey="consumption"
                  name={t('regimes.weekly', 'Weekly')}
                  stroke={chartTokens.series[5]}
                  strokeWidth={1.5}
                  strokeOpacity={0.7}
                  dot={{ r: 2 }}
                  hide={hiddenSeries?.isHidden('consumption')}
                />
                <Line
                  type="stepAfter"
                  dataKey="regime"
                  name={t('regimes.regimeMean', 'Regime mean')}
                  stroke={chartTokens.series[2]}
                  strokeWidth={2.5}
                  dot={false}
                  hide={hiddenSeries?.isHidden('regime')}
                />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
      </FadeIn>

      {/* 3 — Shift log */}
      <FadeIn delay={0.2}>
        <LayoutCard title={t('regimes.shiftLog', 'Shift log')} actions={
            <HelpTooltip
              size="sm"
              i18nKey="help.regimeShifts.body"
              defaultValue="Changepoints come from binary segmentation: the weekly series is recursively split where the split most reduces squared error, and a split only counts when that reduction beats a noise-scaled penalty. The temperature delta between adjacent regimes is shown as a candidate cause."
              ariaLabel={t('help.regimeShifts.iconLabel', 'More info about changepoint detection')}
            />
        }>
          <SourceContent
            state={isError ? 'error' : isLoading ? 'loading' : summary.shifts.length === 0 ? 'empty' : 'ready'}
            label={t('regimes.shiftLog', 'Shift log')}
            error={source.fatalError}
            errorMessage={t('error.loadFailed', 'Failed to load data')}
            emptyMessage={t('regimes.stable', 'No statistically significant shifts — your consumption regime has been stable.')}
            errorRecovery={{ onRetry: retry }}
            loadingContent={<Skeleton height={120} />}
            emptyContent={
            <EmptyState /* no-action: no shifts is the stable outcome; entries appear when a statistically significant change lands. */
              icon={<Layers className="h-8 w-8" />}
              message={t('regimes.stable', 'No statistically significant shifts — your consumption regime has been stable.')}
            />
            }
          >
            <ul className="space-y-2">
              {[...summary.shifts].reverse().map((s) => (
                <li
                  key={s.weekStart}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <Badge variant={s.deltaShare > 0 ? 'warning' : 'success'}>
                    {s.deltaShare > 0 ? '+' : ''}{Math.round(s.deltaShare * 100)}%
                  </Badge>
                  <Text variant="bodySm">
                    {t('regimes.shiftLine', 'Week of {{date}}: consumption moved {{delta}} {{unit}}', {
                      date: formatDateShort(s.weekStart),
                      delta: `${s.deltaWhPerKm > 0 ? '+' : ''}${toEff(s.deltaWhPerKm)}`,
                      unit: effUnit,
                    })}
                  </Text>
                  {s.tempDeltaC != null && (
                    <Badge variant="neutral">
                      {t('regimes.tempBadge', 'avg temp {{delta}}°C', {
                        delta: `${s.tempDeltaC > 0 ? '+' : ''}${s.tempDeltaC}`,
                      })}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </SourceContent>
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
