import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, Grid3X3, Network, RadioTower, Shuffle } from 'lucide-react';

import { useSignalHistory, useSignals } from '@/api/hooks/useTelemetry';
import {
  Bar, BarChart, CartesianGrid, ChartContainer, ChartTooltip,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, GlassPanel, PanelTitle, Select, Text } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { cn } from '@/lib/cn';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import { analyzeSignalMutualInformation } from '../lib/signalMutualInformation';
const HISTORY_HOURS = 24;
function heatClass(contribution: number, maximum: number): string {
  const strength = maximum > 0 ? Math.abs(contribution) / maximum : 0;
  const tone = contribution < 0 ? 'bg-rose-500' : 'bg-cyan-500';
  const opacity = strength > 0.75
    ? 'bg-opacity-40'
    : strength > 0.4
      ? 'bg-opacity-25'
      : strength > 0
        ? 'bg-opacity-10'
        : 'bg-opacity-5';
  return cn(tone, opacity);
}
export default function SignalMutualInformationPage() {
  const { t } = useTranslation();
  usePageTitle(t('signalMutualInformation.title', 'Signal Mutual Information'));
  const { vehicleId } = useSelectedVehicle();
  const id = vehicleId ?? 0;
  const [signalA, setSignalA] = useState('');
  const [signalB, setSignalB] = useState('');
  const signalsQuery = useSignals(id);
  const historyA = useSignalHistory(id, signalA, HISTORY_HOURS);
  const historyB = useSignalHistory(id, signalB, HISTORY_HOURS);
  const options = useMemo(
    () => (signalsQuery.data ?? []).map((name) => ({ value: name, label: name })),
    [signalsQuery.data],
  );
  const result = useMemo(
    () => analyzeSignalMutualInformation(
      historyA.data?.data ?? [],
      historyB.data?.data ?? [],
    ),
    [historyA.data, historyB.data],
  );
  const contributionData = useMemo(
    () => [...(result?.cells ?? [])]
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 12)
      .map((cell) => ({
        cell: t('signalMutualInformation.heatmap.pair', 'A{{a}} / B{{b}}', { a: cell.aBin + 1, b: cell.bBin + 1 }),
        contribution: cell.contribution,
        count: cell.count,
      })),
    [result, t],
  );
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('signalMutualInformation.title', 'Signal Mutual Information')} />;
  }
  const bothChosen = signalA !== '' && signalB !== '';
  const isLoading = signalsQuery.isLoading ||
    (bothChosen && (historyA.isLoading || historyB.isLoading));
  const isError = signalsQuery.isError || historyA.isError || historyB.isError;
  const error = signalsQuery.error ?? historyA.error ?? historyB.error;
  const maxContribution = Math.max(
    0,
    ...(result?.cells ?? []).map((cell) => Math.abs(cell.contribution)),
  );
  return (
    <PageContainer
      title={t('signalMutualInformation.title', 'Signal Mutual Information')}
      subtitle={t(
        'signalMutualInformation.subtitle',
        'Detect nonlinear dependence between quantile states after robust cadence alignment — not linear signal correlation',
      )}
      actions={<VehicleSelect />}
      query={[signalsQuery, historyA, historyB]}
    >
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Network className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalMutualInformation.selection.title', 'Signals to Compare')}
          </PanelTitle>
          {signalsQuery.isError ? (
            <QueryError error={signalsQuery.error} onRetry={() => signalsQuery.refetch()} />
          ) : signalsQuery.isLoading ? (
            <Skeleton height={96} />
          ) : options.length === 0 ? (
            <EmptyState /* no-action: the signal catalog populates automatically from ingested telemetry. */
              icon={<RadioTower className="h-8 w-8" />}
              message={t(
                'signalMutualInformation.selection.empty',
                'No telemetry signals have been recorded for this vehicle yet.',
              )}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label={t('signalMutualInformation.selection.signalA', 'Signal A')}
                value={signalA}
                options={options}
                onChange={(event) => setSignalA(event.target.value)}
                placeholder={t('signalMutualInformation.selection.placeholder', 'Choose a signal')}
              />
              <Select
                label={t('signalMutualInformation.selection.signalB', 'Signal B')}
                value={signalB}
                options={options}
                onChange={(event) => setSignalB(event.target.value)}
                placeholder={t('signalMutualInformation.selection.placeholder', 'Choose a signal')}
              />
              <Text as="p" variant="caption" className="sm:col-span-2">
                {t(
                  'signalMutualInformation.selection.hint',
                  'Canonical SI values are quantile-binned, so differing physical scales do not need display-unit conversion.',
                )}
              </Text>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
      <FadeIn delay={0.1}>
        <section
          aria-label={t('signalMutualInformation.kpis.label', 'Mutual information metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError
                error={error}
                onRetry={() => {
                  void signalsQuery.refetch();
                  void historyA.refetch();
                  void historyB.refetch();
                }}
              />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('signalMutualInformation.kpis.samples', 'Aligned Samples')}
                value={result != null ? fmtNumber(result.alignedCount, 0) : '—'}
                subtitle={t('signalMutualInformation.kpis.cadence', '{{seconds}} s robust cadence', {
                  seconds: result != null ? fmtNumber(result.cadenceMs / 1_000, 1) : '—',
                })}
                icon={<Boxes className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('signalMutualInformation.kpis.mi', 'Mutual Information')}
                value={result != null ? fmtNumber(result.mutualInformation, 3) : '—'}
                subtitle={t('signalMutualInformation.kpis.bits', 'bits of shared state information')}
                icon={<Grid3X3 className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('signalMutualInformation.kpis.normalized', 'Normalized MI')}
                value={result != null
                  ? fmtPercent(result.normalizedMutualInformation * 100, 1)
                  : '—'}
                subtitle={t('signalMutualInformation.kpis.range', '0% independent · 100% determined')}
                icon={<Network className="h-5 w-5" />}
                color="blue"
              />
              <MetricCard
                label={t('signalMutualInformation.kpis.signal', 'Permutation Test')}
                value={result == null
                  ? '—'
                  : result.significant
                    ? t('signalMutualInformation.kpis.detected', 'Detected')
                    : t('signalMutualInformation.kpis.null', 'Null-like')}
                subtitle={t('signalMutualInformation.kpis.threshold', '95% null threshold {{value}}', {
                  value: result != null ? fmtNumber(result.nullThreshold, 3) : '—',
                })}
                icon={<Shuffle className="h-5 w-5" />}
                color={result?.significant ? 'green' : 'amber'}
              />
            </>
          )}
        </section>
      </FadeIn>
      <FadeIn delay={0.2}>
        {isError ? (
          <GlassPanel className="p-4 sm:p-5">
            <QueryError error={error} onRetry={() => historyA.refetch()} />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('signalMutualInformation.contributions.title', 'Top Joint-State Contributions')}
            subtitle={t(
              'signalMutualInformation.contributions.subtitle',
              'Positive cells occur more often together than their marginal frequencies predict',
            )}
            ariaLabel={t(
              'signalMutualInformation.contributions.aria',
              'Bar chart of quantile-pair contributions to mutual information',
            )}
            loading={isLoading}
            empty={contributionData.length === 0}
            height={320}
            data={contributionData}
            dataColumns={[
              { key: 'cell', label: t('signalMutualInformation.columns.cell', 'Quantile pair') },
              { key: 'contribution', label: t('signalMutualInformation.columns.contribution', 'Contribution (bits)') },
              { key: 'count', label: t('signalMutualInformation.columns.count', 'Aligned samples') },
            ]}
          >
            {/* Single contribution series; there is no second metric to toggle. */}
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={contributionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="cell" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="contribution"
                  name={t('signalMutualInformation.columns.contribution', 'Contribution (bits)')}
                  fill={chartTokens.series[0]}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Grid3X3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalMutualInformation.heatmap.title', 'Contribution Heatmap')}
          </PanelTitle>
          {result == null ? (
            <EmptyState /* no-action: the two signal selectors above are the relevant next action. */
              icon={<Grid3X3 className="h-8 w-8" />}
              message={bothChosen
                ? t('signalMutualInformation.heatmap.noOverlap', 'At least 20 aligned numeric samples are required.')
                : t('signalMutualInformation.heatmap.empty', 'Choose two signals to build the joint-state heatmap.')}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {result.cells.map((cell) => (
                <div
                  key={`${cell.aBin}-${cell.bBin}`}
                  className={cn(
                    'rounded-lg border border-[var(--border-subtle)] p-2',
                    heatClass(cell.contribution, maxContribution),
                  )}
                  aria-label={t(
                    'signalMutualInformation.heatmap.cellAria',
                    'Signal A bin {{a}}, signal B bin {{b}}, {{count}} samples, {{bits}} bits',
                    {
                      a: cell.aBin + 1,
                      b: cell.bBin + 1,
                      count: cell.count,
                      bits: fmtNumber(cell.contribution, 3),
                    },
                  )}
                >
                  <Text as="p" variant="bodySm" className="font-medium">
                    {t('signalMutualInformation.heatmap.cell', 'A{{a}} · B{{b}}', {
                      a: cell.aBin + 1,
                      b: cell.bBin + 1,
                    })}
                  </Text>
                  <Text as="p" variant="caption">
                    {t('signalMutualInformation.heatmap.value', '{{count}} samples · {{bits}} bits', {
                      count: cell.count,
                      bits: fmtNumber(cell.contribution, 3),
                    })}
                  </Text>
                  {cell.count > 0 ? (
                    <Badge variant="info" size="sm" className="mt-1">
                      {fmtPercent(cell.probability * 100, 1)}
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
