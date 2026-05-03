import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { StatCard, KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useTrip } from '@/api/hooks/useTrips';
import { useSettings } from '@/hooks/useSettings';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

export default function TripDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { data: trip, isLoading, error } = useTrip(id!);
  const { convertDistance, convertEfficiency, distanceUnit, efficiencyUnit } = useSettings();

  const whPerKm = trip && trip.total_distance_km > 0
    ? (trip.total_energy_kwh / trip.total_distance_km) * 1000
    : 0;

  return (
    <PageContainer
      title={t('trips.detail.title', 'Trip Detail')}
      subtitle={trip ? (trip.name ?? `Trip #${trip.id}`) : undefined}
      loading={isLoading}
      error={error instanceof Error ? error : null}
      breadcrumbLabels={{
        '/trips/:id': trip ? (trip.name ?? `Trip #${trip.id}`) : `Trip #${id}`,
      }}
    >
      {trip ? (
        <>
          <Grid cols={{ default: 2, lg: 4 }} gap={4}>
            <StatCard
              label={t('trips.detail.distance', 'Distance')}
              value={fmtInt(convertDistance(trip.total_distance_km))}
              unit={distanceUnit}
            />
            <StatCard
              label={t('trips.detail.energy', 'Energy Used')}
              value={fmtNumber(trip.total_energy_kwh)}
              unit="kWh"
            />
            <StatCard
              label={t('trips.detail.efficiency', 'Efficiency')}
              value={fmtInt(convertEfficiency(whPerKm))}
              unit={efficiencyUnit}
            />
            <StatCard
              label={t('trips.detail.cost', 'Cost')}
              value={`$${fmtNumber(trip.total_cost)}`}
            />
          </Grid>

          <GlassPanel className="mt-6 p-4 sm:p-6">
            <KVList items={[
              { label: t('trips.detail.tripId', 'Trip ID'), value: String(trip.id) },
              { label: t('trips.detail.name', 'Name'), value: trip.name ?? '—' },
              { label: t('trips.detail.started', 'Started'), value: formatDate(trip.start_date) },
              { label: t('trips.detail.ended', 'Ended'), value: trip.end_date ? formatDate(trip.end_date) : '—' },
              { label: t('trips.detail.drives', 'Drives'), value: String(trip.drive_count) },
              { label: t('trips.detail.charges', 'Charges'), value: String(trip.charge_count) },
            ]} />
          </GlassPanel>
        </>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('trips.detail.notFound', 'Trip not found')} />
      )}
    </PageContainer>
  );
}
