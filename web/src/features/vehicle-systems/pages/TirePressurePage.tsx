import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui';
import { KVList } from '@/components/data-display/KVList';
import { useTirePressure } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { TireStatus } from '@/types/vehicle-systems';

function tireStatus(psi: number): { status: TireStatus; variant: 'success' | 'warning' | 'danger' } {
  if (psi < 30) return { status: 'critical', variant: 'danger' };
  if (psi < 35) return { status: 'warning', variant: 'warning' };
  return { status: 'normal', variant: 'success' };
}

export default function TirePressurePage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? '';

  const { data, isLoading, error } = useTirePressure(activeId);

  const tires: { label: string; value: number }[] = data
    ? [
        { label: t('Front Left'), value: data.frontLeft },
        { label: t('Front Right'), value: data.frontRight },
        { label: t('Rear Left'), value: data.rearLeft },
        { label: t('Rear Right'), value: data.rearRight },
      ]
    : [];

  return (
    <PageContainer
      title={t('Tire Pressure')}
      subtitle={t('TPMS readings and pressure history')}
      loading={isLoading}
      error={error as Error | null}
      empty={!data}
      emptyMessage={t('No tire pressure data available.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={(vehicles ?? []).map((v) => ({ value: String(v.id), label: v.displayName || v.vin }))}
            value={String(activeId)}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      {data?.tpmsHardWarning && (
        <Card className="border-red-500 bg-red-500/10">
          <p className="text-red-400 font-semibold text-sm">{t('⚠ TPMS Hard Warning Active')}</p>
        </Card>
      )}

      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        {tires.map(({ label, value }) => {
          const { status, variant } = tireStatus(value);
          return (
            <Card key={label}>
              <CardHeader title={label} action={<Badge variant={variant}>{status}</Badge>} />
              <p className="text-3xl font-bold text-center py-2">
                {value.toFixed(1)} <span className="text-sm text-gray-400">PSI</span>
              </p>
            </Card>
          );
        })}
      </Grid>

      <Card>
        <CardHeader title={t('TPMS Status')} />
        <KVList
          columns={2}
          items={[
            { label: t('Hard Warning'), value: data?.tpmsHardWarning ? t('Yes') : t('No') },
            { label: t('Soft Warning'), value: data?.tpmsSoftWarning ? t('Yes') : t('No') },
            { label: t('Last Updated'), value: data?.timestamp ? data.timestamp ? new Date(data.timestamp).toLocaleString() : '—' : '--' },
          ]}
        />
      </Card>
    </PageContainer>
  );
}
