import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, Layers, Thermometer, TrendingUp } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
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
  usePageTitle(t('regimes.title', 'Regime Shifts'));

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toEff derives from isMiles
  }, [summary.series, summary.segments, isMiles]);

  const latest = summary.segments[summary.segments.length - 1] ?? null;
  const lastShift = summary.shifts[summary.shifts.length - 1] ?? null;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('regimes.title', 'Regime Shifts')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('regimes.title', 'Regime Shifts')}
      subtitle={t('regimes.subtitle', 'Statistical changepoints in your weekly consumption')}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('regimes.kpis', 'Regime summary metrics')}
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
                label={t('regimes.regimeCount', 'Regimes Detected')}
                value={summary.segments.length || '—'}
                subtitle={t('regimes.overWeeks', 'over {{count}} weeks', { count: summary.analyzedWeeks })}
                icon={<Layers className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('regimes.currentRegime', 'Current Regime')}
                value={latest ? `${toEff(latest.meanWhPerKm)} ${effUnit}` : '—'}
                subtitle={
                  latest
                    ? t('regimes.since', 'since {{date}}', { date: formatDateShort(latest.startWeek) })
                    : undefined
                }
                icon={<TrendingUp className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('regimes.lastShift', 'Last Shift')}
                value={
                  lastShift
                    ? `${lastShift.deltaShare > 0 ? '+' : ''}${Math.round(lastShift.deltaShare * 100)}%`
                    : '—'
                }
                subtitle={lastShift ? formatDateShort(lastShift.weekStart) : t('regimes.noShifts', 'none detected')}
                icon={<GitBranch className="h-5 w-5" />}
                color={lastShift == null ? 'green' : lastShift.deltaShare > 0 ? 'amber' : 'green'}
              />
              <MetricCard
                label={t('regimes.tempLink', 'Temp Link')}
                value={
                  lastShift?.tempDeltaC != null
                    ? `${lastShift.tempDeltaC > 0 ? '+' : ''}${formatTemperature(Math.abs(lastShift.tempDeltaC), { precision: 0 })}`
                    : '—'
                }
                subtitle={t('regimes.tempLinkHint', 'avg temp change at last shift')}
                icon={<Thermometer className="h-5 w-5" />}
                color="blue"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Series with regime steps */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && summary.segments.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: the detector needs 6+ weeks of driving; it appears automatically as history accrues. */
              icon={<GitBranch className="h-8 w-8" />}
              message={t('regimes.noData', 'Not enough weekly history yet — six or more driving weeks are needed.')}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('regimes.chart', 'Weekly Consumption & Detected Regimes')}
            subtitle={t('regimes.chartHint', 'The stepped line is each regime’s mean; vertical lines mark detected shifts')}
            ariaLabel={t('regimes.chart.aria', 'Weekly consumption line with stepped regime means and changepoint markers')}
            loading={isLoading}
            empty={chartData.length === 0}
            height={360}
            data={chartData}
            dataColumns={[
              { key: 'week', label: t('regimes.col.week', 'Week') },
              { key: 'consumption', label: `${t('regimes.col.consumption', 'Consumption')} (${effUnit})` },
              { key: 'regime', label: t('regimes.col.regime', 'Regime mean') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="week" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip />} />
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
                />
                <Line
                  type="stepAfter"
                  dataKey="regime"
                  name={t('regimes.regimeMean', 'Regime mean')}
                  stroke={chartTokens.series[2]}
                  strokeWidth={2.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Shift log */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('regimes.shiftLog', 'Shift Log')}
            <HelpTooltip
              size="sm"
              i18nKey="help.regimeShifts.body"
              defaultValue="Changepoints come from binary segmentation: the weekly series is recursively split where the split most reduces squared error, and a split only counts when that reduction beats a noise-scaled penalty. The temperature delta between adjacent regimes is shown as a candidate cause."
              ariaLabel={t('help.regimeShifts.iconLabel', 'More info about changepoint detection')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={120} />
          ) : summary.shifts.length === 0 ? (
            <EmptyState /* no-action: no shifts is the stable outcome; entries appear when a statistically significant change lands. */
              icon={<Layers className="h-8 w-8" />}
              message={t('regimes.stable', 'No statistically significant shifts — your consumption regime has been stable.')}
            />
          ) : (
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
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
