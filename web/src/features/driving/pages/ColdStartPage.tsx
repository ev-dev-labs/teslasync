import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Snowflake, Flame, TrendingUp, Percent } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, HelpTooltip } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard, MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { summarizeColdStarts, COLD_GAP_HOURS } from '../lib/coldStart';

/** km per statute mile, derived from the shared conversion lib. */
const KM_PER_MILE = convertDistanceToSI(1, 'mi') / 1000;

export default function ColdStartPage() {
  const { t } = useTranslation();
  usePageTitle(t('coldStart.title', 'Cold Start Cost'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatEnergy, unitPrefs } = useUnits();
  const { formatCurrency, costPerKwh } = useFormatting();

  const { start, end, setRange } = useRangeState({
    persistKey: 'cold-start.range',
    defaultPresetId: 'all',
  });

  const drivesQuery = useDrives(vehicleIdStr);
  const allDrives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const drives = useMemo<Drive[]>(() => {
    if (!allDrives.length) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  const summary = useMemo(() => summarizeColdStarts(drives), [drives]);

  const isMiles = unitPrefs.distance === 'mi';
  const effUnit = isMiles ? t('coldStart.whPerMi', 'Wh/mi') : t('coldStart.whPerKm', 'Wh/km');
  const toEff = (whPerKm: number) => Math.round(isMiles ? whPerKm * KM_PER_MILE : whPerKm);

  const penaltyCost =
    summary.totalPenaltyWh != null && costPerKwh > 0
      ? (summary.totalPenaltyWh / 1000) * costPerKwh
      : null;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('coldStart.title', 'Cold Start Cost')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;
  const maxEff = Math.max(summary.cold.whPerKm ?? 0, summary.warm.whPerKm ?? 0, 1);

  return (
    <PageContainer
      title={t('coldStart.title', 'Cold Start Cost')}
      subtitle={t('coldStart.subtitle', 'What the first kilometres after a long park really cost')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="cold-start-range"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('coldStart.kpis', 'Cold start summary metrics')}
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
                label={t('coldStart.penalty', 'Cold Penalty')}
                value={summary.penaltyWhPerKm != null ? `${toEff(summary.penaltyWhPerKm)} ${effUnit}` : '—'}
                subtitle={
                  summary.penaltyShare != null
                    ? t('coldStart.penaltyShare', '+{{pct}}% vs warm starts', { pct: Math.round(summary.penaltyShare * 100) })
                    : undefined
                }
                icon={<Snowflake className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('coldStart.totalEnergy', 'Extra Energy')}
                value={summary.totalPenaltyWh != null ? formatEnergy(summary.totalPenaltyWh, { precision: 1 }) : '—'}
                subtitle={penaltyCost != null ? formatCurrency(penaltyCost) : undefined}
                icon={<TrendingUp className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('coldStart.coldShare', 'Cold Starts')}
                value={summary.coldShare != null ? `${Math.round(summary.coldShare * 100)}%` : '—'}
                subtitle={t('coldStart.gapDef', 'parked {{h}}h or more', { h: COLD_GAP_HOURS })}
                icon={<Percent className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('coldStart.analyzed', 'Analyzed')}
                value={summary.analyzed}
                subtitle={t('coldStart.driveCount', 'drives with a known gap')}
                icon={<Flame className="h-5 w-5" />}
                color="green"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Cold vs warm */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-4 flex items-center gap-2">
            <Snowflake className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('coldStart.duel', 'Cold vs Warm Starts')}
            <HelpTooltip
              size="sm"
              i18nKey="help.coldStart.body"
              defaultValue="A drive is a cold start when the car sat parked for 6+ hours first, and a warm start when the gap was under an hour. Comparing distance-weighted consumption between the groups isolates the battery- and cabin-warm-up penalty; in-between gaps are excluded as ambiguous."
              ariaLabel={t('help.coldStart.iconLabel', 'More info about cold start math')}
            />
          </PanelTitle>
          {isError ? (
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={160} />
          ) : summary.penaltyWhPerKm == null ? (
            <EmptyState /* no-action: needs 5+ drives in BOTH the cold and warm groups; the range picker above is the recovery surface. */
              icon={<Snowflake className="h-8 w-8" />}
              message={t('coldStart.noData', 'Not enough cold and warm starts in this period to compare fairly (5+ of each needed).')}
            />
          ) : (
            <div className="space-y-4">
              <MetricBar
                label={t('coldStart.coldGroup', 'Cold starts ({{count}} drives)', { count: summary.cold.drives })}
                value={summary.cold.whPerKm ?? 0}
                max={maxEff}
                color={chartTokens.series[5]}
                sublabel={`${toEff(summary.cold.whPerKm ?? 0)} ${effUnit}`}
              />
              <MetricBar
                label={t('coldStart.warmGroup', 'Warm starts ({{count}} drives)', { count: summary.warm.drives })}
                value={summary.warm.whPerKm ?? 0}
                max={maxEff}
                color={chartTokens.series[1]}
                sublabel={`${toEff(summary.warm.whPerKm ?? 0)} ${effUnit}`}
              />
              <Text variant="bodySm" as="p" className="pt-1">
                {penaltyCost != null
                  ? t(
                      'coldStart.takeawayCost',
                      'Warm-up overhead added {{energy}} across this period — about {{cost}} at your electricity rate. Preconditioning while plugged in shifts that energy to the wall.',
                      {
                        energy: formatEnergy(summary.totalPenaltyWh ?? 0, { precision: 1 }),
                        cost: formatCurrency(penaltyCost),
                      },
                    )
                  : t(
                      'coldStart.takeaway',
                      'Warm-up overhead added {{energy}} across this period. Preconditioning while plugged in shifts that energy to the wall.',
                      { energy: formatEnergy(summary.totalPenaltyWh ?? 0, { precision: 1 }) },
                    )}
              </Text>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
