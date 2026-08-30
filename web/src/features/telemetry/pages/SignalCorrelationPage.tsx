import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, GitCompareArrows, Timer, Waypoints } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, Select, Toggle, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
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
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { chartTokens } from '@/lib/tokens';

import { crossCorrelate } from '../lib/signalCorrelation';

const HOURS = 24;

export default function SignalCorrelationPage() {
  const { t } = useTranslation();
  usePageTitle(t('signalCorrelation.title', 'Signal Correlation'));

  const { vehicleId } = useSelectedVehicle();
  const id = vehicleId ?? 0;

  const [signalA, setSignalA] = useState('');
  const [signalB, setSignalB] = useState('');
  const [detrend, setDetrend] = useState(false);
  const overlayHidden = useHiddenSeries('signal-correlation-overlay');

  const signalsQuery = useSignals(id);
  const historyA = useSignalHistory(id, signalA, HOURS);
  const historyB = useSignalHistory(id, signalB, HOURS);
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

  const result = useMemo(() => {
    const a = historyA.data?.data ?? [];
    const b = historyB.data?.data ?? [];
    if (a.length === 0 || b.length === 0) return null;
    return crossCorrelate(a, b, { detrend });
  }, [historyA.data, historyB.data, detrend]);

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
      time: new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      a: na(seriesA.v[i] ?? null),
      b: nb(seriesB.v[i] ?? null),
    }));
  }, [result]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('signalCorrelation.title', 'Signal Correlation')} />;
  }

  const historyAHasData = historyA.data !== undefined;
  const historyBHasData = historyB.data !== undefined;
  const isLoading = bothChosen && (
    (!historyAHasData && historyA.isLoading)
    || (!historyBHasData && historyB.isLoading)
  );
  const isError = bothChosen && (
    (historyA.isError && !historyAHasData)
    || (historyB.isError && !historyBHasData)
  );
  const error =
    historyA.isError && !historyAHasData
      ? historyA.error
      : historyB.error;

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
    <PageContainer
      title={t('signalCorrelation.title', 'Signal Correlation')}
      subtitle={t(
        'signalCorrelation.subtitle',
        'Sweep one telemetry signal against another across time shifts to find not just whether they move together, but which one moves first',
      )}
      query={[signalsQuery, historyA, historyB]}
      dataSources={dataSources}
      actions={<VehicleSelect />}
    >
      {/* 1 — Signal pickers */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalCorrelation.pick', 'Choose Two Signals')}
            <HelpTooltip
              size="sm"
              i18nKey="help.signalCorrelation.pick"
              defaultValue="The two signals are resampled onto a shared time grid using last-known-value hold, with a staleness limit so a gap in reporting becomes a genuine gap rather than a flat line that would fake a correlation."
              ariaLabel={t('help.signalCorrelation.iconLabel', 'More info about signal selection')}
            />
          </PanelTitle>
          {signalsQuery.isError ? (
            <QueryError error={signalsQuery.error} onRetry={() => signalsQuery.refetch()} />
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
                />
                <Text variant="caption">
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
        <section
          aria-label={t('signalCorrelation.kpis', 'Correlation metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError
                error={error}
                onRetry={() => {
                  void historyA.refetch();
                  void historyB.refetch();
                }}
              />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('signalCorrelation.bestR', 'Peak Correlation')}
                value={result != null ? result.bestR.toFixed(3) : '—'}
                subtitle={t('signalCorrelation.zeroLag', 'at zero lag: {{r}}', {
                  r: result != null ? result.zeroLagR.toFixed(3) : '—',
                })}
                icon={<GitCompareArrows className="h-5 w-5" />}
                color={Math.abs(result?.bestR ?? 0) >= 0.7 ? 'green' : 'cyan'}
                help={{
                  i18nKey: 'help.signalCorrelation.bestR',
                  defaultValue:
                    'An ordinary overlay chart only ever shows the zero-lag correlation, which misses every relationship with a delay in it. Sweeping the lag finds the shift at which the two signals line up best, and the difference between the peak and the zero-lag value is exactly the information a static chart throws away.',
                }}
              />
              <MetricCard
                label={t('signalCorrelation.bestLag', 'Best Lag')}
                value={result != null ? `${result.bestLagS} s` : '—'}
                subtitle={leadLabel}
                icon={<Timer className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('signalCorrelation.significance', 'Significance')}
                value={
                  result == null
                    ? '—'
                    : result.significant
                      ? t('signalCorrelation.real', 'Real')
                      : t('signalCorrelation.noise', 'Noise')
                }
                subtitle={t('signalCorrelation.threshold', 'needs |r| > {{v}}', {
                  v: result != null ? result.significanceThreshold.toFixed(3) : '—',
                })}
                icon={<ArrowLeftRight className="h-5 w-5" />}
                color={result?.significant ? 'green' : 'amber'}
              />
              <MetricCard
                label={t('signalCorrelation.effectiveN', 'Effective Samples')}
                value={result != null ? Math.round(result.effectiveN) : '—'}
                subtitle={t('signalCorrelation.rawN', 'from {{n}} raw points', {
                  n: result?.bestN ?? 0,
                })}
                icon={<Waypoints className="h-5 w-5" />}
                color="blue"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 3 — Correlogram */}
      <FadeIn delay={0.2}>
        {!isLoading && !isError && result == null ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: the correlogram is computed as soon as two signals with overlapping history are chosen. */
              icon={<GitCompareArrows className="h-8 w-8" />}
              message={
                bothChosen
                  ? t(
                      'signalCorrelation.noOverlap',
                      'These two signals have no overlapping window of history in the last day, so there is nothing to compare.',
                    )
                  : t(
                      'signalCorrelation.pickTwo',
                      'Choose two signals above to compute the correlogram.',
                    )
              }
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('signalCorrelation.correlogram', 'Lagged Correlogram')}
            subtitle={t(
              'signalCorrelation.correlogramHint',
              'Correlation at every time shift; the dashed lines are the significance threshold',
            )}
            ariaLabel={t(
              'signalCorrelation.correlogram.aria',
              'Line chart of correlation coefficient against time lag between the two selected signals',
            )}
            loading={isLoading}
            empty={correlogram.length === 0}
            height={340}
            data={correlogram}
            dataColumns={[
              { key: 'lag', label: t('signalCorrelation.col.lag', 'Lag (s)') },
              { key: 'r', label: t('signalCorrelation.col.r', 'r') },
              { key: 'n', label: t('signalCorrelation.col.n', 'Samples') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={correlogram}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="lag" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit=" s" />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={[-1, 1]} />
                <Tooltip content={<ChartTooltip />} />
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
          title={t('signalCorrelation.overlay', 'Normalised Overlay')}
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
          empty={overlay.length === 0}
          height={300}
          data={overlay}
          dataColumns={[
            { key: 'time', label: t('signalCorrelation.col.time', 'Time') },
            { key: 'a', label: signalA || t('signalCorrelation.signalA', 'Signal A') },
            { key: 'b', label: signalB || t('signalCorrelation.signalB', 'Signal B') },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={overlay}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={40} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={[0, 1]} />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend state={overlayHidden} />
              <Area
                type="monotone"
                dataKey="a"
                name={signalA || t('signalCorrelation.signalA', 'Signal A')}
                stroke={chartTokens.series[0]}
                fill={chartTokens.series[0]}
                fillOpacity={0.18}
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
                fillOpacity={0.18}
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
            <Timer className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalCorrelation.reading', 'Reading the Result')}
          </PanelTitle>
          {result == null ? (
            <EmptyState /* no-action: the interpretation follows from the correlogram above. */
              icon={<ArrowLeftRight className="h-8 w-8" />}
              message={t(
                'signalCorrelation.noReading',
                'Pick two signals to see how the result should be read.',
              )}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant={result.significant ? 'success' : 'warning'}>
                    {result.significant
                      ? t('signalCorrelation.real', 'Real')
                      : t('signalCorrelation.noise', 'Noise')}
                  </Badge>
                  <Text variant="caption">
                    {t('signalCorrelation.coverage', '{{filled}} filled · {{gaps}} gaps', {
                      filled: result.seriesA.filled,
                      gaps: result.seriesA.gaps,
                    })}
                  </Text>
                </div>
                <Text variant="body">
                  {result.significant
                    ? t(
                        'signalCorrelation.realText',
                        'The peak clears the threshold adjusted for autocorrelation, so this relationship is unlikely to be an artefact of the two signals simply being smooth.',
                      )
                    : t(
                        'signalCorrelation.noiseText',
                        'The peak does not clear the autocorrelation-adjusted threshold. Smooth signals correlate with almost anything, so this is best treated as coincidence.',
                      )}
                </Text>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
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
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
