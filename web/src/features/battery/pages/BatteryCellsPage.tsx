import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { StatCard } from '@/components/data-display/StatCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui';
import { KVList } from '@/components/data-display/KVList';
import { useBatteryCells } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

function spreadStatus(spread: number): 'success' | 'warning' | 'danger' {
  if (spread < 0.01) return 'success';
  if (spread < 0.03) return 'warning';
  return 'danger';
}

export default function BatteryCellsPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? null;

  const { data, isLoading, error } = useBatteryCells(activeId);

  const voltageStatus = spreadStatus(data?.voltage_spread ?? 0);
  const tempStatus = spreadStatus(data?.temp_spread ?? 0);

  return (
    <PageContainer
      title={t('Battery Cells')}
      subtitle={t('Individual cell voltage and temperature analysis')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage={t('No cell data available yet.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={(vehicles ?? []).map((v) => ({ value: String(v.id), label: v.displayName || v.vin }))}
            value={String(activeId ?? '')}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Total Cells')} value={data?.total_cells ?? 0} />
        <StatCard label={t('Avg Voltage')} value={data?.avg_voltage?.toFixed(3) ?? '0'} unit="V" />
        <StatCard label={t('Avg Temperature')} value={data?.avg_temperature?.toFixed(1) ?? '0'} unit="°C" />
        <StatCard
          label={t('Voltage Spread')}
          value={((data?.voltage_spread ?? 0) * 1000).toFixed(1)}
          unit="mV"
          icon={<Badge variant={voltageStatus} size="sm">{voltageStatus === 'success' ? t('Healthy') : t('Watch')}</Badge>}
        />
      </Grid>

      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <Card>
          <CardHeader title={t('Voltage Summary')} action={<Badge variant={voltageStatus}>{t('Spread')}: {((data?.voltage_spread ?? 0) * 1000).toFixed(1)} mV</Badge>} />
          <KVList items={[
            { label: t('Min Voltage'), value: `${data?.min_voltage?.toFixed(3) ?? '—'} V` },
            { label: t('Max Voltage'), value: `${data?.max_voltage?.toFixed(3) ?? '—'} V` },
            { label: t('Average'), value: `${data?.avg_voltage?.toFixed(3) ?? '—'} V` },
            { label: t('Spread'), value: `${((data?.voltage_spread ?? 0) * 1000).toFixed(1)} mV` },
          ]} />
        </Card>

        <Card>
          <CardHeader title={t('Temperature Summary')} action={<Badge variant={tempStatus}>{t('Spread')}: {data?.temp_spread?.toFixed(1) ?? '0'}°C</Badge>} />
          <KVList items={[
            { label: t('Min Temp'), value: `${data?.min_temperature?.toFixed(1) ?? '—'}°C` },
            { label: t('Max Temp'), value: `${data?.max_temperature?.toFixed(1) ?? '—'}°C` },
            { label: t('Average'), value: `${data?.avg_temperature?.toFixed(1) ?? '—'}°C` },
            { label: t('Spread'), value: `${data?.temp_spread?.toFixed(1) ?? '0'}°C` },
          ]} />
        </Card>
      </Grid>

      {data?.cells && data.cells.length > 0 && (
        <Card>
          <CardHeader title={t('Cell Details')} subtitle={`${data.cells.length} ${t('cells')}`} />
          <div className="max-h-96 overflow-y-auto">
            <KVList
              columns={2}
              items={data.cells.map((cell) => ({
                label: `${t('Cell')} ${cell.cell_id} (M${cell.module})`,
                value: `${(cell.voltage ?? 0).toFixed(3)} V / ${(cell.temperature ?? 0).toFixed(1)}°C`,
              }))}
            />
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
