import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitCommitHorizontal, ArrowUpDown, Layers, Waypoints } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, Select, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  LineChart, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useSignals, useSignalAnalysisHistory } from '@/api/hooks/useTelemetry';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

import { summarizeSignalChangePoints, toNumericPoints } from '../lib/signalChangePoints';

const HOURS = 72;

export default function SignalChangePointsPage() {
  const { t } = useTranslation();
  usePageTitle(t('signalChangePoints.title', 'Signal Change Points'));

  const { vehicleId } = useSelectedVehicle();
  const id = vehicleId ?? 0;
  const [signalName, setSignalName] = useState('');

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
    () => summarizeSignalChangePoints(historyQuery.data?.data ?? []),
    [historyQuery.data],
  );

  const fmtTime = (ms: number) =>
    new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const timeline = useMemo(() => {
    const points = toNumericPoints(historyQuery.data?.data ?? []);
    return points.map((p, i) => {
      const seg = summary.segments.find((s) => i >= s.startIndex && i <= s.endIndex);
      return {
        ms: p.ms,
        time: fmtTime(p.ms),
        value: Math.round(p.value * 1000) / 1000,
        level: seg != null ? Math.round(seg.mean * 1000) / 1000 : null,
      };
    });
  }, [historyQuery.data, summary.segments]);

  const markerTimes = useMemo(
    () => summary.changePoints.map((cp) => timeline[cp.index]?.time).filter((v): v is string => v != null),
    [summary.changePoints, timeline],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('signalChangePoints.title', 'Signal Change Points')} />;
  }

  const historyHasData = historyQuery.data !== undefined;
  const isLoading = chosen && !historyHasData && historyQuery.isLoading;
  const isError = chosen && historyQuery.isError && !historyHasData;
  const error = historyQuery.error;
  const hasData = chosen && summary.samples > 0;
  const biggest = summary.biggestChange;

  return (
    <PageContainer
      title={t('signalChangePoints.title', 'Signal Change Points')}
      subtitle={t(
        'signalChangePoints.subtitle',
        'Robust Page-Hinkley detection of abrupt level shifts in a numeric signal — deliberately distinct from slow drift (Signal Trend) and drive-week regime clustering',
      )}
      query={[signalsQuery, historyQuery]}
      dataSources={dataSources}
      actions={<VehicleSelect />}
    >
      {/* 1 — Signal picker */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <GitCommitHorizontal className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalChangePoints.pick', 'Choose a Signal')}
            <HelpTooltip
              size="sm"
              i18nKey="help.signalChangePoints.pick"
              defaultValue="Delta and threshold are calibrated from the median absolute deviation of first differences, and each sample's contribution to the alarm statistic is capped — so one wild reading cannot alone trigger a false change point."
              ariaLabel={t('help.signalChangePoints.iconLabel', 'More info about signal selection')}
            />
          </PanelTitle>
          {signalsQuery.isError ? (
            <QueryError error={signalsQuery.error} onRetry={() => signalsQuery.refetch()} />
          ) : signalsQuery.isLoading ? (
            <Skeleton height={80} />
          ) : options.length === 0 ? (
            <EmptyState /* no-action: signals appear as the telemetry stream reports them. */
              icon={<Waypoints className="h-8 w-8" />}
              message={t('signalChangePoints.noSignals', 'No telemetry signals have been recorded for this vehicle yet.')}
            />
          ) : (
            <Select
              label={t('signalChangePoints.signal', 'Signal')}
              options={options}
              value={signalName}
              onChange={(e) => setSignalName(e.target.value)}
              placeholder={t('signalChangePoints.choose', 'Choose a signal')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* 2 — KPI band */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('signalChangePoints.kpis', 'Change-point metrics')}
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
                label={t('signalChangePoints.count', 'Change Points')}
                value={hasData ? summary.changePoints.length : '—'}
                subtitle={t('signalChangePoints.minSegment', 'min segment {{n}} samples', { n: summary.minSegmentSamples })}
                icon={<GitCommitHorizontal className="h-5 w-5" />}
                color={hasData && summary.changePoints.length > 0 ? 'amber' : 'green'}
                help={{
                  i18nKey: 'help.signalChangePoints.count',
                  defaultValue: 'A change point closes the current segment and starts a fresh one only once the cumulative statistic crosses its alarm threshold, and never before the fixed minimum segment length has elapsed.',
                }}
              />
              <MetricCard
                label={t('signalChangePoints.biggest', 'Biggest Shift')}
                value={biggest != null ? fmtNumber(biggest.magnitude, 3) : '—'}
                subtitle={
                  biggest != null
                    ? t('signalChangePoints.biggestHint', '{{dir}} · confidence {{conf}}', {
                        dir: biggest.direction === 'up' ? t('signalChangePoints.up', 'up') : t('signalChangePoints.down', 'down'),
                        conf: fmtNumber(biggest.confidence, 2),
                      })
                    : t('signalChangePoints.noShift', 'no shift detected')
                }
                icon={<ArrowUpDown className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('signalChangePoints.segments', 'Segments')}
                value={hasData ? summary.segments.length : '—'}
                subtitle={t('signalChangePoints.segmentsHint', 'stable stretches between shifts')}
                icon={<Layers className="h-5 w-5" />}
                color="blue"
              />
              <MetricCard
                label={t('signalChangePoints.samples', 'Samples Analyzed')}
                value={summary.samples}
                subtitle={t('signalChangePoints.noiseScale', 'noise scale {{n}}', { n: fmtNumber(summary.globalSpread, 3) })}
                icon={<Waypoints className="h-5 w-5" />}
                color="cyan"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 3 — Timeline with segment levels and change-point markers */}
      <FadeIn delay={0.2}>
        {!isLoading && !isError && timeline.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: the timeline appears once a signal with history is chosen. */
              icon={<GitCommitHorizontal className="h-8 w-8" />}
              message={chosen ? t('signalChangePoints.notEnough', 'Not enough history yet for this signal.') : t('signalChangePoints.pickOne', 'Choose a signal above to detect its change points.')}
            />
          </GlassPanel>
        ) : (
          // chart-legend-audit:skip two named series (actual + segment level) kept always visible together so the step-level context is never accidentally hidden
          <ChartContainer
            title={t('signalChangePoints.timeline', 'Regime Timeline')}
            subtitle={t('signalChangePoints.timelineHint', 'Raw values against each segment\u2019s mean; dashed markers are detected change points')}
            ariaLabel={t('signalChangePoints.timelineAria', 'Line chart of raw signal values overlaid with segment mean levels and detected abrupt change points')}
            loading={isLoading}
            empty={timeline.length === 0}
            height={340}
            data={timeline}
            dataColumns={[
              { key: 'time', label: t('signalChangePoints.col.time', 'Time') },
              { key: 'value', label: t('signalChangePoints.col.value', 'Value') },
              { key: 'level', label: t('signalChangePoints.col.level', 'Segment mean') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip />} />
                {markerTimes.map((time) => (
                  <ReferenceLine key={time} x={time} stroke={chartTokens.series[3]} strokeDasharray="4 4" />
                ))}
                <Line type="monotone" dataKey="value" name={t('signalChangePoints.col.value', 'Value')} stroke={chartTokens.series[0]} strokeWidth={1.5} dot={false} />
                <Line type="stepAfter" dataKey="level" name={t('signalChangePoints.col.level', 'Segment mean')} stroke={chartTokens.series[3]} strokeWidth={2} dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 4 — Reading the result */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalChangePoints.reading', 'Reading the Result')}
          </PanelTitle>
          {!hasData ? (
            <EmptyState /* no-action: the interpretation follows from the detected segments above. */
              icon={<GitCommitHorizontal className="h-8 w-8" />}
              message={t('signalChangePoints.noReading', 'Pick a signal to see how its change points should be read.')}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant={summary.changePoints.length > 0 ? 'warning' : 'success'}>
                    {summary.changePoints.length > 0
                      ? t('signalChangePoints.shifted', 'Regime shift detected')
                      : t('signalChangePoints.stable', 'Stable throughout')}
                  </Badge>
                </div>
                <Text variant="body">
                  {summary.changePoints.length > 0
                    ? t('signalChangePoints.shiftedText', 'This signal stepped to a new stable level at least once — a different failure mode from a slow ramp, which would show no alarm here at all.')
                    : t('signalChangePoints.stableText', 'No abrupt level shift cleared the alarm threshold across the window analyzed; single-sample spikes are deliberately not enough to trigger one.')}
                </Text>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant="info">{t('signalChangePoints.scope', 'Scope')}</Badge>
                </div>
                <Text variant="body">
                  {t('signalChangePoints.scopeText', 'This detector looks only at this one signal\u2019s raw sample sequence over {{h}}h — it is not the same as the aggregate drive-week regime clustering elsewhere in the app.', { h: HOURS })}
                </Text>
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
