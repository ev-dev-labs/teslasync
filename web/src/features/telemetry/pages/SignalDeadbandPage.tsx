import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, Gauge, RadioTower } from 'lucide-react';

import { useSignalHistory, useSignals } from '@/api/hooks/useTelemetry';
import {
  ChartContainer, ChartTooltip, Line, LineChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import type { StatMetric } from '@/components/data-display';
import { TelemetrySummaryBrief } from '../components/operationalbrief-all/TelemetrySummaryBrief';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { GlassPanel, Icon, PanelTitle, Select } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';

import { chartTokens, typography } from '@/lib/tokens';
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';

import { analyzeSignalDeadband } from '../lib/signalDeadband';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function SignalDeadbandPage() {
  const { fmtScientificNumber, fmtPercent, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('signalDeadband.title', 'Signal deadband'));
  const { vehicleId } = useSelectedVehicle();
  const id = vehicleId ?? 0;
  const [signal, setSignal] = useState('');
  const { startInstant, endInstantExclusive } = useRangeState({ defaultPresetId: '24h' });
  const historyHours = (Date.parse(endInstantExclusive) - Date.parse(startInstant)) / 3_600_000;
  const signalsQuery = useSignals(id);
  const historyQuery = useSignalHistory(id, signal, historyHours, { startInstant, endInstantExclusive });
  const catalogState = useDataState(signalsQuery);
  const historyState = useDataState(historyQuery, {
    provenance: 'historical',
    unavailable: signal !== '' && historyQuery.data !== undefined && (historyQuery.data.data ?? []).length === 0,
  });
  const signalChosen = signal !== '';
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
        enabled: signalChosen,
      },
    ],
    [historyQuery, signalChosen, signalsQuery, t],
  );
  const options = useMemo(
    () => (signalsQuery.data ?? []).map((name) => ({ value: name, label: name })),
    [signalsQuery.data],
  );
  const analysis = useMemo(
    () => analyzeSignalDeadband(historyQuery.data?.data ?? []),
    [historyQuery.data],
  );
  const candidateData = useMemo(
    () => (analysis?.candidates ?? []).map((candidate) => ({
      threshold: candidate.threshold,
      retained: candidate.retainedUpdates,
      reduction: Math.round(candidate.reduction * 1000) / 10,
      noiseSuppression: Math.round(candidate.noiseSuppression * 1000) / 10,
      materialRetention: Math.round(candidate.materialRetention * 1000) / 10,
      fidelity: Math.round(candidate.fidelity * 1000) / 10,
    })),
    [analysis],
  );

  const historyHasData = historyQuery.data !== undefined;
  const historyLoading = signalChosen && !historyHasData && historyQuery.isLoading;
  const historyError = signalChosen && historyState.fatalError != null;
  const emptyMessage = !signalChosen
    ? t('signalDeadband.recommendation.empty', 'Choose a signal to audit candidate deadbands.')
    : !historyHasData
      ? t('operationalSummary.unknown', 'Source values unknown')
      : (historyQuery.data?.data ?? []).length === 0
        ? t('signalHistory.emptyTitle', 'No signal samples')
        : t('signalDeadband.recommendation.noNumeric', 'This signal needs at least three numeric history points.');
  const axisTick = {
    fill: 'var(--text-muted)', fontFamily: getChartFontFamily(), fontSize: getChartFontSize(12),
  };
  const recommended = analysis?.recommended;
  const metrics: readonly StatMetric[] = [
    { metricId: 'number', occurrenceId: 'noise', rawValue: analysis?.noiseThreshold,
      label: t('signalDeadband.kpis.noise', 'MAD noise band'),
      display: { formatter: (raw) => ({ value: fmtScientificNumber(raw, 4), unit: '' }) },
      description: t('signalDeadband.kpis.siUnits', 'canonical SI signal units') },
    { metricId: 'percent', occurrenceId: 'redundant', rawValue: analysis == null ? null : analysis.redundantEmissionRatio * 100,
      label: t('signalDeadband.kpis.redundant', 'Redundant emissions'),
      display: { formatter: (raw) => ({ value: fmtPercent(raw), unit: '' }) },
      description: t('signalDeadband.kpis.unchanged', '{{value}} exactly unchanged', {
        value: analysis == null ? '—' : fmtPercent(analysis.unchangedEmissionRatio * 100),
      }) },
    { metricId: 'number', occurrenceId: 'threshold', rawValue: recommended?.threshold,
      label: t('signalDeadband.kpis.threshold', 'Recommended deadband'),
      display: { formatter: (raw) => ({ value: fmtScientificNumber(raw, 4), unit: '' }) },
      description: t('signalDeadband.kpis.suppression', '{{value}} noise suppressed', {
        value: recommended == null ? '—' : fmtPercent(recommended.noiseSuppression * 100),
      }) },
    { metricId: 'percent', occurrenceId: 'reduction', rawValue: recommended == null ? null : recommended.reduction * 100,
      label: t('signalDeadband.kpis.reduction', 'Projected reduction'),
      display: { formatter: (raw) => ({ value: fmtPercent(raw), unit: '' }) },
      description: t('signalDeadband.kpis.fidelity', '{{value}} reconstruction fidelity', {
        value: recommended == null ? '—' : fmtPercent(recommended.fidelity * 100),
      }) },
  ];
  const auditMetrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'samples', rawValue: analysis?.sampleCount,
      label: t('signalDeadband.audit.samples', 'Numeric samples'),
      display: { formatter: (raw) => ({ value: fmtInt(raw), unit: '' }) },
      description: t('signalDeadband.kpis.siUnits', 'canonical SI signal units') },
    ...([
      ['noise', 'signalDeadband.audit.noise', 'Noise suppression', recommended?.noiseSuppression],
      ['material', 'signalDeadband.audit.material', 'Material retention', recommended?.materialRetention],
      ['fidelity', 'signalDeadband.audit.fidelity', 'Fidelity', recommended?.fidelity],
    ] as const).map(([key, labelKey, label, raw]): StatMetric => ({
      metricId: 'percent', occurrenceId: key, rawValue: raw == null ? null : raw * 100,
      label: t(labelKey, label),
      display: { formatter: (value) => ({ value: fmtPercent(value), unit: '' }) },
      description: t('signalDeadband.curve.subtitle', 'Each candidate is simulated against the last retained value, not filtered as isolated adjacent deltas'),
    })),
  ];

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('signalDeadband.title', 'Signal deadband')} />;
  }

  return (
    <PageLayout
      title={t('signalDeadband.title', 'Signal deadband')}
      subtitle={t(
        'signalDeadband.subtitle',
        'Estimate a robust numeric noise floor and retain material telemetry changes with fewer redundant emissions',
      )}
      query={[signalsQuery, historyQuery]}
      dataSources={dataSources}
    >
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Icon icon={RadioTower} size="md" className={typography.color.muted} />
            {t('signalDeadband.selection.title', 'Signal under test')}
          </PanelTitle>
          {catalogState.fatalError ? (
            <QueryError error={catalogState.fatalError} onRetry={() => signalsQuery.refetch()} />
          ) : !catalogState.hasData ? (
            <Skeleton height={96} />
          ) : options.length === 0 ? (
            <EmptyState /* no-action: catalog availability is independent of recorded history. */
              icon={<Icon icon={RadioTower} size="xl" />}
              message={t('signalQuery.noSignals', 'No signals available')}
            />
          ) : (
            <div className="max-w-xl">
              <Select
                id="signal-deadband-signal"
                label={t('signalDeadband.selection.label', 'Numeric signal')}
                value={signal}
                options={options}
                onChange={(event) => setSignal(event.target.value)}
                placeholder={t('signalDeadband.selection.placeholder', 'Choose a signal')}
                hint={t(
                  'signalDeadband.selection.hint',
                  'Thresholds are analyzed in canonical SI signal units; conversion belongs only at the display boundary.',
                )}
              />
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <TelemetrySummaryBrief title={t('signalDeadband.kpis.label', 'Deadband metrics')}
          metrics={metrics} testId="signal-deadband-summary" loading={historyLoading}
          unavailable={historyError} unknown={!signalChosen || analysis == null} sourceStatus={historyState.status}
          retained={historyHasData && (historyState.isRefreshing || historyState.status === 'stale' || historyState.refreshError != null)}
          scope={t('telemetry.brief.historyWindow', '{{hours}}h requested · {{signal}}', { hours: historyHours, signal: signal || '—' })}
          sourceBounds={signal ? [{ signal, from: historyQuery.data?.from, to: historyQuery.data?.to }] : []}
          provenance={t('telemetry.brief.historyProvenance', 'Selected signal history; numeric samples only')}
          description={t('telemetry.brief.analysisBounds', 'Analysis covers returned numeric samples, not guaranteed full-window coverage. Exact bounds remain unknown when not supplied by the source.')} />
      </FadeIn>

      <FadeIn delay={0.2}>
          <ChartContainer
            title={t('signalDeadband.curve.title', 'Cumulative retained updates')}
            subtitle={t(
              'signalDeadband.curve.subtitle',
              'Each candidate is simulated against the last retained value, not filtered as isolated adjacent deltas',
            )}
            ariaLabel={t(
              'signalDeadband.curve.aria',
              'Line chart of retained telemetry updates across candidate deadband thresholds',
            )}
            loading={historyLoading}
            error={signalChosen ? historyState.fatalError : null}
            empty={candidateData.length === 0}
            emptyMessage={emptyMessage}
            emptyDescription={t('telemetry.brief.analysisBounds', 'Analysis covers returned numeric samples, not guaranteed full-window coverage. Exact bounds remain unknown when not supplied by the source.')}
            height={320}
            data={candidateData}
            dataColumns={[
              { key: 'threshold', label: t('signalDeadband.columns.threshold', 'Deadband (SI)'), format: (value) => fmtScientificNumber(value, 4) },
              { key: 'retained', label: t('signalDeadband.columns.retained', 'Retained updates'), kind: 'count', format: fmtInt },
              { key: 'reduction', label: t('signalDeadband.columns.reduction', 'Reduction (%)'), format: fmtPercent },
              { key: 'noiseSuppression', label: t('signalDeadband.columns.noise', 'Noise suppressed (%)'), format: fmtPercent },
              { key: 'materialRetention', label: t('signalDeadband.columns.material', 'Material retained (%)'), format: fmtPercent },
              { key: 'fidelity', label: t('signalDeadband.columns.fidelity', 'Fidelity (%)'), format: fmtPercent },
            ]}
          >
            {/* Single retained-update series; quality dimensions remain available in the data table. */}
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={candidateData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="threshold" tick={axisTick} tickFormatter={(value) => fmtScientificNumber(value, 4)} />
                <YAxis tick={axisTick} tickFormatter={(value) => fmtInt(value)} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  dataKey="retained"
                  name={t('signalDeadband.columns.retained', 'Retained updates')}
                  stroke={chartTokens.series[0]}
                  strokeWidth={2}
                  dot={false}
                  type="monotone"
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
      </FadeIn>

      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          {analysis == null && <PanelTitle className="mb-3 flex items-center gap-2">
            <Icon icon={Gauge} size="md" className={typography.color.muted} />
            {t('signalDeadband.recommendation.title', 'Retention audit')}
          </PanelTitle>}
          {historyLoading ? (
            <Skeleton height={80} />
          ) : analysis == null ? (
            <EmptyState /* no-action: the signal selector above is the relevant next action. */
              icon={<Icon icon={Filter} size="xl" />}
              message={historyError
                ? t('operationalSummary.unavailable', 'Source unavailable')
                : emptyMessage}
            />
          ) : (
            <TelemetrySummaryBrief title={t('signalDeadband.recommendation.title', 'Retention audit')}
              metrics={auditMetrics} testId="signal-deadband-retention-summary" sourceStatus={historyState.status}
              retained={historyState.isRefreshing || historyState.status === 'stale' || historyState.refreshError != null}
              scope={t('telemetry.brief.historyWindow', '{{hours}}h requested · {{signal}}', { hours: historyHours, signal })}
              sourceBounds={[{ signal, from: historyQuery.data?.from, to: historyQuery.data?.to }]}
              provenance={t('telemetry.brief.historyProvenance', 'Selected signal history; numeric samples only')}
              description={t('signalDeadband.curve.subtitle', 'Each candidate is simulated against the last retained value, not filtered as isolated adjacent deltas')} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  );
}
