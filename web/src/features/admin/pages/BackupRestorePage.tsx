import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/data-display/StatCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useBackupConfigs, useBackupRuns } from '@/api/hooks/useAdmin';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

const statusConfig: Record<string, { variant: 'success' | 'danger' | 'info' | 'neutral' }> = {
  completed: { variant: 'success' },
  failed: { variant: 'danger' },
  running: { variant: 'info' },
  queued: { variant: 'neutral' },
};

export default function BackupRestorePage() {
  const { t } = useTranslation();
  const { data: configs, isLoading: loadingConfigs, error: configError } = useBackupConfigs();
  const { data: runs, isLoading: loadingRuns } = useBackupRuns();

  const totalSize = runs?.reduce((sum, r) => sum + (r.fileSize ?? 0), 0) ?? 0;
  const lastBackup = runs?.[0]?.createdAt;

  return (
    <PageContainer
      title={t('Backup & Restore')}
      subtitle={t('Manage backup configurations and view run history')}
      loading={loadingConfigs || loadingRuns}
      error={configError as Error | null}
      actions={<Button variant="primary" size="sm">{t('New Config')}</Button>}
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Configurations')} value={configs?.length ?? 0} />
        <StatCard label={t('Total Backups')} value={runs?.length ?? 0} />
        <StatCard label={t('Last Backup')} value={lastBackup ? new Date(lastBackup).toLocaleDateString() : '--'} />
        <StatCard label={t('Total Size')} value={formatBytes(totalSize)} />
      </Grid>

      <Card>
        <CardHeader title={t('Backup Configurations')} />
        {configs?.length ? (
          <div className="divide-y divide-gray-800">
            {configs.map((cfg) => (
              <div key={cfg.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-semibold">{cfg.name}</p>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <Badge variant={cfg.enabled ? 'success' : 'neutral'} size="sm">{cfg.enabled ? t('Enabled') : t('Disabled')}</Badge>
                    <Badge variant="info" size="sm">{cfg.backupType}</Badge>
                    <Badge variant="neutral" size="sm">{cfg.provider}</Badge>
                    <Badge variant="neutral" size="sm">{t('Every')} {cfg.frequencyDays}d</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline">{t('Run')}</Button>
                  <Button size="sm" variant="outline">{t('Edit')}</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message={t('No backup configurations yet.')} />
        )}
      </Card>

      <Card>
        <CardHeader title={t('Backup Runs')} subtitle={`${runs?.length ?? 0} runs`} />
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="py-2 px-3 text-left">{t('Time')}</th>
                <th className="py-2 px-3 text-left">{t('Status')}</th>
                <th className="py-2 px-3 text-left">{t('Type')}</th>
                <th className="py-2 px-3 text-right">{t('Size')}</th>
                <th className="py-2 px-3 text-right">{t('Duration')}</th>
              </tr>
            </thead>
            <tbody>
              {runs?.map((run) => {
                const cfg = statusConfig[run.status] ?? statusConfig.queued;
                return (
                  <tr key={run.id} className="border-b border-gray-800">
                    <td className="py-2 px-3 text-gray-400 text-xs">{new Date(run.createdAt).toLocaleString()}</td>
                    <td className="py-2 px-3"><Badge variant={cfg.variant} size="sm">{run.status}</Badge></td>
                    <td className="py-2 px-3">{run.backupType}</td>
                    <td className="py-2 px-3 text-right">{run.fileSize ? formatBytes(run.fileSize) : '--'}</td>
                    <td className="py-2 px-3 text-right">{run.durationMs ? formatDuration(run.durationMs) : '--'}</td>
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
