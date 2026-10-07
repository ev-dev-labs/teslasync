import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dices, BatteryMedium, Gauge, ShieldCheck } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Slider, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  BarChart, Bar, Cell, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
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

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('rangeSim.title', 'Range Simulator')}
      subtitle={t('rangeSim.subtitle', 'Monte Carlo trip odds from your own driving history')}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('rangeSim.kpis', 'Simulation summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('rangeSim.odds', 'Arrival Odds')}
                value={successPct != null ? `${successPct}%` : '—'}
                subtitle={t('rangeSim.oddsHint', 'arrive with ≥{{pct}}% battery', { pct: SIM_RESERVE_PCT })}
                icon={<ShieldCheck className="h-5 w-5" />}
                color={successPct == null ? 'cyan' : successPct >= 95 ? 'green' : successPct >= 70 ? 'amber' : 'red'}
              />
              <MetricCard
                label={t('rangeSim.median', 'Median Arrival')}
                value={result.p50 != null ? `${result.p50}%` : '—'}
                subtitle={
                  result.p10 != null && result.p90 != null
                    ? t('rangeSim.band', 'P10 {{p10}}% · P90 {{p90}}%', { p10: result.p10, p90: result.p90 })
                    : undefined
                }
                icon={<BatteryMedium className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('rangeSim.pack', 'Self-Measured Pack')}
                value={result.packWhEstimate != null ? formatEnergy(result.packWhEstimate, { precision: 1 }) : '—'}
                subtitle={t('rangeSim.packHint', 'median implied usable capacity')}
                icon={<Gauge className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('rangeSim.trials', 'Simulated Trips')}
                value={result.p50 != null ? result.trials : '—'}
                subtitle={t('rangeSim.fromDrives', 'from {{count}} real drives', { count: result.sampleSize })}
                icon={<Dices className="h-5 w-5" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Knobs (1/3) + arrival distribution (2/3) */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Dices className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('rangeSim.plan', 'Trip Plan')}
              <HelpTooltip
                size="sm"
                i18nKey="help.rangeSimulator.body"
                defaultValue="Each of 2,000 simulated trips assembles your route from randomly drawn real drives (weighted by distance) and spends their actual consumption against a pack size self-measured from your own SoC data. The result is a distribution, not a guess."
                ariaLabel={t('help.rangeSimulator.iconLabel', 'More info about the simulation')}
              />
            </PanelTitle>

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
                        dist: formatDistance(tripKm * 1000, { precision: 0 }),
                        soc: startSoc,
                        p50: result.p50,
                        odds: successPct,
                        reserve: SIM_RESERVE_PCT,
                      },
                    )
                  : t('rangeSim.needHistory', 'The simulator needs 8+ drives with energy data plus SoC history to calibrate your pack.')}
              </Text>
            </div>
          </GlassPanel>

          {!isLoading && !isError && result.p50 == null ? (
            <GlassPanel className="flex items-center justify-center p-4 sm:p-5 xl:col-span-2">
              <EmptyState /* no-action: fills in automatically once enough drive+SoC history exists to calibrate. */
                icon={<Dices className="h-8 w-8" />}
                message={t('rangeSim.noData', 'Not enough history yet — the simulator calibrates itself from your drives.')}
              />
            </GlassPanel>
          ) : (
            <ChartContainer
              className="xl:col-span-2"
              title={t('rangeSim.histogram', 'Arrival Battery Distribution')}
              subtitle={t('rangeSim.histogramHint', '2,000 simulated arrivals; the dashed line is the {{pct}}% reserve', { pct: SIM_RESERVE_PCT })}
              ariaLabel={t('rangeSim.histogram.aria', 'Histogram of simulated arrival battery percentages for the planned trip')}
              loading={isLoading}
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
            </ChartContainer>
          )}
        </section>
      </FadeIn>
    </PageContainer>
  );
}
