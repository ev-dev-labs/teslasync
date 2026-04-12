import { useParams } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useChargingSession } from '@/api/hooks/useCharging';
import { chargingStates, chargingSubStates } from '@/lib/fsm';

export default function ChargingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isLoading, error } = useChargingSession(id!);

  const stateConfig = chargingStates[session?.fsmState ?? 'pending'] ?? chargingStates.pending;
  const subStateConfig = session?.subFsmState
    ? chargingSubStates[session.subFsmState]
    : undefined;

  return (
    <PageContainer
      title="Charging Session"
      subtitle={session ? `${session.chargerType.toUpperCase()} · ${new Date(session.startedAt).toLocaleDateString()}` : undefined}
      loading={isLoading}
      error={error as Error | null}
    >
      {session && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <Badge variant={stateConfig.variant} dot>{stateConfig.label}</Badge>
            {subStateConfig && (
              <Badge variant={subStateConfig.variant} size="sm">{subStateConfig.label}</Badge>
            )}
          </div>

          <Grid cols={{ default: 2, lg: 4 }} gap={4}>
            <StatCard label="Energy Added" value={session.energyAddedKwh.toFixed(1)} unit="kWh" />
            <StatCard label="Max Power" value={session.maxPowerKw.toFixed(1)} unit="kW" />
            <StatCard label="Cost" value={`$${(session.costCents / 100).toFixed(2)}`} />
            <StatCard
              label="Battery"
              value={`${session.startBatteryLevel}% → ${session.endBatteryLevel}%`}
            />
          </Grid>

          <Card className="mt-6">
            <KVList items={[
              { label: 'Session ID', value: session.id },
              { label: 'Charger Type', value: session.chargerType },
              { label: 'Started', value: new Date(session.startedAt).toLocaleString() },
              { label: 'Completed', value: session.completedAt ? new Date(session.completedAt).toLocaleString() : '—' },
            ]} />
          </Card>
        </>
      )}
    </PageContainer>
  );
}
