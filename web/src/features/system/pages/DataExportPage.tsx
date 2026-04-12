import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui';
import { StatCard } from '@/components/data-display/StatCard';
import { useExportJobs, useCreateExport } from '@/api/hooks/useAdmin';
import { useVehicles } from '@/api/hooks/useVehicles';

const EXPORT_TYPES = ['drives', 'charging', 'analytics', 'backup'] as const;
const EXPORT_FORMATS = ['csv', 'json'] as const;

const statusConfig: Record<string, { variant: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }> = {
  ready: { variant: 'success' },
  processing: { variant: 'info' },
  queued: { variant: 'neutral' },
  failed: { variant: 'danger' },
};

export default function DataExportPage() {
  const { t } = useTranslation();
  const { data: jobs, isLoading, error } = useExportJobs();
  const { data: vehicles } = useVehicles();
  const createExport = useCreateExport();

  const [type, setType] = useState<string>('drives');
  const [format, setFormat] = useState<string>('csv');
  const [vehicleId, setVehicleId] = useState('');

  function handleExport() {
    createExport.mutate({ type, format, vehicleId: vehicleId || undefined });
  }

  return (
    <PageContainer
      title={t('Data Export')}
      subtitle={t('Export vehicle data in CSV or JSON format')}
      loading={isLoading}
      error={error as Error | null}
    >
      <Card>
        <CardHeader title={t('New Export')} />
        <div className="px-4 pb-4 space-y-3">
          <Grid cols={{ default: 2, md: 4 }} gap={3}>
            {EXPORT_TYPES.map((et) => (
              <Button
                key={et}
                size="sm"
                variant={type === et ? 'primary' : 'outline'}
                onClick={() => setType(et)}
                className="capitalize"
              >
                {t(et)}
              </Button>
            ))}
          </Grid>

          <div className="flex gap-2">
            {EXPORT_FORMATS.map((f) => (
              <Button key={f} size="sm" variant={format === f ? 'primary' : 'outline'} onClick={() => setFormat(f)}>
                {f.toUpperCase()}
              </Button>
            ))}
          </div>

          {vehicles && vehicles.length > 1 && (
            <Select
              options={[
                { value: '', label: t('All Vehicles') },
                ...(vehicles ?? []).map((v) => ({ value: String(v.id), label: v.displayName || v.vin })),
              ]}
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            />
          )}

          <Button variant="primary" loading={createExport.isPending} onClick={handleExport}>
            {t('Start Export')}
          </Button>
        </div>
      </Card>

      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Total Exports')} value={jobs?.length ?? 0} />
        <StatCard label={t('Ready')} value={jobs?.filter((j) => j.status === 'ready').length ?? 0} />
        <StatCard label={t('Processing')} value={jobs?.filter((j) => j.status === 'processing').length ?? 0} />
        <StatCard label={t('Failed')} value={jobs?.filter((j) => j.status === 'failed').length ?? 0} />
      </Grid>

      <Card>
        <CardHeader title={t('Export Jobs')} />
        <div className="divide-y divide-gray-800">
          {jobs?.map((job) => {
            const cfg = statusConfig[job.status] ?? statusConfig.queued;
            return (
              <div key={job.id} className="flex items-center gap-4 px-3 py-2 text-sm">
                <span className="w-24 capitalize shrink-0">{job.type}</span>
                <Badge variant="neutral" size="sm">{(job.format ?? '').toUpperCase()}</Badge>
                <Badge variant={cfg.variant} size="sm">{job.status}</Badge>
                <span className="w-16 text-right shrink-0">{job.recordCount ?? '--'}</span>
                <span className="text-gray-400 text-xs">{job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </PageContainer>
  );
}
