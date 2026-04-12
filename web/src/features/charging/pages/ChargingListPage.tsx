import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useChargingSessions } from '@/api/hooks/useCharging';
import { chargingStates } from '@/lib/fsm';
import type { ChargingSession } from '@/types/charging';
import { useTranslation } from 'react-i18next';

export default function ChargingListPage() {
  const { t } = useTranslation('charging');
  const { data: sessions, isLoading, error } = useChargingSessions();

  return (
    <PageContainer
      title={t('list.title', 'Charging Sessions')}
      subtitle={t('list.subtitle', 'All charging sessions across your fleet')}
      loading={isLoading}
      error={error as Error | null}
      empty={sessions?.length === 0}
      emptyMessage={t('list.empty', 'No charging sessions found.')}
    >
      <div className="space-y-3">
        {sessions?.map((s: ChargingSession) => (
          <ChargingRow key={s.id} session={s} />
        ))}
      </div>
    </PageContainer>
  );
}

function ChargingRow({ session }: { session: ChargingSession }) {
  const stateConfig = chargingStates[session.fsmState] ?? chargingStates.pending;

  return (
    <Card hover className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div>
          <p className="font-medium">{(session.chargerType ?? '').toUpperCase()}</p>
          <p className="text-xs text-gray-500">
            {session.startedAt ? new Date(session.startedAt).toLocaleDateString() : '—'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-6 text-sm">
        <div className="text-right">
          <p className="font-medium">{(session.energyAddedKwh ?? 0).toFixed(1)} kWh</p>
          <p className="text-xs text-gray-500">
            {session.startBatteryLevel}% → {session.endBatteryLevel}%
          </p>
        </div>
        <div className="text-right">
          <p className="font-medium">${(session.costCents / 100).toFixed(2)}</p>
        </div>
        <Badge variant={stateConfig.variant}>{stateConfig.label}</Badge>
      </div>
    </Card>
  );
}
