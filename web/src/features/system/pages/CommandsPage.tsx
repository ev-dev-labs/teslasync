import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/data-display/StatCard';
import { useVehicles } from '@/api/hooks/useVehicles';

interface CommandDef {
  id: string;
  label: string;
  group: string;
  variant: 'primary' | 'secondary' | 'outline' | 'danger';
}

const COMMANDS: CommandDef[] = [
  { id: 'wake', label: 'Wake Up', group: 'Security & Access', variant: 'primary' },
  { id: 'lock', label: 'Lock', group: 'Security & Access', variant: 'outline' },
  { id: 'unlock', label: 'Unlock', group: 'Security & Access', variant: 'outline' },
  { id: 'climate_on', label: 'Climate On', group: 'Climate', variant: 'outline' },
  { id: 'climate_off', label: 'Climate Off', group: 'Climate', variant: 'outline' },
  { id: 'charge_port', label: 'Open Charge Port', group: 'Charging', variant: 'outline' },
  { id: 'charge_start', label: 'Start Charge', group: 'Charging', variant: 'primary' },
  { id: 'charge_stop', label: 'Stop Charge', group: 'Charging', variant: 'danger' },
  { id: 'frunk', label: 'Open Frunk', group: 'Doors & Trunk', variant: 'outline' },
  { id: 'trunk', label: 'Open Trunk', group: 'Doors & Trunk', variant: 'outline' },
  { id: 'horn', label: 'Honk Horn', group: 'Alerts', variant: 'outline' },
  { id: 'flash', label: 'Flash Lights', group: 'Alerts', variant: 'outline' },
];

export default function CommandsPage() {
  const { t } = useTranslation();
  const { data: vehicles, isLoading, error } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<{ id: string; success: boolean } | null>(null);

  const activeId = vehicleId ?? vehicles?.[0]?.id ?? '';
  const vehicle = vehicles?.find((v) => v.id === activeId);

  const groups = [...new Set(COMMANDS.map((c) => c.group))];

  function handleCommand(cmdId: string) {
    // Placeholder: would call API mutation
    setLastCommand({ id: cmdId, success: true });
  }

  return (
    <PageContainer
      title={t('Vehicle Commands')}
      subtitle={t('Remote control for your Tesla')}
      loading={isLoading}
      error={error as Error | null}
      empty={!vehicles?.length}
      emptyMessage={t('No vehicles available.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <select
            className="rounded border px-2 py-1 text-sm"
            value={activeId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.displayName || v.vin}</option>
            ))}
          </select>
        ) : undefined
      }
    >
      {vehicle && (
        <Grid cols={{ default: 2, lg: 4 }} gap={4}>
          <StatCard label={t('Vehicle')} value={vehicle.displayName || vehicle.vin} />
          <StatCard label={t('Battery')} value={`${vehicle.batteryLevel}%`} />
          <StatCard label={t('Range')} value={`${vehicle.rangeMiles} mi`} />
          <StatCard label={t('State')} value={vehicle.fsmState} />
        </Grid>
      )}

      {lastCommand && (
        <Card className={lastCommand.success ? 'border-green-500/30' : 'border-red-500/30'}>
          <div className="flex items-center gap-2 px-4 py-2">
            <Badge variant={lastCommand.success ? 'success' : 'danger'} size="sm">
              {lastCommand.success ? t('Success') : t('Error')}
            </Badge>
            <span className="text-sm">{lastCommand.id}</span>
          </div>
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group}>
          <CardHeader title={t(group)} />
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            {COMMANDS.filter((c) => c.group === group).map((cmd) => (
              <Button
                key={cmd.id}
                variant={cmd.variant}
                size="sm"
                onClick={() => handleCommand(cmd.id)}
              >
                {t(cmd.label)}
              </Button>
            ))}
          </div>
        </Card>
      ))}
    </PageContainer>
  );
}
