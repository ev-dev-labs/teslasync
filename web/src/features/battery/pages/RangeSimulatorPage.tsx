import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dices } from 'lucide-react';

import { PageLayout, LayoutCard, ChartCard, CardGrid } from '@/components/layout';
import { Text, Slider, HelpTooltip, Badge } from '@/components/ui';
import { StatStrip, type StatMetric } from '@/components/data-display';
import { EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartTooltip,
  BarChart, Bar, Cell, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';

import { simulateTrip, SIM_RESERVE_PCT } from '../lib/rangeSimulator';

/** km per statute mile, derived from the shared conversion lib. */
const KM_PER_MILE = convertDistanceToSI(1, 'mi') / 1000;

export default function RangeSimulatorPage() {
  const { t } = useTranslation();
  usePageTitle(t('rangeSim.title', 'Range Simulator'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance, formatEnergy, unitPrefs } = useUnits();

  const drivesQuery = useDrives(vehicleIdStr);
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });

  const isMiles = unitPrefs.distance === 'mi';
  const distUnit = isMiles ? t('rangeSim.mi', 'mi') : t('rangeSim.km', 'km');

  // Trip knobs (display unit for distance; canonical km fed to the sim).
  const [tripDisplay, setTripDisplay] = useState(200);
  const [startSoc, setStartSoc] = useState(90);
  const tripKm = isMiles ? tripDisplay * KM_PER_MILE : tripDisplay;

  const result = useMemo(
    () => simulateTrip(drivesQuery.data ?? [], tripKm, startSoc, { seed: 1337, trials: 2000 }),
    [drivesQuery.data, tripKm, startSoc],
  );

  const histogramData = useMemo(
    () =>
      result.histogram
        .filter((b) => b.count > 0 || (b.fromPct >= 0 && b.fromPct < 60))
        .map((b) => ({
          range: b.fromPct < 0 ? t('rangeSim.stranded', 'empty') : `${b.fromPct}–${b.toPct}%`,
          fromPct: b.fromPct,
          count: b.count,
        })),
    [result.histogram, t],
  );

  const successPct = result.successProb != null ? Math.round(result.successProb * 100) : null;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('rangeSim.title', 'Range Simulator')} />;
  }

  const isLoading = !drivesState.hasData && drivesQuery.isLoading;
  const isError = drivesState.fatalError != null;
  const summaryMetrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'sim-arrival-odds',
      label: t('rangeSim.odds', 'Arrival Odds'),
      rawValue: successPct != null ? `${successPct}%` : null,
      context: <Badge variant={successPct == null ? 'neutral' : successPct >= 95 ? 'success' : successPct >= 70 ? 'warning' : 'danger'}>
        {t('rangeSim.oddsHint', 'arrive with ≥{{pct}}% battery', { pct: SIM_RESERVE_PCT })}
      </Badge>,
    },
    {
      metricId: 'text', occurrenceId: 'sim-median',
      label: t('rangeSim.median', 'Median Arrival'),
      rawValue: result.p50 != null ? `${result.p50}%` : null,
      context: result.p10 != null && result.p90 != null
        ? t('rangeSim.band', 'P10 {{p10}}% · P90 {{p90}}%', { p10: result.p10, p90: result.p90 })
        : undefined,
    },
    {
      metricId: 'text', occurrenceId: 'sim-pack',
      label: t('rangeSim.pack', 'Self-Measured Pack'),
      rawValue: result.packWhEstimate != null ? formatEnergy(result.packWhEstimate) : null,
      context: t('rangeSim.packHint', 'median implied usable capacity'),
    },
    {
      metricId: 'text', occurrenceId: 'sim-trials',
      label: t('rangeSim.trials', 'Simulated Trips'),
      rawValue: result.p50 != null ? String(result.trials) : null,
      context: t('rangeSim.fromDrives', 'from {{count}} real drives', { count: result.sampleSize }),
    },
  ];

  return (
    <PageLayout
      title={t('rangeSim.title', 'Range Simulator')}
      subtitle={t('rangeSim.subtitle', 'Monte Carlo trip odds from your own driving history')}
      query={drivesQuery}
    >
      <StaleRefreshWarning state={drivesState} label={t('rangeSim.title', 'Range Simulator')} />
      {/* 1 — KPI band */}
      <FadeIn>
        <section aria-label={t('rangeSim.kpis', 'Simulation summary metrics')}>
        <StatStrip title={t('rangeSim.kpis', 'Simulation summary metrics')}
          metrics={summaryMetrics} loading={isLoading} retained={drivesState.status === 'stale'}
          period={{ kind: 'unknown', label: t('rangeSim.subtitle', 'Monte Carlo trip odds from your own driving history'),
            reason: t('rangeSim.summaryScope', 'Simulation calibrated from returned drive history; no complete-history interval is supplied.') }} />
        {isError && <QueryError error={drivesState.fatalError} onRetry={() => drivesQuery.refetch()} />}
        </section>
      </FadeIn>

      {/* 2 — Knobs (1/3) + arrival distribution (2/3) */}
      <FadeIn delay={0.1}>
        <CardGrid label={t('rangeSim.plan', 'Trip Plan')} items={[
          { id: 'range-simulator-plan', size: 'third', content: (
          <LayoutCard title={t('rangeSim.plan', 'Trip Plan')} actions={
              <HelpTooltip
                size="sm"
                i18nKey="help.rangeSimulator.body"
                defaultValue="Each of 2,000 simulated trips assembles your route from randomly drawn real drives (weighted by distance) and spends their actual consumption against a pack size self-measured from your own SoC data. The result is a distribution, not a guess."
                ariaLabel={t('help.rangeSimulator.iconLabel', 'More info about the simulation')}
              />
            }>

            <div className="flex flex-col gap-6">
              <Slider
                label={t('rangeSim.tripDistance', 'Trip distance')}
                value={tripDisplay}
                min={20}
                max={isMiles ? 500 : 800}
                step={10}
                formatValue={(v) => `${v} ${distUnit}`}
                onChange={setTripDisplay}
              />
              <Slider
                label={t('rangeSim.startSoc', 'Starting battery')}
                value={startSoc}
                min={20}
                max={100}
                step={5}
                formatValue={(v) => `${v}%`}
                onChange={setStartSoc}
              />
              <Text variant="bodySm" as="p">
                {result.p50 != null
                  ? t(
                      'rangeSim.takeaway',
                      'A {{dist}} trip starting at {{soc}}% typically lands at {{p50}}% — and {{odds}}% of simulated runs keep at least the {{reserve}}% reserve.',
                      {
                        dist: formatDistance(tripKm * 1000),
                        soc: startSoc,
                        p50: result.p50,
                        odds: successPct,
                        reserve: SIM_RESERVE_PCT,
                      },
                    )
                  : t('rangeSim.needHistory', 'The simulator needs 8+ drives with energy data plus SoC history to calibrate your pack.')}
              </Text>
            </div>
          </LayoutCard>
          ) },

          { id: 'range-simulator-distribution', size: 'half', content: !isLoading && !isError && result.p50 == null ? (
            <LayoutCard title={t('rangeSim.histogram', 'Arrival Battery Distribution')}>
              <EmptyState /* no-action: fills in automatically once enough drive+SoC history exists to calibrate. */
                icon={<Dices className="h-8 w-8" />}
                message={t('rangeSim.noData', 'Not enough history yet — the simulator calibrates itself from your drives.')}
              />
            </LayoutCard>
          ) : (
            <ChartCard toolbar exportable size="standard"
              title={t('rangeSim.histogram', 'Arrival Battery Distribution')}
              subtitle={t('rangeSim.histogramHint', '2,000 simulated arrivals; the dashed line is the {{pct}}% reserve', { pct: SIM_RESERVE_PCT })}
              ariaLabel={t('rangeSim.histogram.aria', 'Histogram of simulated arrival battery percentages for the planned trip')}
              loading={isLoading}
              error={drivesState.fatalError}
              onRetry={() => { void drivesQuery.refetch(); }}
              empty={histogramData.length === 0}
              height={340}
              data={histogramData}
              dataColumns={[
                { key: 'range', label: t('rangeSim.col.range', 'Arrival range') },
                { key: 'count', label: t('rangeSim.col.trials', 'Trials') },
              ]}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogramData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval={0} angle={-40} textAnchor="end" height={54} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine
                    x={`${SIM_RESERVE_PCT}–${SIM_RESERVE_PCT + 5}%`}
                    stroke={chartTokens.series[2]}
                    strokeDasharray="6 4"
                    strokeOpacity={0.8}
                  />
                  <Bar dataKey="count" name={t('rangeSim.trialsName', 'Trials')} radius={[4, 4, 0, 0]}>
                    {histogramData.map((b) => (
                      <Cell
                        key={b.range}
                        fill={
                          b.fromPct < 0
                            ? chartTokens.series[3]
                            : b.fromPct < SIM_RESERVE_PCT
                              ? chartTokens.series[2]
                              : chartTokens.series[1]
                        }
                        fillOpacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          ) },
        ]} />
      </FadeIn>
    </PageLayout>
  );
}
