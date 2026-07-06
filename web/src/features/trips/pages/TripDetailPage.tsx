import { useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { AIAutoTripNameSuggestion } from '@/components/ai/AIAutoTripNameSuggestion';
import { useTrip } from '@/api/hooks/useTrips';
import { usePageTitle } from '@/hooks/usePageTitle';
import { TripKpiBand } from '@/features/trips/components/TripKpiBand';
import { TripDrivesChart } from '@/features/trips/components/TripDrivesChart';
import { TripOverviewPanel } from '@/features/trips/components/TripOverviewPanel';
import { TripDrivesTable } from '@/features/trips/components/TripDrivesTable';

export default function TripDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();

  const tripQuery = useTrip(id ?? '');
  const { data: trip, isLoading, isError, error, refetch } = tripQuery;
  const onRetry = useCallback(() => { void refetch(); }, [refetch]);

  const tripLabel = useMemo(
    () =>
      trip
        ? (trip.name ?? t('trips.detail.tripNumber', 'Trip #{{id}}', { id: trip.id }))
        : t('trips.detail.tripNumber', 'Trip #{{id}}', { id: id ?? '' }),
    [trip, id, t],
  );

  // Keep the browser tab title consistent with the on-page subtitle: an
  // unnamed but loaded trip identifies itself as "Trip #<id>" instead of the
  // generic page title, so multiple open trip tabs stay distinguishable.
  usePageTitle(trip ? tripLabel : t('trips.detail.title', 'Trip Detail'));

  const breadcrumbLabels = useMemo(
    () => ({ '/trips/:id': tripLabel }),
    [tripLabel],
  );

  return (
    <PageContainer
      title={t('trips.detail.title', 'Trip Detail')}
      subtitle={trip ? tripLabel : undefined}
      query={tripQuery}
      breadcrumbLabels={breadcrumbLabels}
    >
      <div className="space-y-6">
        <FadeIn>
          <AIAutoTripNameSuggestion tripId={id} />
        </FadeIn>

        <FadeIn delay={0.05}>
          <TripKpiBand trip={trip} isLoading={isLoading} />
        </FadeIn>

        <FadeIn delay={0.1}>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
            <div className="xl:col-span-2">
              <TripDrivesChart
                trip={trip}
                isLoading={isLoading}
                isError={isError}
                error={error}
                onRetry={onRetry}
              />
            </div>
            <TripOverviewPanel
              trip={trip}
              isLoading={isLoading}
              isError={isError}
              error={error}
              onRetry={onRetry}
            />
          </section>
        </FadeIn>

        <FadeIn delay={0.15}>
          <TripDrivesTable
            trip={trip}
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={onRetry}
          />
        </FadeIn>
      </div>
    </PageContainer>
  );
}
