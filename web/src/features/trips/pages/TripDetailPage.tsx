import { useParams } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useTrip } from '@/api/hooks/useTrips';
import { tripStates } from '@/lib/fsm';

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: trip, isLoading, error } = useTrip(id!);

  const stateConfig = tripStates[trip?.fsmState ?? 'started'] ?? tripStates.started;

  return (
    <PageContainer
      title="Trip Detail"
      subtitle={trip ? `${trip.startAddress || 'Start'} → ${trip.endAddress || 'End'}` : undefined}
      loading={isLoading}
      error={error as Error | null}
    >
      {trip && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <Badge variant={stateConfig.variant} dot>{stateConfig.label}</Badge>
          </div>

          <Grid cols={{ default: 2, lg: 4 }} gap={4}>
            <StatCard label="Distance" value={trip.distanceMiles.toFixed(1)} unit="mi" />
            <StatCard label="Energy Used" value={trip.energyUsedKwh.toFixed(1)} unit="kWh" />
            <StatCard label="Efficiency" value={trip.efficiencyWhPerMile.toFixed(0)} unit="Wh/mi" />
            <StatCard label="Max Speed" value={trip.maxSpeedMph.toFixed(0)} unit="mph" />
          </Grid>

          <Card className="mt-6">
            <KVList items={[
              { label: 'Trip ID', value: trip.id },
              { label: 'From', value: trip.startAddress || 'Unknown' },
              { label: 'To', value: trip.endAddress || 'Unknown' },
              { label: 'Started', value: new Date(trip.startedAt).toLocaleString() },
              { label: 'Completed', value: trip.completedAt ? new Date(trip.completedAt).toLocaleString() : '—' },
            ]} />
          </Card>
        </>
      )}
    </PageContainer>
  );
}
