import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui';
import { StatCard } from '@/components/data-display/StatCard';
import { useSoftwareUpdates } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';

const statusConfig: Record<string, { variant: 'success' | 'info' | 'warning' | 'neutral'; label: string }> = {
  installed: { variant: 'success', label: 'Installed' },
  installing: { variant: 'info', label: 'Installing' },
  downloading: { variant: 'info', label: 'Downloading' },
  available: { variant: 'warning', label: 'Available' },
  scheduled: { variant: 'neutral', label: 'Scheduled' },
};

export default function SoftwareUpdatesPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? '';

  const { data: updates, isLoading, error } = useSoftwareUpdates(String(activeId));

  const installed = updates?.filter((u) => u.status === 'installed') ?? [];
  const current = installed[0]?.version ?? '--';

  return (
    <PageContainer
      title={t('Software Updates')}
      subtitle={t('Update history and installation status')}
      loading={isLoading}
      error={error as Error | null}
      empty={!updates?.length}
      emptyMessage={t('No software update records.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={(vehicles ?? []).map((v) => ({ value: String(v.id), label: v.display_name || v.vin }))}
            value={String(activeId)}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      <Grid cols={{ default: 1, md: 3 }} gap={4}>
        <StatCard label={t('Current Version')} value={current} />
        <StatCard label={t('Installed')} value={installed.length} />
        <StatCard label={t('Total Updates')} value={updates?.length ?? 0} />
      </Grid>

      <Card>
        <CardHeader title={t('Update Timeline')} />
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {updates?.map((u) => {
            const cfg = statusConfig[u.status] ?? statusConfig.installed;
            return (
              <div key={u.id} className="flex items-start gap-3 border-b border-gray-800 pb-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-cyan-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold">{u.version}</span>
                    <Badge variant={cfg.variant} size="sm">{t(cfg.label)}</Badge>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {u.installedAt
                      ? t('Installed') + ': ' + u.installedAt ? new Date(u.installedAt).toLocaleString() : '—'
                      : u.scheduledAt
                        ? t('Scheduled') + ': ' + u.scheduledAt ? new Date(u.scheduledAt).toLocaleString() : '—'
                        : t('Created') + ': ' + u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </PageContainer>
  );
}
