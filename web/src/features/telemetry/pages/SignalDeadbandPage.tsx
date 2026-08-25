import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Filter, Gauge, RadioTower, Waves } from 'lucide-react';

import { useSignalHistory, useSignals } from '@/api/hooks/useTelemetry';
import {
  ChartContainer, ChartTooltip, Line, LineChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { GlassPanel, PanelTitle, Select, Text } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

import { analyzeSignalDeadband } from '../lib/signalDeadband';

const HISTORY_HOURS = 24;

export default function SignalDeadbandPage() {
  const { t } = useTranslation();
  usePageTitle(t('signalDeadband.title', 'Signal Deadband'));
  const { vehicleId } = useSelectedVehicle();
  const id = vehicleId ?? 0;
  const [signal, setSignal] = useState('');
  const signalsQuery = useSignals(id);
  const historyQuery = useSignalHistory(id, signal, HISTORY_HOURS);
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

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('signalDeadband.title', 'Signal Deadband')} />;
  }

  const historyHasData = historyQuery.data !== undefined;
  const historyLoading = signalChosen && !historyHasData && historyQuery.isLoading;
  const historyError = signalChosen && historyQuery.isError && !historyHasData;
  const recommended = analysis?.recommended;

  return (
    <PageContainer
      title={t('signalDeadband.title', 'Signal Deadband')}
      subtitle={t(
        'signalDeadband.subtitle',
        'Estimate a robust numeric noise floor and retain material telemetry changes with fewer redundant emissions',
      )}
      actions={<VehicleSelect />}
      query={[signalsQuery, historyQuery]}
      dataSources={dataSources}
    >
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <RadioTower className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalDeadband.selection.title', 'Signal Under Test')}
          </PanelTitle>
          {signalsQuery.isError ? (
            <QueryError error={signalsQuery.error} onRetry={() => signalsQuery.refetch()} />
          ) : signalsQuery.isLoading ? (
            <Skeleton height={96} />
          ) : options.length === 0 ? (
            <EmptyState /* no-action: the signal catalog populates automatically from ingested telemetry. */
              icon={<RadioTower className="h-8 w-8" />}
              message={t(
                'signalDeadband.selection.empty',
                'No telemetry signals have been recorded for this vehicle yet.',
              )}
            />
          ) : (
            <div className="max-w-xl">
              <Select
                label={t('signalDeadband.selection.label', 'Numeric signal')}
                value={signal}
                options={options}
                onChange={(event) => setSignal(event.target.value)}
                placeholder={t('signalDeadband.selection.placeholder', 'Choose a signal')}
              />
              <Text as="p" variant="caption" className="mt-2">
                {t(
                  'signalDeadband.selection.hint',
                  'Thresholds are analyzed in canonical SI signal units; conversion belongs only at the display boundary.',
                )}
              </Text>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <section
          aria-label={t('signalDeadband.kpis.label', 'Deadband metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {historyError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={historyQuery.error} onRetry={() => historyQuery.refetch()} />
            </GlassPanel>
          ) : historyLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('signalDeadband.kpis.noise', 'MAD Noise Band')}
                value={analysis != null ? fmtNumber(analysis.noiseThreshold, 4) : '—'}
                subtitle={t('signalDeadband.kpis.siUnits', 'canonical SI signal units')}
                icon={<Waves className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('signalDeadband.kpis.redundant', 'Redundant Emissions')}
                value={analysis != null ? fmtPercent(analysis.redundantEmissionRatio * 100, 1) : '—'}
                subtitle={t('signalDeadband.kpis.unchanged', '{{value}} exactly unchanged', {
                  value: analysis != null
                    ? fmtPercent(analysis.unchangedEmissionRatio * 100, 1)
                    : '—',
                })}
                icon={<Activity className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('signalDeadband.kpis.threshold', 'Recommended Deadband')}
                value={recommended != null ? fmtNumber(recommended.threshold, 4) : '—'}
                subtitle={t('signalDeadband.kpis.suppression', '{{value}} noise suppressed', {
                  value: recommended != null
                    ? fmtPercent(recommended.noiseSuppression * 100, 1)
                    : '—',
                })}
                icon={<Filter className="h-5 w-5" />}
                color="blue"
              />
              <MetricCard
                label={t('signalDeadband.kpis.reduction', 'Projected Reduction')}
                value={recommended != null ? fmtPercent(recommended.reduction * 100, 1) : '—'}
                subtitle={t('signalDeadband.kpis.fidelity', '{{value}} reconstruction fidelity', {
                  value: recommended != null ? fmtPercent(recommended.fidelity * 100, 1) : '—',
                })}
                icon={<Gauge className="h-5 w-5" />}
                color={(recommended?.fidelity ?? 0) >= 0.95 ? 'green' : 'amber'}
              />
            </>
          )}
        </section>
      </FadeIn>

      <FadeIn delay={0.2}>
        {historyError ? (
          <GlassPanel className="p-4 sm:p-5">
            <QueryError error={historyQuery.error} onRetry={() => historyQuery.refetch()} />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('signalDeadband.curve.title', 'Cumulative Retained Updates')}
            subtitle={t(
              'signalDeadband.curve.subtitle',
              'Each candidate is simulated against the last retained value, not filtered as isolated adjacent deltas',
            )}
            ariaLabel={t(
              'signalDeadband.curve.aria',
              'Line chart of retained telemetry updates across candidate deadband thresholds',
            )}
            loading={historyLoading}
            empty={candidateData.length === 0}
            height={320}
            data={candidateData}
            dataColumns={[
              { key: 'threshold', label: t('signalDeadband.columns.threshold', 'Deadband (SI)') },
              { key: 'retained', label: t('signalDeadband.columns.retained', 'Retained updates') },
              { key: 'reduction', label: t('signalDeadband.columns.reduction', 'Reduction (%)') },
              { key: 'noiseSuppression', label: t('signalDeadband.columns.noise', 'Noise suppressed (%)') },
              { key: 'materialRetention', label: t('signalDeadband.columns.material', 'Material retained (%)') },
              { key: 'fidelity', label: t('signalDeadband.columns.fidelity', 'Fidelity (%)') },
            ]}
          >
            {/* Single retained-update series; quality dimensions remain available in the data table. */}
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={candidateData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="threshold" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
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
        )}
      </FadeIn>

      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalDeadband.recommendation.title', 'Retention Audit')}
          </PanelTitle>
          {analysis == null ? (
            <EmptyState /* no-action: the signal selector above is the relevant next action. */
              icon={<Filter className="h-8 w-8" />}
              message={signal
                ? t('signalDeadband.recommendation.noNumeric', 'This signal needs at least three numeric history points.')
                : t('signalDeadband.recommendation.empty', 'Choose a signal to audit candidate deadbands.')}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [t('signalDeadband.audit.samples', 'Numeric samples'), fmtNumber(analysis.sampleCount, 0)],
                [t('signalDeadband.audit.noise', 'Noise suppression'), fmtPercent(recommended!.noiseSuppression * 100, 1)],
                [t('signalDeadband.audit.material', 'Material retention'), fmtPercent(recommended!.materialRetention * 100, 1)],
                [t('signalDeadband.audit.fidelity', 'Fidelity'), fmtPercent(recommended!.fidelity * 100, 1)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <Text as="p" variant="caption">{label}</Text>
                  <Text as="p" variant="body" className="mt-1 font-medium">{value}</Text>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
