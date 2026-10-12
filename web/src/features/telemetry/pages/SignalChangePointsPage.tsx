import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitCommitHorizontal, ArrowUpDown, Waypoints } from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, Select, HelpTooltip, Icon } from '@/components/ui';

import type { StatMetric } from '@/components/data-display';
import { TelemetrySummaryBrief } from '../components/operationalbrief-all/TelemetrySummaryBrief';
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
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';

import { chartTokens } from '@/lib/tokens';
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';

import { summarizeSignalChangePoints, toNumericPoints } from '../lib/signalChangePoints';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const HOURS = 72;

export default function SignalChangePointsPage() {
  const { fmtScientificNumber, fmtNumber } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const { t } = useTranslation();
  usePageTitle(t('signalChangePoints.title', 'Signal change points'));

  const { vehicleId } = useSelectedVehicle();
  const id = vehicleId ?? 0;
  const [signalName, setSignalName] = useState('');

  const signalsQuery = useSignals(id);
  const historyQuery = useSignalAnalysisHistory(id, signalName, HOURS);
  const catalogState = useDataState(signalsQuery);
  const historyState = useDataState(historyQuery, { provenance: 'historical' });
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

  const timeline = useMemo(() => {
    const points = toNumericPoints(historyQuery.data?.data ?? []);
    return points.map((p, i) => {
      const seg = summary.segments.find((s) => i >= s.startIndex && i <= s.endIndex);
      const change = summary.changePoints.find((cp) => cp.index === i);
      return {
        ms: p.ms,
        time: new Date(p.ms).toISOString(),
        value: p.value,
        level: seg?.mean ?? null,
        magnitude: change?.magnitude ?? null,
        changePoint: change ? t('signalChangePoints.biggestHint', '{{dir}} · confidence {{conf}}', {
          dir: change.direction === 'up' ? t('signalChangePoints.up', 'up') : t('signalChangePoints.down', 'down'),
          conf: fmtNumber(change.confidence),
        }) : null,
      };
    });
  }, [fmtNumber, historyQuery.data, summary.changePoints, summary.segments, t]);

  const historyHasData = historyState.hasData;
  const isLoading = chosen && historyState.status === 'initial' && !historyState.isRefreshBlocked;
  const isError = chosen && historyState.fatalError != null;
  const error = historyState.fatalError;
  const hasData = chosen && summary.samples > 0;
  const sufficientEvidence = hasData && summary.samples >= summary.minSegmentSamples;
  const waiting = chosen && !historyHasData && !isError;
  const evidenceMessage = !chosen
    ? t('signalChangePoints.pickOne', 'Choose a signal above to detect its change points.')
    : waiting
      ? t('operationalSummary.unknown', 'Source values unknown')
      : t('signalChangePoints.notEnough', 'Not enough history yet for this signal.');
  const formatMeasurement = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? fmtScientificNumber(value, 6) : '—';
  const axisTick = { fill: chartTokens.axisStroke, fontFamily: getChartFontFamily(), fontSize: getChartFontSize(12) };
  const biggest = summary.biggestChange;
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'change-points', rawValue: sufficientEvidence ? summary.changePoints.length : null,
      label: t('signalChangePoints.count', 'Change points'),
      description: t('help.signalChangePoints.count', 'A change point closes the current segment and starts a fresh one only once the cumulative statistic crosses its alarm threshold, and never before the fixed minimum segment length has elapsed.'),
      context: t('signalChangePoints.minSegment', 'min segment {{n}} samples', { n: summary.minSegmentSamples }) },
    { metricId: 'number', occurrenceId: 'biggest-shift', rawValue: biggest?.magnitude,
      label: t('signalChangePoints.biggest', 'Biggest shift'),
      display: { formatter: (raw) => ({ value: fmtScientificNumber(raw, 3), unit: '' }) },
      description: biggest != null ? t('signalChangePoints.biggestHint', '{{dir}} · confidence {{conf}}', {
        dir: biggest.direction === 'up' ? t('signalChangePoints.up', 'up') : t('signalChangePoints.down', 'down'),
        conf: fmtNumber(biggest.confidence),
      }) : sufficientEvidence ? t('signalChangePoints.noShift', 'no shift detected') : evidenceMessage },
    { metricId: 'count', occurrenceId: 'segments', rawValue: hasData ? summary.segments.length : null,
      label: t('signalChangePoints.segments', 'Segments'),
      description: t('signalChangePoints.segmentsHint', 'stable stretches between shifts') },
    { metricId: 'count', occurrenceId: 'samples', rawValue: chosen && historyHasData ? summary.samples : null,
      label: t('signalChangePoints.samples', 'Samples analyzed'),
      description: sufficientEvidence
        ? t('signalChangePoints.noiseScale', 'noise scale {{n}}', { n: fmtScientificNumber(summary.globalSpread, 3) })
        : evidenceMessage },
  ];

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('signalChangePoints.title', 'Signal change points')} />;
  }

  return (
    <PageLayout
      title={t('signalChangePoints.title', 'Signal change points')}
      subtitle={t(
        'signalChangePoints.subtitle',
        'Robust Page-Hinkley detection of abrupt level shifts in a numeric signal — deliberately distinct from slow drift (signal trend) and drive-week regime clustering',
      )}
      query={[signalsQuery, historyQuery]}
      dataSources={dataSources}
    >
      {/* 1 — Signal picker */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex flex-wrap items-center gap-2">
            <Icon icon={GitCommitHorizontal} size="md" className="shrink-0" />
            <span className="min-w-0 break-words">{t('signalChangePoints.pick', 'Choose a signal')}</span>
            <HelpTooltip
              size="sm"
              i18nKey="help.signalChangePoints.pick"
              defaultValue="Delta and threshold are calibrated from the median absolute deviation of first differences, and each sample's contribution to the alarm statistic is capped — so one wild reading cannot alone trigger a false change point."
              ariaLabel={t('help.signalChangePoints.iconLabel', 'More info about signal selection')}
            />
          </PanelTitle>
          {catalogState.fatalError ? (
            <QueryError error={catalogState.fatalError} />
          ) : catalogState.status === 'initial' && !catalogState.isRefreshBlocked ? (
            <Skeleton height={80} />
          ) : !catalogState.hasData ? (
            <Text color="secondary">{t('operationalSummary.unknown', 'Source values unknown')}</Text>
          ) : options.length === 0 ? (
            <EmptyState /* no-action: signals appear as the telemetry stream reports them. */
              icon={<Waypoints className="h-8 w-8" />}
              message={t('signalChangePoints.noSignals', 'No telemetry signals have been recorded for this vehicle yet.')}
            />
          ) : (
            <Select
              className="min-h-11 md:min-h-10"
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
        <TelemetrySummaryBrief title={t('signalChangePoints.kpis', 'Change-point metrics')}
          metrics={metrics} testId="signal-change-points-summary" loading={isLoading}
          unavailable={isError} unknown={!sufficientEvidence} sourceStatus={historyState.status}
          retained={historyHasData && (historyState.isRefreshing || historyState.status === 'stale' || historyState.refreshError != null)}
          scope={t('telemetry.brief.historyWindow', '{{hours}}h requested · {{signal}}', { hours: HOURS, signal: signalName || '—' })}
          sourceBounds={signalName ? [{ signal: signalName, from: historyQuery.data?.from, to: historyQuery.data?.to }] : []}
          provenance={t('telemetry.brief.historyProvenance', 'Selected signal history; numeric samples only')}
          description={t('telemetry.brief.analysisBounds', 'Analysis covers returned numeric samples, not guaranteed full-window coverage. Exact bounds remain unknown when not supplied by the source.')} />
      </FadeIn>

      {/* 3 — Timeline with segment levels and change-point markers */}
      <FadeIn delay={0.2}>
        {/* chart-legend-audit:skip two named series (actual + segment level) kept always visible together so the step-level context is never accidentally hidden */}
          <ChartContainer
            title={t('signalChangePoints.timeline', 'Regime timeline')}
            subtitle={t('signalChangePoints.timelineHint', 'Raw values against each segment\u2019s mean; dashed markers are detected change points')}
            ariaLabel={t('signalChangePoints.timelineAria', 'Line chart of raw signal values overlaid with segment mean levels and detected abrupt change points')}
            loading={isLoading}
            error={isError ? error : null}
            empty={timeline.length === 0}
            emptyMessage={evidenceMessage}
            height={340}
            data={timeline}
            dataColumns={[
              { key: 'time', label: t('signalChangePoints.col.time', 'Time'),
                format: (value) => typeof value === 'string' ? `${formatDateTime(value)} · ${value}` : '—' },
              { key: 'value', label: t('signalChangePoints.col.value', 'Value'), kind: 'measurement', format: formatMeasurement },
              { key: 'level', label: t('signalChangePoints.col.level', 'Segment mean'), kind: 'measurement', format: formatMeasurement },
              { key: 'changePoint', label: t('signalChangePoints.count', 'Change points') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
                <XAxis dataKey="ms" type="number" scale="time" domain={['dataMin', 'dataMax']}
                  tick={axisTick} tickFormatter={(ms: number) => formatDateTime(new Date(ms))} minTickGap={40} />
                <YAxis tick={axisTick} tickFormatter={formatMeasurement} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip valueFormatter={formatMeasurement}
                  labelFormatter={(ms) => typeof ms === 'number' ? `${formatDateTime(new Date(ms))} · ${new Date(ms).toISOString()}` : '—'} />} />
                {summary.changePoints.map((cp) => (
                  <ReferenceLine key={cp.ms} x={cp.ms} stroke={chartTokens.series[3]} strokeDasharray="4 4" />
                ))}
                <Line type="monotone" dataKey="value" name={t('signalChangePoints.col.value', 'Value')} stroke={chartTokens.series[0]} strokeWidth={2} dot={false} />
                <Line type="stepAfter" dataKey="level" name={t('signalChangePoints.col.level', 'Segment mean')} stroke={chartTokens.series[3]} strokeWidth={1} strokeDasharray="4 4" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
      </FadeIn>

      {/* 4 — Reading the result */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Icon icon={ArrowUpDown} size="md" className="shrink-0" />
            {t('signalChangePoints.reading', 'Reading the result')}
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={80} />
          ) : isError ? (
            <QueryError error={error} />
          ) : !sufficientEvidence ? (
            <EmptyState /* no-action: the interpretation follows from the detected segments above. */
              icon={<GitCommitHorizontal className="h-8 w-8" />}
              message={chosen ? evidenceMessage : t('signalChangePoints.noReading', 'Pick a signal to see how its change points should be read.')}
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
    </PageLayout>
  );
}
