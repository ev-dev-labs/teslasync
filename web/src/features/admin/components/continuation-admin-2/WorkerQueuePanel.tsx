import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import type { useQueueStatus } from '@/api/hooks/useSystemQueues';
import { deriveDataState } from '@/api/dataState';
import { LayoutCard } from '@/components/layout';
import { Button, Caption, Text } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { formatRelative } from '@/lib/dateFormat';
import { WorkerJobsDrawer } from './WorkerJobsDrawer';
import { QueueWorkerCard } from './QueueWorkerCard';
import { AdminSourceContent } from './AdminSourceContent';

export function WorkerQueuePanel({ query }: { query: ReturnType<typeof useQueueStatus> }) {
  const { t } = useTranslation();
  const source = deriveDataState(query);
  const workers = source.data?.workers ?? [];
  const [openWorker, setOpenWorker] = useState<string | null>(null);
  const openStat = workers.find((worker) => worker.worker === openWorker) ?? null;
  return (
    <div data-testid="queue-status-panel" className="min-w-0">
      <LayoutCard title={t('queueStatus.title', 'Background workers')}
        description={t('queueStatus.subtitle', 'Live view of the notification, export, and automation worker queues. Heartbeat colour switches from green to amber after 60 seconds and to red after 5 minutes of silence; "down" means the worker has never reported in.')}
        actions={<Button variant="ghost" wrapLabel onClick={() => { void query.refetch(); }} loading={query.isFetching && !query.isLoading} disabled={query.isFetching}
          icon={<RefreshCw className="h-4 w-4" aria-hidden />} data-testid="queue-refresh-button">{t('queueStatus.refresh', 'Refresh')}</Button>}>
        {source.data?.generated_at && <Caption>{t('queueStatus.lastUpdated', 'Updated {{when}}', { when: formatRelative(source.data.generated_at) })}</Caption>}
        <AdminSourceContent source={source} fatalTestId="queue-error" retryOnRetained={false} label={t('queueStatus.title', 'Background workers')} emptyMessage={t('queueStatus.empty', 'No workers are currently registered. The notification, export, and automation processes report here once they start.')}
          fatalMessage={<Text variant="error">{t('queueStatus.error', 'Could not load worker status. Check API logs and try again.')}</Text>}
          loadingContent={<div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="queue-loading">
            {[0, 1, 2].map((item) => <div key={item} aria-hidden className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
              <div className="flex items-center justify-between gap-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-4 w-14" /></div>
              <Skeleton className="h-10 w-full" /><div className="grid grid-cols-2 gap-3"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
            </div>)}
          </div>}>
          {workers.length === 0 ? <Text variant="bodySm" data-testid="queue-empty">{t('queueStatus.empty', 'No workers are currently registered. The notification, export, and automation processes report here once they start.')}</Text>
            : <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="queue-rows">{workers.map((stat) => <QueueWorkerCard key={stat.worker} stat={stat} onOpen={setOpenWorker} />)}</div>}
        </AdminSourceContent>
        <WorkerJobsDrawer worker={openStat?.worker ?? null} displayName={openStat?.display_name} open={Boolean(openStat)} onClose={() => setOpenWorker(null)} />
      </LayoutCard>
    </div>
  );
}
