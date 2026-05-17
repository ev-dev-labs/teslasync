import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { StatCard, KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { AIAutoTripNameSuggestion } from '@/components/ai/AIAutoTripNameSuggestion';
import { useTrip } from '@/api/hooks/useTrips';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

// Phase-43/0025 + 0026: Wh/km -> Wh/(display unit) conversion uses an
// inline factor because @/lib/unitConversion does not yet expose a
// convertEfficiencyFromSI helper. Same precedent as
// FleetComparePage.whPerKmToDisplay.
const KM_PER_MILE = 1.609344;

export default function TripDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { data: trip, isLoading, error } = useTrip(id!);
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  // useSettings retained for the legacy efficiencyUnit label string only;
  // the numeric conversion runs through KM_PER_MILE per the locked-policy
  // continuation from Phase-43/0025.

  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const whPerKm = trip && trip.total_distance_m > 0
    ? (trip.total_energy_wh / (trip.total_distance_m / 1000))
    : 0;
  const efficiencyDisplay = unitPrefs.distance === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;

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
          <AIAutoTripNameSuggestion tripId={id} />

          <Grid cols={{ default: 2, lg: 4 }} gap={4}>
            <StatCard
              label={t('trips.detail.distance', 'Distance')}
              value={fmtInt(convertDistanceFromSI(trip.total_distance_m, unitPrefs.distance))}
              unit={unitPrefs.distance}
            />
            <StatCard
              label={t('trips.detail.energy', 'Energy Used')}
              value={fmtNumber(trip.total_energy_wh)}
              unit="Wh"
            />
            <StatCard
              label={t('trips.detail.efficiency', 'Efficiency')}
              value={fmtInt(efficiencyDisplay)}
              unit={efficiencyUnit}
            />
            <StatCard
              label={t('trips.detail.cost', 'Cost')}
              value={formatCurrency(trip.total_cost)}
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
