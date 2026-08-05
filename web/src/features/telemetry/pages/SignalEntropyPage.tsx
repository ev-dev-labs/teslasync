import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Binary, Gauge, Repeat, Waypoints } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, Select, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useSignals, useSignalAnalysisHistory } from '@/api/hooks/useTelemetry';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

import { summarizeSignalEntropy } from '../lib/signalEntropy';

const HOURS = 48;

export default function SignalEntropyPage() {
  const { t } = useTranslation();
  usePageTitle(t('signalEntropy.title', 'Signal Entropy'));

  const { vehicleId } = useSelectedVehicle();
  const id = vehicleId ?? 0;

  const [signalName, setSignalName] = useState('');

  const signalsQuery = useSignals(id);
  const historyQuery = useSignalAnalysisHistory(id, signalName, HOURS);

  const options = useMemo(
    () => (signalsQuery.data ?? []).map((name) => ({ value: name, label: name })),
    [signalsQuery.data],
  );

  const summary = useMemo(
    () => summarizeSignalEntropy(historyQuery.data?.data ?? []),
    [historyQuery.data],
  );

  const rollingSeries = useMemo(
    () =>
      summary.rolling.map((p) => ({
        time: new Date(p.ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        bits: p.bits,
      })),
    [summary.rolling],
  );

  const binSeries = useMemo(
    () =>
      summary.bins.map((b, i) => ({
        bin: `${fmtNumber(b.lo, 1)}–${fmtNumber(b.hi, 1)}`,
        key: i,
        count: b.count,
      })),
    [summary.bins],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('signalEntropy.title', 'Signal Entropy')} />;
  }

  const chosen = signalName !== '';
  const isLoading = signalsQuery.isLoading || (chosen && historyQuery.isLoading);
  const isError = signalsQuery.isError || historyQuery.isError;
  const error = signalsQuery.error ?? historyQuery.error;
  const hasData = chosen && summary.samples > 0;

  return (
    <PageContainer
      title={t('signalEntropy.title', 'Signal Entropy')}
      subtitle={t(
        'signalEntropy.subtitle',
        'Quantile-bins a numeric signal and measures how much genuine information it carries, in bits — distinct from gap detection or cross-signal correlation',
      )}
      query={signalsQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — Signal picker */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Binary className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalEntropy.pick', 'Choose a Signal')}
            <HelpTooltip
              size="sm"
              i18nKey="help.signalEntropy.pick"
              defaultValue="Quantile (equal-frequency) binning is used instead of fixed-width bins, so a signal that spends most of its time in a narrow band and rarely spikes still gets a fair, distribution-agnostic entropy estimate."
              ariaLabel={t('help.signalEntropy.iconLabel', 'More info about signal selection')}
            />
          </PanelTitle>
          {signalsQuery.isError ? (
            <QueryError error={signalsQuery.error} onRetry={() => signalsQuery.refetch()} />
          ) : signalsQuery.isLoading ? (
            <Skeleton height={80} />
          ) : options.length === 0 ? (
            <EmptyState /* no-action: signals appear as the telemetry stream reports them. */
              icon={<Waypoints className="h-8 w-8" />}
              message={t('signalEntropy.noSignals', 'No telemetry signals have been recorded for this vehicle yet.')}
            />
          ) : (
            <Select
              label={t('signalEntropy.signal', 'Signal')}
              options={options}
              value={signalName}
              onChange={(e) => setSignalName(e.target.value)}
              placeholder={t('signalEntropy.choose', 'Choose a signal')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* 2 — KPI band */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('signalEntropy.kpis', 'Entropy metrics')}
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
                label={t('signalEntropy.entropy', 'Shannon Entropy')}
                value={hasData ? `${fmtNumber(summary.entropyBits, 2)} bits` : '—'}
                subtitle={t('signalEntropy.normalized', '{{n}} normalized', { n: hasData ? fmtPercent(summary.normalizedEntropy * 100, 0) : '—' })}
                icon={<Binary className="h-5 w-5" />}
                color={hasData && summary.normalizedEntropy >= 0.6 ? 'green' : 'cyan'}
                help={{
                  i18nKey: 'help.signalEntropy.entropy',
                  defaultValue: 'How surprised you should be by the next sample given everything seen so far. Normalized entropy divides by the ceiling for however many bins were actually populated, so a signal using 2 of 8 requested bins is judged against a 2-state ceiling, not an 8-state one it never approached.',
                }}
              />
              <MetricCard
                label={t('signalEntropy.effectiveStates', 'Effective States')}
                value={hasData ? fmtNumber(summary.effectiveStates, 2) : '—'}
                subtitle={t('signalEntropy.effectiveBins', '{{n}} of {{r}} bins populated', { n: summary.effectiveBins, r: summary.requestedBins })}
                icon={<Gauge className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('signalEntropy.stuck', 'Dominant-State Fraction')}
                value={hasData ? fmtPercent(summary.dominantBinFraction * 100, 0) : '—'}
                subtitle={t('signalEntropy.stuckHint', 'occupancy of the single most common bin')}
                icon={<Repeat className="h-5 w-5" />}
                color={hasData && summary.dominantBinFraction >= 0.9 ? 'amber' : 'blue'}
              />
              <MetricCard
                label={t('signalEntropy.changeRate', 'Change Rate')}
                value={hasData ? fmtPercent(summary.changeRate * 100, 0) : '—'}
                subtitle={t('signalEntropy.changeRateHint', '{{n}} samples analyzed', { n: summary.samples })}
                icon={<Waypoints className="h-5 w-5" />}
                color="cyan"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 3 — Rolling information density */}
      <FadeIn delay={0.2}>
        {!isLoading && !isError && rollingSeries.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: the rolling series appears once enough samples exist for at least one window. */
              icon={<Binary className="h-8 w-8" />}
              message={
                chosen
                  ? t('signalEntropy.notEnough', 'Not enough samples yet for a rolling entropy window on this signal.')
                  : t('signalEntropy.pickOne', 'Choose a signal above to compute its entropy.')
              }
            />
          </GlassPanel>
        ) : (
          // chart-legend-audit:skip single series (one rolling-entropy line, no sibling series to toggle)
          <ChartContainer
            title={t('signalEntropy.rolling', 'Rolling Information Density')}
            subtitle={t('signalEntropy.rollingHint', 'Entropy recomputed over a sliding window using the same global bin edges, so spikes reflect genuinely eventful stretches')}
            ariaLabel={t('signalEntropy.rollingAria', 'Line chart of rolling Shannon entropy in bits over time for the selected signal')}
            loading={isLoading}
            empty={rollingSeries.length === 0}
            height={300}
            data={rollingSeries}
            dataColumns={[
              { key: 'time', label: t('signalEntropy.col.time', 'Time') },
              { key: 'bits', label: t('signalEntropy.col.bits', 'Entropy (bits)') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rollingSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit=" bits" />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="bits" name={t('signalEntropy.col.bits', 'Entropy (bits)')} stroke={chartTokens.series[0]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 4 — Bin distribution */}
      <FadeIn delay={0.3}>
        {/* chart-legend-audit:skip single series (one bar series across bin categories, not stacked/grouped series) */}
        <ChartContainer
          title={t('signalEntropy.distribution', 'Quantile Bin Distribution')}
          subtitle={t('signalEntropy.distributionHint', 'Sample counts per equal-frequency bin — a lopsided distribution here explains a low entropy score')}
          ariaLabel={t('signalEntropy.distributionAria', 'Bar chart of sample counts across quantile bins for the selected signal')}
          loading={isLoading}
          empty={binSeries.length === 0}
          height={260}
          data={binSeries}
          dataColumns={[
            { key: 'bin', label: t('signalEntropy.col.bin', 'Bin range') },
            { key: 'count', label: t('signalEntropy.col.count', 'Samples') },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={binSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="bin" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={20} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('signalEntropy.col.count', 'Samples')} fill={chartTokens.series[1]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </FadeIn>

      {/* 5 — Reading the result */}
      <FadeIn delay={0.4}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Repeat className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalEntropy.reading', 'Reading the Result')}
          </PanelTitle>
          {!hasData ? (
            <EmptyState /* no-action: the interpretation follows from the entropy computed above. */
              icon={<Binary className="h-8 w-8" />}
              message={t('signalEntropy.noReading', 'Pick a signal to see how its entropy should be read.')}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant={summary.dominantBinFraction >= 0.9 ? 'warning' : 'success'}>
                    {summary.dominantBinFraction >= 0.9
                      ? t('signalEntropy.parked', 'Mostly parked')
                      : t('signalEntropy.active', 'Informative')}
                  </Badge>
                </div>
                <Text variant="body">
                  {summary.dominantBinFraction >= 0.9
                    ? t('signalEntropy.parkedText', 'This signal spends almost all of its time in a single quantile bin — most samples are telling you the same thing over and over.')
                    : t('signalEntropy.activeText', 'This signal spreads its samples across multiple bins, so each new reading is genuinely informative rather than decoration on a fixed state.')}
                </Text>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant="info">{t('signalEntropy.range', 'Observed range')}</Badge>
                </div>
                <Text variant="body">
                  {t('signalEntropy.rangeText', '{{min}} to {{max}} across {{n}} samples in the last {{h}}h window', {
                    min: fmtNumber(summary.minValue ?? 0, 2),
                    max: fmtNumber(summary.maxValue ?? 0, 2),
                    n: summary.samples,
                    h: HOURS,
                  })}
                </Text>
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
