import { useTranslation } from 'react-i18next';
import { useQueueJobs } from '@/api/hooks/useSystemQueues';
import { deriveDataState } from '@/api/dataState';
import type { QueueJobView } from '@/api/types';
import { Drawer, Text, Caption } from '@/components/ui';
import { ListSkeleton } from '@/components/feedback';
import { formatDateTime } from '@/lib/dateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { AdminSourceContent } from './AdminSourceContent';

const STATUS_TONE: Record<string, string> = {
  sent: 'text-emerald-300', pending: 'text-amber-300', deferred_dnd: 'text-amber-300', failed: 'text-rose-300',
  ready: 'text-emerald-300', queued: 'text-amber-300', processing: 'text-cyan-300',
  success: 'text-emerald-300', partial: 'text-amber-300', running: 'text-cyan-300',
  cancelled: 'text-[var(--text-muted)]', skipped: 'text-[var(--text-muted)]',
};

function durationMs(job: QueueJobView): number | null {
  if (typeof job.duration_ms === 'number' && Number.isFinite(job.duration_ms) && job.duration_ms > 0) return job.duration_ms;
  if (job.finished_at) {
    const finished = new Date(job.finished_at).getTime();
    const started = new Date(job.started_at).getTime();
    if (Number.isFinite(finished) && Number.isFinite(started) && finished > started) return finished - started;
  }
  return null;
}

export function WorkerJobsDrawer({ worker, displayName, open, onClose }: {
  worker: string | null; displayName?: string; open: boolean; onClose: () => void;
}) {
  const { t } = useTranslation();
  const { formatDurationMsLong } = useNumberFormatting();
  const query = useQueueJobs(worker ?? '__none__', { enabled: Boolean(open && worker) });
  const source = deriveDataState(query);
  const jobs = source.data?.jobs ?? [];
  const title = displayName ? t('queueStatus.drawer.titleWithWorker', 'Recent {{worker}} jobs', { worker: displayName })
    : t('queueStatus.drawer.title', 'Recent jobs');
  return (
    <Drawer open={open} onClose={onClose} title={title}>
      <div data-testid="queue-job-drawer-body">
        <AdminSourceContent source={source} label={title} fatalTestId="queue-job-drawer-error"
          emptyMessage={t('queueStatus.drawer.empty', 'No recent jobs to show. New jobs will appear here as the worker processes them.')}
          fatalMessage={<Text variant="error">{t('queueStatus.drawer.error', 'Could not load recent jobs. Check API logs and try again.')}</Text>}
          loadingContent={<ListSkeleton rows={4} label={t('queueStatus.drawer.loading', 'Loading recent jobs…')} testId="queue-job-drawer-loading" />}>
          {jobs.length === 0 ? <Text variant="bodySm" data-testid="queue-job-drawer-empty">{t('queueStatus.drawer.empty', 'No recent jobs to show. New jobs will appear here as the worker processes them.')}</Text>
            : <ul className="space-y-3" data-testid="queue-job-drawer-list">{jobs.map((job) => {
              const duration = durationMs(job);
              return <li key={job.id} className="min-w-0 rounded-md border border-[var(--border-default)] bg-[var(--surface-1)] p-3" data-testid={`queue-job-row-${job.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Text variant="bodySm" weight="medium" className="min-w-0 break-words">{job.title || job.id || '—'}</Text>
                  <Text variant="caption" className={STATUS_TONE[job.status] ?? 'text-[var(--text-primary)]'} data-testid={`queue-job-status-${job.id}`}>{t(`queueStatus.jobStatus.${job.status}`, job.status)}</Text>
                </div>
                <Caption className="mt-1 block">{t('queueStatus.jobStarted', 'Started {{at}}', { at: formatDateTime(job.started_at) })}
                  {duration != null ? ` · ${t('queueStatus.jobDuration', 'Took {{duration}}', { duration: formatDurationMsLong(duration) })}` : ''}</Caption>
                {job.error && <div className="mt-2 rounded border border-rose-500/30 bg-rose-500/5 p-2" data-testid={`queue-job-error-${job.id}`}>
                  <Text variant="error" className="break-words">{job.error}</Text>
                </div>}
              </li>;
            })}</ul>}
        </AdminSourceContent>
      </div>
    </Drawer>
  );
}
