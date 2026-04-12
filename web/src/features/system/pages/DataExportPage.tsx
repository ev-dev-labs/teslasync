import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
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
              <button
                key={et}
                onClick={() => setType(et)}
                className={`rounded border px-3 py-2 text-sm capitalize ${
                  type === et ? 'border-cyan-400 bg-cyan-500/10 text-cyan-300' : 'border-gray-700 text-gray-400'
                }`}
              >
                {t(et)}
              </button>
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
            <select
              className="rounded border px-2 py-1 text-sm bg-transparent w-full"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">{t('All Vehicles')}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.displayName || v.vin}</option>
              ))}
            </select>
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="py-2 px-3 text-left">{t('Type')}</th>
                <th className="py-2 px-3 text-left">{t('Format')}</th>
                <th className="py-2 px-3 text-left">{t('Status')}</th>
                <th className="py-2 px-3 text-right">{t('Records')}</th>
                <th className="py-2 px-3 text-left">{t('Created')}</th>
              </tr>
            </thead>
            <tbody>
              {jobs?.map((job) => {
                const cfg = statusConfig[job.status] ?? statusConfig.queued;
                return (
                  <tr key={job.id} className="border-b border-gray-800">
                    <td className="py-2 px-3 capitalize">{job.type}</td>
                    <td className="py-2 px-3"><Badge variant="neutral" size="sm">{job.format.toUpperCase()}</Badge></td>
                    <td className="py-2 px-3"><Badge variant={cfg.variant} size="sm">{job.status}</Badge></td>
                    <td className="py-2 px-3 text-right">{job.recordCount ?? '--'}</td>
                    <td className="py-2 px-3 text-gray-400 text-xs">{new Date(job.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </PageContainer>
  );
}
