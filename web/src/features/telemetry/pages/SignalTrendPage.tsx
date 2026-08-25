import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Activity, Ruler, Waypoints } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, Select, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip, ChartLegend,
  ComposedChart, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useSignals, useSignalAnalysisHistory } from '@/api/hooks/useTelemetry';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { fmtNumber } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

import { summarizeSignalTrend, toNumericPoints } from '../lib/signalTrend';

const HOURS = 168;

export default function SignalTrendPage() {
  const { t } = useTranslation();
  usePageTitle(t('signalTrend.title', 'Signal Trend'));

  const { vehicleId } = useSelectedVehicle();
  const id = vehicleId ?? 0;
  const [signalName, setSignalName] = useState('');
  const hidden = useHiddenSeries('signal-trend-forecast');

  const signalsQuery = useSignals(id);
  const historyQuery = useSignalAnalysisHistory(id, signalName, HOURS);
  const chosen = signalName !== '';
  const dataSources = useMemo(
    () => [
      {
        id: 'signal-catalog',
        label: t('dataSources.labels.signalCatalog', 'Signal catalog'),
        query: signalsQuery,
      },
      {
        id: 'signal-history',
        label: t('dataSources.labels.selectedSignalHistory', 'Selected signal history'),
        query: historyQuery,
        enabled: chosen,
      },
    ],
    [chosen, historyQuery, signalsQuery, t],
  );

  const options = useMemo(
    () => (signalsQuery.data ?? []).map((name) => ({ value: name, label: name })),
    [signalsQuery.data],
  );

  const summary = useMemo(
    () => summarizeSignalTrend(historyQuery.data?.data ?? []),
    [historyQuery.data],
  );

  const combined = useMemo(() => {
    const points = toNumericPoints(historyQuery.data?.data ?? []);
    if (points.length === 0) return [];
    const baseMs = points[0]!.ms;
    const slope = summary.slopePerHour ?? 0;
    const intercept = summary.interceptAtStart ?? 0;
    const fmtTime = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });

    const historical = points.map((p) => ({
      ms: p.ms,
      time: fmtTime(p.ms),
      actual: Math.round(p.value * 1000) / 1000,
      baseline: Math.round((intercept + slope * ((p.ms - baseMs) / 3_600_000)) * 1000) / 1000,
      bandBase: null as number | null,
      bandRange: null as number | null,
    }));
    const forecast = summary.forecast.map((f) => ({
      ms: f.ms,
      time: fmtTime(f.ms),
      actual: null as number | null,
      baseline: f.baseline,
      bandBase: f.low,
      bandRange: Math.round((f.high - f.low) * 1000) / 1000,
    }));
    return [...historical, ...forecast].sort((a, b) => a.ms - b.ms);
  }, [historyQuery.data, summary.slopePerHour, summary.interceptAtStart, summary.forecast]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('signalTrend.title', 'Signal Trend')} />;
  }

  const historyHasData = historyQuery.data !== undefined;
  const isLoading = chosen && !historyHasData && historyQuery.isLoading;
  const isError = chosen && historyQuery.isError && !historyHasData;
  const error = historyQuery.error;
  const hasData = chosen && summary.samples > 0;
  const mk = summary.mannKendall;

  return (
    <PageContainer
      title={t('signalTrend.title', 'Signal Trend')}
      subtitle={t(
        'signalTrend.subtitle',
        'Robust slope and significance for slow, monotonic drift in a numeric signal — distinct from abrupt change points, anomaly scoring, or cross-signal correlation',
      )}
      query={[signalsQuery, historyQuery]}
      dataSources={dataSources}
      actions={<VehicleSelect />}
    >
      {/* 1 — Signal picker */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalTrend.pick', 'Choose a Signal')}
            <HelpTooltip
              size="sm"
              i18nKey="help.signalTrend.pick"
              defaultValue="Theil-Sen (a robust slope) is paired with tie-aware Mann-Kendall (a significance test) so a magnitude is never reported without evidence it beats chance, and vice versa."
              ariaLabel={t('help.signalTrend.iconLabel', 'More info about signal selection')}
            />
          </PanelTitle>
          {signalsQuery.isError ? (
            <QueryError error={signalsQuery.error} onRetry={() => signalsQuery.refetch()} />
          ) : signalsQuery.isLoading ? (
            <Skeleton height={80} />
          ) : options.length === 0 ? (
            <EmptyState /* no-action: signals appear as the telemetry stream reports them. */
              icon={<Waypoints className="h-8 w-8" />}
              message={t('signalTrend.noSignals', 'No telemetry signals have been recorded for this vehicle yet.')}
            />
          ) : (
            <Select
              label={t('signalTrend.signal', 'Signal')}
              options={options}
              value={signalName}
              onChange={(e) => setSignalName(e.target.value)}
              placeholder={t('signalTrend.choose', 'Choose a signal')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* 2 — KPI band */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('signalTrend.kpis', 'Trend metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={error} onRetry={() => historyQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={96} className="rounded-xl" />)
          ) : (
            <>
              <MetricCard
                label={t('signalTrend.slope', 'Drift Rate')}
                value={hasData ? `${fmtNumber(summary.slopePerDay ?? 0, 4)}/day` : '—'}
                subtitle={t('signalTrend.slopePerHour', '{{v}}/hour', { v: hasData ? fmtNumber(summary.slopePerHour ?? 0, 5) : '—' })}
                icon={<TrendingUp className="h-5 w-5" />}
                color="cyan"
                help={{
                  i18nKey: 'help.signalTrend.slope',
                  defaultValue: 'Theil-Sen slope: the median of every pairwise slope between samples. A handful of outliers cannot swing this the way they can an ordinary least-squares fit.',
                }}
              />
              <MetricCard
                label={t('signalTrend.significance', 'Significance')}
                value={!hasData ? '—' : mk?.significant ? t('signalTrend.real', 'Real') : t('signalTrend.noise', 'Not significant')}
                subtitle={t('signalTrend.tau', 'tau {{tau}} · p {{p}}', { tau: hasData ? fmtNumber(mk?.tau ?? 0, 3) : '—', p: hasData ? fmtNumber(mk?.pValue ?? 1, 4) : '—' })}
                icon={<Activity className="h-5 w-5" />}
                color={hasData && mk?.significant ? 'green' : 'amber'}
                help={{
                  i18nKey: 'help.signalTrend.significance',
                  defaultValue: 'Tie-aware Mann-Kendall tests whether the observed ordering of values is more consistent with a monotonic trend than chance — ties (repeated readings) are corrected for rather than treated as informationless.',
                }}
              />
              <MetricCard
                label={t('signalTrend.spread', 'Residual Spread')}
                value={hasData ? fmtNumber(summary.residualSpread ?? 0, 3) : '—'}
                subtitle={t('signalTrend.spreadHint', 'robust MAD around the fitted line')}
                icon={<Ruler className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('signalTrend.samples', 'Samples')}
                value={summary.samples}
                subtitle={t('signalTrend.span', '{{h}}h span · {{ev}}', { h: fmtNumber(summary.spanHours ?? 0, 1), ev: summary.evidenceLimited ? t('signalTrend.limited', 'evidence-limited') : t('signalTrend.sufficient', 'sufficient evidence') })}
                icon={<Waypoints className="h-5 w-5" />}
                color={summary.evidenceLimited ? 'amber' : 'blue'}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 3 — Baseline, actual, and evidence-limited forecast band */}
      <FadeIn delay={0.2}>
        {!isLoading && !isError && combined.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: the trend chart appears once a signal with history is chosen. */
              icon={<TrendingUp className="h-8 w-8" />}
              message={chosen ? t('signalTrend.notEnough', 'Not enough history yet for this signal.') : t('signalTrend.pickOne', 'Choose a signal above to compute its trend.')}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('signalTrend.chart', 'Robust Baseline & Forecast Band')}
            subtitle={t('signalTrend.chartHint', 'The forecast is never projected further ahead than the signal has actually been observed, and only appears when the trend is significant')}
            ariaLabel={t('signalTrend.chartAria', 'Composed chart of actual signal values, the fitted robust baseline, and an evidence-limited forecast band')}
            chartKey="signal-trend-forecast"
            loading={isLoading}
            empty={combined.length === 0}
            height={340}
            data={combined}
            dataColumns={[
              { key: 'time', label: t('signalTrend.col.time', 'Time') },
              { key: 'actual', label: t('signalTrend.col.actual', 'Actual') },
              { key: 'baseline', label: t('signalTrend.col.baseline', 'Baseline') },
              { key: 'bandBase', label: t('signalTrend.col.low', 'Forecast low') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={combined}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={hidden} />
                <Area type="monotone" dataKey="bandBase" stackId="band" stroke="none" fill="transparent" name={t('signalTrend.col.low', 'Forecast low')} hide={hidden.isHidden('forecast')} legendType="none" />
                <Area type="monotone" dataKey="bandRange" stackId="band" stroke="none" fill={chartTokens.series[2]} fillOpacity={0.18} name={t('signalTrend.forecastBand', 'Forecast band')} hide={hidden.isHidden('forecast')} />
                <Line type="monotone" dataKey="baseline" name={t('signalTrend.col.baseline', 'Baseline')} stroke={chartTokens.series[1]} strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls hide={hidden.isHidden('baseline')} />
                <Line type="monotone" dataKey="actual" name={t('signalTrend.col.actual', 'Actual')} stroke={chartTokens.series[0]} strokeWidth={2} dot={false} connectNulls={false} hide={hidden.isHidden('actual')} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 4 — Reading the result */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalTrend.reading', 'Reading the Result')}
          </PanelTitle>
          {!hasData ? (
            <EmptyState /* no-action: the interpretation follows from the trend fit above. */
              icon={<TrendingUp className="h-8 w-8" />}
              message={t('signalTrend.noReading', 'Pick a signal to see how its trend should be read.')}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant={mk?.significant ? 'success' : 'warning'}>
                    {mk?.significant ? t('signalTrend.real', 'Real') : t('signalTrend.noise', 'Not significant')}
                  </Badge>
                </div>
                <Text variant="body">
                  {mk?.significant
                    ? t('signalTrend.realText', 'The ordering of values is unlikely to be chance, so the fitted slope reflects a genuine slow drift rather than noise.')
                    : t('signalTrend.noiseText', 'The observed ordering does not clear the significance bar, so any apparent slope here is best treated as noise rather than a real trend.')}
                </Text>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant="info">{summary.evidenceLimited ? t('signalTrend.limited', 'Evidence-limited') : t('signalTrend.sufficient', 'Sufficient evidence')}</Badge>
                </div>
                <Text variant="body">
                  {summary.evidenceLimited
                    ? t('signalTrend.limitedText', 'Too few samples or too short a time span to trust significance or a forecast — the slope alone is shown, withheld from projection.')
                    : t('signalTrend.sufficientText', 'The forecast band is capped at the observed time span itself, never projected further into the future than the signal has actually been watched.')}
                </Text>
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
