import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BrainCircuit, MapPin, Network, Sparkles } from 'lucide-react';

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
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { chartTokens } from '@/lib/tokens';

import { buildDestinationTransitions } from '../lib/destinationTransitions';

export default function DestinationTransitionsPage() {
  const { t } = useTranslation();
  usePageTitle(t('destinationTransitions.title', 'Destination Transitions'));
  const { vehicleId } = useSelectedVehicle();
  const drivesQuery = useDriveHistory(vehicleId != null ? String(vehicleId) : undefined);
  const model = useMemo(
    () => buildDestinationTransitions(drivesQuery.data ?? []),
    [drivesQuery.data],
  );
  const chartData = useMemo(
    () => model.states.slice(0, 12).map((state) => ({
      destination: state.label,
      share: Math.round(state.visitShare * 1000) / 10,
    })),
    [model.states],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('destinationTransitions.title', 'Destination Transitions')} />;
  }
  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('destinationTransitions.title', 'Destination Transitions')}
      subtitle={t('destinationTransitions.subtitle', 'A first-order model of where one destination tends to lead next')}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <section
          aria-label={t('destinationTransitions.kpis', 'Destination transition summary metrics')}
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
                label={t('destinationTransitions.destinations', 'Destinations')}
                value={model.states.length}
                subtitle={t('destinationTransitions.visits', '{{count}} visits modeled', { count: model.visits })}
                icon={<MapPin className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('destinationTransitions.transitions', 'Transitions')}
                value={model.transitions}
                subtitle={t('destinationTransitions.chronological', 'chronological destination pairs')}
                icon={<Network className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('destinationTransitions.entropy', 'Entropy Rate')}
                value={model.entropyRateBits != null ? model.entropyRateBits.toFixed(2) : '—'}
                subtitle={t('destinationTransitions.bits', 'bits per transition')}
                icon={<BrainCircuit className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('destinationTransitions.predictability', 'Predictability')}
                value={model.predictability != null ? `${Math.round(model.predictability * 100)}%` : '—'}
                subtitle={model.prediction
                  ? t('destinationTransitions.next', 'next: {{place}}', { place: model.prediction.toLabel })
                  : t('destinationTransitions.noPrediction', 'no next-state evidence')}
                icon={<Sparkles className="h-5 w-5" />}
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
        ) : !isLoading && chartData.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: destination states appear as drives with end locations sync. */
              icon={<MapPin className="h-8 w-8" />}
              message={t('destinationTransitions.noStates', 'No drives with a usable end destination were found.')}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('destinationTransitions.stateShare', 'Destination Visit Share')}
            subtitle={t('destinationTransitions.stateShareHint', 'Share of modeled arrivals ending at each state')}
            ariaLabel={t('destinationTransitions.stateShareAria', 'Visit share for the most common normalized destinations')}
            loading={isLoading}
            empty={chartData.length === 0}
            height={330}
            data={chartData}
            dataColumns={[
              { key: 'destination', label: t('destinationTransitions.colDestination', 'Destination') },
              { key: 'share', label: t('destinationTransitions.colShare', 'Visit share (%)') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="destination" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval={0} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit="%" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="share" name={t('destinationTransitions.visitShare', 'Visit share')} fill={chartTokens.series[0]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('destinationTransitions.surprises', 'Surprising Transitions')}
          </PanelTitle>
          {isError ? (
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={160} />
          ) : model.transitions === 0 ? (
            <EmptyState /* no-action: transitions require two consecutive drives with known destinations. */
              icon={<Network className="h-8 w-8" />}
              message={t('destinationTransitions.noTransitions', 'No consecutive destination pairs are available yet.')}
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {model.surprisingTransitions.slice(0, 6).map((edge) => (
                <div key={`${edge.fromKey}-${edge.toKey}`} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <Text as="p" variant="bodySm">
                    {t('destinationTransitions.edge', '{{from}} → {{to}}', {
                      from: edge.fromLabel,
                      to: edge.toLabel,
                    })}
                  </Text>
                  <Text as="p" variant="caption">
                    {t('destinationTransitions.edgeDetail', '{{probability}}% conditional probability · {{surprise}} bits surprise', {
                      probability: Math.round(edge.probability * 100),
                      surprise: edge.surpriseBits.toFixed(1),
                    })}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
