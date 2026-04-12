import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useTrips } from '@/api/hooks/useTrips';
import { tripStates } from '@/lib/fsm';
import type { Trip } from '@/types/trip';

export default function TripListPage() {
  const { data: trips, isLoading, error } = useTrips();

  return (
    <PageContainer
      title="Trips"
      subtitle="All driving trips across your fleet"
      loading={isLoading}
      error={error as Error | null}
      empty={trips?.length === 0}
      emptyMessage="No trips recorded yet."
    >
      <div className="space-y-3">
        {trips?.map((trip: Trip) => (
          <TripRow key={trip.id} trip={trip} />
        ))}
      </div>
    </PageContainer>
  );
}

function TripRow({ trip }: { trip: Trip }) {
  const stateConfig = tripStates[trip.fsmState] ?? tripStates.started;

  return (
    <Card hover className="flex items-center justify-between">
      <div>
        <p className="font-medium">
          {trip.startAddress || 'Unknown'} → {trip.endAddress || 'Unknown'}
        </p>
        <p className="text-xs text-gray-500">
          {new Date(trip.startedAt).toLocaleDateString()}
        </p>
      </div>

      <div className="flex items-center gap-6 text-sm">
        <div className="text-right">
          <p className="font-medium">{trip.distanceMiles.toFixed(1)} mi</p>
          <p className="text-xs text-gray-500">{trip.efficiencyWhPerMile.toFixed(0)} Wh/mi</p>
        </div>
        <div className="text-right">
          <p className="font-medium">{trip.energyUsedKwh.toFixed(1)} kWh</p>
        </div>
        <Badge variant={stateConfig.variant}>{stateConfig.label}</Badge>
      </div>
    </Card>
  );
}
