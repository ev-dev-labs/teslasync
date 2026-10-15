import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, GitCompareArrows, Timer, Waypoints } from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { Card, GlassPanel, Icon, PanelTitle, Text, Badge, Select, Toggle, HelpTooltip } from '@/components/ui';

import { CorrelationStatStrip } from '../components/statstrip-correlation/CorrelationStatStrip';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip, ChartLegend,
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from '@/components/charts';

import { useSignals, useSignalHistory } from '@/api/hooks/useTelemetry';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';
import { chartTokens } from '@/lib/tokens';

import { analyzeCorrelation } from '../lib/signalCorrelation';

export default function SignalCorrelationPage() {
  const { t } = useTranslation();
  const { formatDateTime, formatTime, tz } = useDateFormat();
  const { fmtNumber } = useNumberFormatting();
  const formatMeasurement = useCallback(
    (value: unknown) => isFiniteNumber(value) ? fmtNumber(value) : '—',
    [fmtNumber],
  );
  const formatLag = useCallback(
    (value: unknown) => isFiniteNumber(value) ? `${fmtNumber(value)} s` : '—',
    [fmtNumber],
  );
  const detrendHintId = useId();
  usePageTitle(t('signalCorrelation.title', 'Signal correlation'));
  const axisTick = {
    fill: chartTokens.axisStroke,
    fontFamily: getChartFontFamily(),
    fontSize: getChartFontSize(),
  };

  const { vehicleId } = useSelectedVehicle();
  const id = vehicleId ?? 0;
  const { startInstant, endInstantExclusive } = useRangeState();
  const hours = (Date.parse(endInstantExclusive) - Date.parse(startInstant)) / 3_600_000;
  const historyWindow = { startInstant, endInstantExclusive };

  const [signalA, setSignalA] = useState('');
  const [signalB, setSignalB] = useState('');
  const [detrend, setDetrend] = useState(false);
  const overlayHidden = useHiddenSeries('signal-correlation-overlay');

  const signalsQuery = useSignals(id);
  const historyA = useSignalHistory(id, signalA, hours, historyWindow);
  const historyB = useSignalHistory(id, signalB, hours, historyWindow);
  const catalogState = useDataState(signalsQuery);
  const historyAState = useDataState(historyA, { provenance: 'historical' });
  const historyBState = useDataState(historyB, { provenance: 'historical' });
  const signalAChosen = signalA !== '';
  const signalBChosen = signalB !== '';
  const bothChosen = signalAChosen && signalBChosen;
  const dataSources = useMemo(
    () => [
      {
        id: 'signal-catalog',
        label: t('dataSources.labels.signalCatalog', 'Signal catalog'),
        query: signalsQuery,
      },
      {
        id: 'signal-a-history',
        label: t('dataSources.labels.signalAHistory', 'Signal A history'),
        query: historyA,
        enabled: signalAChosen,
      },
      {
        id: 'signal-b-history',
        label: t('dataSources.labels.signalBHistory', 'Signal B history'),
        query: historyB,
        enabled: signalBChosen,
      },
    ],
    [
      historyA,
      historyB,
      signalAChosen,
      signalBChosen,
      signalsQuery,
      t,
    ],
  );

  const options = useMemo(
    () => (signalsQuery.data ?? []).map((name) => ({ value: name, label: name })),
    [signalsQuery.data],
  );

  const evidence = useMemo(() => {
    if (!bothChosen || vehicleId == null || historyA.data === undefined || historyB.data === undefined) return null;
    return analyzeCorrelation(historyA.data.data ?? [], historyB.data.data ?? [], { detrend });
  }, [bothChosen, vehicleId, historyA.data, historyB.data, detrend]);
  const result = evidence?.result ?? null;

  const correlogram = useMemo(
    () =>
      (result?.correlogram ?? []).map((p) => ({
        lag: p.lagS,
        r: Math.round(p.r * 1000) / 1000,
        n: p.n,
      })),
    [result],
  );

  // Both series on one normalised 0–1 axis, because raw units differ wildly
  // (a state of charge and a cabin temperature share no scale).
  const overlay = useMemo(() => {
    if (result == null) return [];
    const { seriesA, seriesB } = result;
    const norm = (v: Array<number | null>) => {
      const finite = v.filter((x): x is number => x != null);
      if (finite.length === 0) return () => null;
      const lo = Math.min(...finite);
      const hi = Math.max(...finite);
      const span = hi - lo;
      return (x: number | null) => (x == null ? null : span === 0 ? 0.5 : (x - lo) / span);
    };
    const na = norm(seriesA.v);
    const nb = norm(seriesB.v);
    return seriesA.t.map((ms, i) => ({
      timestamp: ms,
      time: `${formatDateTime(new Date(ms))} (${tz})`,
      a: na(seriesA.v[i] ?? null),
      b: nb(seriesB.v[i] ?? null),
    }));
  }, [formatDateTime, result, tz]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('signalCorrelation.title', 'Signal correlation')} />;
  }

  const historyAHasData = historyA.data !== undefined;
  const historyBHasData = historyB.data !== undefined;
  const isLoading = bothChosen && (
    (!historyAHasData && (historyA.isLoading || historyA.fetchStatus === 'fetching'))
    || (!historyBHasData && (historyB.isLoading || historyB.fetchStatus === 'fetching'))
  );
  const isError = bothChosen && (
    historyAState.fatalError != null
    || historyBState.fatalError != null
  );
  const error =
    historyAState.fatalError ?? historyBState.fatalError;
  const retryBothFailed = () => {
    if (historyAState.fatalError) historyAState.retry?.();
    if (historyBState.fatalError) historyBState.retry?.();
  };
  const waitingForHistory = bothChosen && (!historyAHasData || !historyBHasData);
  const paused = (!historyAHasData && historyA.fetchStatus === 'paused')
    || (!historyBHasData && historyB.fetchStatus === 'paused');
  const comparisonMessage = !bothChosen
    ? t('signalCorrelation.pickTwo', 'Choose two signals above to compute the correlogram.')
    : waitingForHistory
      ? paused
        ? t('signalCorrelation.historyPaused', 'History loading is paused. No comparison evidence has loaded yet.')
        : t('signalCorrelation.historyPending', 'History availability has not resolved yet.')
      : evidence?.reason === 'empty'
        ? t('signalHistory.emptyMessage', 'No signal data matches the selected signals and time range.')
        : evidence?.reason === 'nonnumeric'
          ? t('signalCorrelation.nonnumericHistory', 'At least one selected history has no usable numeric or boolean measurements.')
          : evidence?.reason === 'disjoint'
            ? t('signalTransportAgreement.overlapTitle', 'Not enough overlapping evidence')
            : t('signalCorrelation.insufficientEvidence', 'There is not enough comparable evidence to compute a correlation.');

  const leadLabel =
    result == null
      ? '—'
      : result.lead === 'a'
        ? t('signalCorrelation.leadA', '{{a}} leads', { a: signalA })
        : result.lead === 'b'
          ? t('signalCorrelation.leadB', '{{b}} leads', { b: signalB })
          : result.lead === 'simultaneous'
            ? t('signalCorrelation.simultaneous', 'Simultaneous')
            : t('signalCorrelation.noLead', 'No relationship');

  return (
    <PageLayout
      title={t('signalCorrelation.title', 'Signal correlation')}
      subtitle={t(
        'signalCorrelation.subtitle',
        'Sweep one telemetry signal against another across time shifts to find not just whether they move together, but which one moves first',
      )}
      query={[signalsQuery, historyA, historyB]}
      dataSources={dataSources}
    >
      {/* 1 — Signal pickers */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Icon icon={GitCompareArrows} className="text-[var(--text-secondary)]" />
            {t('signalCorrelation.pick', 'Choose two signals')}
            <HelpTooltip
              size="sm"
              i18nKey="help.signalCorrelation.pick"
              defaultValue="The two signals are resampled onto a shared time grid using last-known-value hold, with a staleness limit so a gap in reporting becomes a genuine gap rather than a flat line that would fake a correlation."
              ariaLabel={t('help.signalCorrelation.iconLabel', 'More info about signal selection')}
            />
          </PanelTitle>
          {catalogState.fatalError ? (
            <QueryError error={catalogState.fatalError} onRetry={() => signalsQuery.refetch()} />
          ) : signalsQuery.isLoading ? (
            <Skeleton height={80} />
          ) : options.length === 0 ? (
            <EmptyState /* no-action: signals appear as the telemetry stream reports them. */
              icon={<Waypoints className="h-8 w-8" />}
              message={t(
                'signalCorrelation.noSignals',
                'No telemetry signals have been recorded for this vehicle yet.',
              )}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label={t('signalCorrelation.signalA', 'Signal A')}
                options={options}
                value={signalA}
                onChange={(e) => setSignalA(e.target.value)}
                placeholder={t('signalCorrelation.choose', 'Choose a signal')}
              />
              <Select
                label={t('signalCorrelation.signalB', 'Signal B')}
                options={options}
                value={signalB}
                onChange={(e) => setSignalB(e.target.value)}
                placeholder={t('signalCorrelation.choose', 'Choose a signal')}
              />
              <div className="flex flex-col justify-center gap-1">
                <Toggle
                  checked={detrend}
                  onChange={setDetrend}
                  label={t('signalCorrelation.detrend', 'Correlate changes, not levels')}
                  aria-describedby={detrendHintId}
                />
                <Text id={detrendHintId} variant="caption">
                  {t(
                    'signalCorrelation.detrendHint',
                    'Differencing removes shared drift, so two signals that merely both rise over the day stop looking related',
                  )}
                </Text>
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* 2 — KPI band */}
      <FadeIn delay={0.1}>
        <CorrelationStatStrip result={result} leadLabel={leadLabel} loading={isLoading}
          retained={result != null && (historyAState.isRefreshing || historyBState.isRefreshing
            || historyAState.status === 'stale' || historyBState.status === 'stale')}
          errorA={bothChosen ? historyAState.fatalError ?? historyAState.refreshError : null}
          errorB={bothChosen ? historyBState.fatalError ?? historyBState.refreshError : null}
          onRetryA={() => { void historyA.refetch(); }} onRetryB={() => { void historyB.refetch(); }} />
      </FadeIn>

      {/* 3 — Correlogram */}
      <FadeIn delay={0.2}>
        {!isLoading && !isError && result == null ? (
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">
              {t('signalCorrelation.correlogram.title', 'Lagged correlogram')}
            </PanelTitle>
            <EmptyState /* no-action: the correlogram is computed as soon as two signals with overlapping history are chosen. */
              icon={<GitCompareArrows className="h-8 w-8" />}
              message={comparisonMessage}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('signalCorrelation.correlogram.title', 'Lagged correlogram')}
            subtitle={t(
              'signalCorrelation.screeningCorrelogramHint',
              'Correlation at every time shift; the dashed lines are an approximate screening threshold, not a calibrated significance guarantee',
            )}
            ariaLabel={t(
              'signalCorrelation.correlogram.aria',
              'Line chart of correlation coefficient against time lag between the two selected signals',
            )}
            loading={isLoading}
            error={isError ? error : null}
            onRetry={retryBothFailed}
            empty={correlogram.length === 0}
            emptyMessage={comparisonMessage}
            height={340}
            data={correlogram}
            dataColumns={[
              { key: 'lag', label: t('signalCorrelation.col.lag', 'Lag (s)'), kind: 'measurement', format: formatLag },
              { key: 'r', label: t('signalCorrelation.col.r', 'r'), kind: 'measurement', format: formatMeasurement },
              { key: 'n', label: t('signalCorrelation.col.n', 'Samples'), kind: 'count' },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={correlogram}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="lag" tick={axisTick} unit=" s" tickFormatter={formatMeasurement} />
                <YAxis tick={axisTick} domain={[-1, 1]} tickFormatter={formatMeasurement} />
                <Tooltip content={<ChartTooltip labelFormatter={formatLag} valueFormatter={formatMeasurement} />} />
                <ReferenceLine y={0} stroke="var(--text-muted)" />
                {result != null ? (
                  <ReferenceLine
                    y={result.significanceThreshold}
                    stroke={chartTokens.series[3]}
                    strokeDasharray="4 4"
                  />
                ) : null}
                {result != null ? (
                  <ReferenceLine
                    y={-result.significanceThreshold}
                    stroke={chartTokens.series[3]}
                    strokeDasharray="4 4"
                  />
                ) : null}
                {result != null ? (
                  <ReferenceLine
                    x={result.bestLagS}
                    stroke={chartTokens.series[2]}
                    strokeDasharray="2 4"
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="r"
                  name={t('signalCorrelation.col.r', 'r')}
                  stroke={chartTokens.series[0]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 4 — Normalised overlay */}
      <FadeIn delay={0.3}>
        <ChartContainer
          title={t('signalCorrelation.overlay.title', 'Normalised overlay')}
          subtitle={t(
            'signalCorrelation.overlayHint',
            'Both signals rescaled to 0–1 so their shapes can be compared directly',
          )}
          ariaLabel={t(
            'signalCorrelation.overlay.aria',
            'Area chart of the two selected signals normalised onto a common scale over the overlapping window',
          )}
          chartKey="signal-correlation-overlay"
          loading={isLoading}
          error={isError ? error : null}
          onRetry={retryBothFailed}
          empty={overlay.length === 0}
          emptyMessage={comparisonMessage}
          height={300}
          data={overlay}
          dataColumns={[
            { key: 'time', label: t('signalCorrelation.col.time', 'Time') },
            { key: 'a', label: signalA || t('signalCorrelation.signalA', 'Signal A'), kind: 'measurement', format: formatMeasurement },
            { key: 'b', label: signalB || t('signalCorrelation.signalB', 'Signal B'), kind: 'measurement', format: formatMeasurement },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={overlay}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis
                dataKey="timestamp"
                tick={axisTick}
                tickFormatter={(ms: number) => formatTime(new Date(ms))}
                minTickGap={40}
              />
              <YAxis tick={axisTick} domain={[0, 1]} tickFormatter={formatMeasurement} />
              <Tooltip content={<ChartTooltip valueFormatter={formatMeasurement} labelFormatter={(ms) =>
                typeof ms === 'number' ? `${formatDateTime(new Date(ms))} (${tz})` : '—'
              } />} />
              <ChartLegend state={overlayHidden} />
              <Area
                type="monotone"
                dataKey="a"
                name={signalA || t('signalCorrelation.signalA', 'Signal A')}
                stroke={chartTokens.series[0]}
                fill={chartTokens.series[0]}
                fillOpacity={0.08}
                strokeWidth={2}
                connectNulls={false}
                dot={false}
                hide={overlayHidden.isHidden('a')}
              />
              <Area
                type="monotone"
                dataKey="b"
                name={signalB || t('signalCorrelation.signalB', 'Signal B')}
                stroke={chartTokens.series[4]}
                fill={chartTokens.series[4]}
                fillOpacity={0.08}
                strokeWidth={2}
                connectNulls={false}
                dot={false}
                hide={overlayHidden.isHidden('b')}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </FadeIn>

      {/* 5 — Reading the result */}
      <FadeIn delay={0.4}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Icon icon={Timer} className="text-[var(--text-secondary)]" />
            {t('signalCorrelation.reading', 'Reading the result')}
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={80} />
          ) : isError ? (
            <QueryError error={error} onRetry={retryBothFailed} />
          ) : result == null ? (
            <EmptyState /* no-action: the interpretation follows from the correlogram above. */
              icon={<ArrowLeftRight className="h-8 w-8" />}
              message={comparisonMessage}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Card padding="sm" className="shadow-e0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant={result.significant ? 'success' : 'warning'}>
                    {result.significant
                      ? t('signalCorrelation.clearsScreen', 'Clears screening threshold')
                      : t('signalCorrelation.belowScreen', 'Below screening threshold')}
                  </Badge>
                </div>
                <div className="mb-2 space-y-1">
                  {[
                    { key: 'a', label: t('signalCorrelation.signalA', 'Signal A'), name: signalA, series: result.seriesA },
                    { key: 'b', label: t('signalCorrelation.signalB', 'Signal B'), name: signalB, series: result.seriesB },
                  ].map(({ key, label, name, series }) => (
                    <Text key={key} variant="caption">
                      {label}: {name} — {t('signalCorrelation.coverage', '{{filled}} filled · {{gaps}} gaps', {
                        filled: series.filled,
                        gaps: series.gaps,
                      })}
                    </Text>
                  ))}
                </div>
                <Text variant="body">
                  {result.significant
                    ? t(
                        'signalCorrelation.clearsScreenText',
                        'The peak clears the approximate autocorrelation-adjusted screening threshold. This is a candidate for further investigation, not proof of a real relationship or causation.',
                      )
                    : t(
                        'signalCorrelation.belowScreenText',
                        'The peak does not clear the approximate autocorrelation-adjusted screening threshold. This does not establish that the signals are unrelated or that the observed alignment is noise.',
                      )}
                </Text>
              </Card>
              <Card padding="sm" className="shadow-e0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant="info">{leadLabel}</Badge>
                </div>
                <Text variant="body">
                  {result.bestLagS === 0
                    ? t(
                        'signalCorrelation.zeroLagText',
                        'The signals line up best with no shift at all, which points to a shared cause rather than one driving the other.',
                      )
                    : t(
                        'signalCorrelation.lagText',
                        'The best alignment needs a {{lag}} second shift. Leading in time is not proof of causation, but a consistent lead is where causal explanations start.',
                        { lag: Math.abs(result.bestLagS) },
                      )}
                </Text>
              </Card>
            </div>
          )}
          <Text variant="body" className="mt-3">
            {t(
              'signalCorrelation.screeningMethodology',
              'Methodology: the screening rule uses a fixed critical value of 1.96 and a lag-1 autocorrelation-adjusted effective sample size. It is not a calibrated 95% significance guarantee: the fixed value is not conservative for small effective samples, resampling and gaps can affect dependence, and selecting the strongest peak across multiple lags is not corrected for multiple testing. The summary labels are screening outcomes only; neither a threshold crossing nor a time lead proves causation.',
            )}
          </Text>
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  );
}
