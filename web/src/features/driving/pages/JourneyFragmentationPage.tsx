import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combine, Footprints, Route, Split, Timer } from 'lucide-react';

import { useDriveHistory } from '@/api/hooks/useDriving';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
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
import { useUnits } from '@/hooks/useUnits';
import { chartTokens } from '@/lib/tokens';

import { analyzeJourneyFragmentation } from '../lib/journeyFragmentation';

export default function JourneyFragmentationPage() {
  const { t } = useTranslation();
  usePageTitle(t('journeyFragmentation.title', 'Journey Fragmentation'));
  const { vehicleId } = useSelectedVehicle();
  const { formatDistance, formatEnergy } = useUnits();
  const [maxGapMin, setMaxGapMin] = useState(120);
  const drivesQuery = useDriveHistory(vehicleId != null ? String(vehicleId) : undefined);
  const result = useMemo(
    () => analyzeJourneyFragmentation(drivesQuery.data ?? [], { maxParkingGapMin: maxGapMin }),
    [drivesQuery.data, maxGapMin],
  );
  const distribution = useMemo(() => {
    const counts = new Map<number, number>();
    for (const journey of result.journeys) {
      const bucket = Math.min(journey.fragments, 5);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    return Array.from({ length: 5 }, (_, index) => {
      const fragments = index + 1;
      return {
        fragments: fragments === 5
          ? t('journeyFragmentation.fivePlus', '5+')
          : String(fragments),
        journeys: counts.get(fragments) ?? 0,
      };
    });
  }, [result.journeys, t]);
  const efficiency = (value: number | null) => value == null ? '—' : t(
    'journeyFragmentation.efficiencyValue',
    '{{energy}} / {{distance}}',
    {
      energy: formatEnergy(value, { precision: 2 }),
      distance: formatDistance(1000, { precision: 1 }),
    },
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('journeyFragmentation.title', 'Journey Fragmentation')} />;
  }
  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;
  const gapOptions = [30, 60, 120, 240].map((minutes) => ({
    value: String(minutes),
    label: t('journeyFragmentation.gapMinutes', '{{count}} min', { count: minutes }),
  }));

  return (
    <PageContainer
      title={t('journeyFragmentation.title', 'Journey Fragmentation')}
      subtitle={t('journeyFragmentation.subtitle', 'How recorded drives combine into stopover-linked journey chains')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <Select
            aria-label={t('journeyFragmentation.maxGap', 'Maximum parking gap')}
            value={String(maxGapMin)}
            options={gapOptions}
            size="sm"
            onChange={(event) => setMaxGapMin(Number(event.target.value))}
          />
        </div>
      }
    >
      <FadeIn>
        <section
          aria-label={t('journeyFragmentation.kpis', 'Journey fragmentation summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('journeyFragmentation.journeys', 'Journeys')}
                value={result.journeyCount}
                subtitle={t('journeyFragmentation.drivesAnalyzed', '{{count}} completed drives', { count: result.analyzedDrives })}
                icon={<Route className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('journeyFragmentation.fragments', 'Fragments per Journey')}
                value={result.fragmentsPerJourney != null ? result.fragmentsPerJourney.toFixed(1) : '—'}
                subtitle={t('journeyFragmentation.chainAverage', 'mean chain length')}
                icon={<Split className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('journeyFragmentation.fragmentedShare', 'Fragmented Share')}
                value={result.fragmentedShare != null ? `${Math.round(result.fragmentedShare * 100)}%` : '—'}
                subtitle={t('journeyFragmentation.multiDrive', 'journeys with multiple drives')}
                icon={<Footprints className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('journeyFragmentation.consolidatable', 'Compact Chains')}
                value={result.consolidatableChains}
                subtitle={t('journeyFragmentation.shortStops', '{{count}} short stopovers', { count: result.shortStopovers })}
                icon={<Combine className="h-5 w-5" />}
                color="green"
              />
            </>
          )}
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        {isError ? (
          <GlassPanel className="p-4 sm:p-5">
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          </GlassPanel>
        ) : !isLoading && result.journeyCount === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: journey chains require completed drives with valid start and end times. */
              icon={<Route className="h-8 w-8" />}
              message={t('journeyFragmentation.noJourneys', 'No completed drives can be chained into journeys yet.')}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('journeyFragmentation.distribution', 'Journey Chain Length')}
            subtitle={t('journeyFragmentation.distributionHint', 'Number of journeys by recorded drive fragments')}
            ariaLabel={t('journeyFragmentation.distributionAria', 'Distribution of journey chains by fragment count')}
            loading={isLoading}
            empty={result.journeyCount === 0}
            height={320}
            data={distribution}
            dataColumns={[
              { key: 'fragments', label: t('journeyFragmentation.colFragments', 'Fragments') },
              { key: 'journeys', label: t('journeyFragmentation.colJourneys', 'Journeys') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="fragments" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="journeys" name={t('journeyFragmentation.journeyCount', 'Journeys')} fill={chartTokens.series[0]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Timer className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('journeyFragmentation.indicators', 'Overhead Indicators')}
          </PanelTitle>
          {isError ? (
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={120} />
          ) : result.journeyCount === 0 ? (
            <EmptyState /* no-action: overhead indicators are derived from completed journey chains. */
              icon={<Timer className="h-8 w-8" />}
              message={t('journeyFragmentation.noIndicators', 'No journey structure is available for overhead indicators.')}
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <Text as="p" variant="label">{t('journeyFragmentation.shortDistance', 'Short-fragment distance')}</Text>
                  <Text as="p" variant="body">{formatDistance(result.shortFragmentDistanceM, { precision: 1 })}</Text>
                  <Text as="p" variant="caption">{result.shortFragmentDistanceShare != null ? `${Math.round(result.shortFragmentDistanceShare * 100)}%` : '—'}</Text>
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <Text as="p" variant="label">{t('journeyFragmentation.singleEfficiency', 'Single-drive intensity')}</Text>
                  <Text as="p" variant="body">{efficiency(result.singleJourneyWhPerKm)}</Text>
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <Text as="p" variant="label">{t('journeyFragmentation.energyDelta', 'Fragmented intensity delta')}</Text>
                  <Text as="p" variant="body">{efficiency(result.energyOverheadWhPerKm)}</Text>
                </div>
              </div>
              <Text as="p" variant="caption" className="mt-3">
                {t('journeyFragmentation.limits', 'Inference limit: compact chains and short-fragment distance are structural indicators only. Without alternate routing or trip intent, they do not prove that distance or energy was avoidable.')}
              </Text>
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
