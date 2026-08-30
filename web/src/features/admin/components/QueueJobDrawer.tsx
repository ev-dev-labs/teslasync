/**
 * QueueJobDrawer job-history panel.
 *
 * Slide-in panel that lists the most recent jobs for a single
 * worker. Reuses the shared <Drawer> primitive so focus-trap +
 * Escape-to-close behaviour stays consistent with the rest of the
 * app.
 *
 * The fetch is gated on `open` via TanStack's `enabled` option so a
 * closed drawer never burns a network call. Loading, error, and
 * empty states each have a deterministic data-testid for the
 * companion test file.
 */

import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import { Drawer } from '@/components/ui'
import { Text, Caption } from '@/components/ui/Typography'
import { ListSkeleton } from '@/components/feedback'
import { formatDateTime, formatDurationMsLong } from '@/lib/dateFormat'
import { useQueueJobs } from '@/api/hooks/useSystemQueues'
import type { QueueJobView } from '@/api/types'

const STATUS_TONE: Record<string, string> = {
  // notification
  sent: 'text-emerald-300',
  pending: 'text-amber-300',
  deferred_dnd: 'text-amber-300',
  failed: 'text-rose-300',

  // export
  ready: 'text-emerald-300',
  queued: 'text-amber-300',
  processing: 'text-cyan-300',

  // automation
  success: 'text-emerald-300',
  partial: 'text-amber-300',
  running: 'text-cyan-300',
  cancelled: 'text-[var(--text-muted)]',
  skipped: 'text-[var(--text-muted)]',
}

function statusToneClass(status: string): string {
  return STATUS_TONE[status] ?? 'text-[var(--text-primary)]'
}

/**
 * Resolve a job's runtime in milliseconds.
 *
 * Prefers the server-provided `duration_ms`, falling back to the
 * finished/started delta. Returns `null` when neither yields a positive,
 * finite value — a non-positive or `NaN` `duration_ms`, a missing
 * `finished_at`, or an unparseable timestamp — so the row can omit the
 * duration segment entirely instead of rendering a meaningless
 * "Took —" placeholder.
 */
function computeDurationMs(job: QueueJobView): number | null {
  const explicit = job.duration_ms
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return explicit
  }
  if (job.finished_at) {
    const finished = new Date(job.finished_at).getTime()
    const started = new Date(job.started_at).getTime()
    if (Number.isFinite(finished) && Number.isFinite(started) && finished > started) {
      return finished - started
    }
  }
  return null
}

interface QueueJobRowProps {
  job: QueueJobView
}

function QueueJobRow({ job }: QueueJobRowProps) {
  const { t } = useTranslation()

  const durationMs = computeDurationMs(job)
  const durationLabel =
    durationMs != null ? formatDurationMsLong(durationMs) : null

  return (
    <li
      className="rounded-md border border-white/[0.06] bg-[var(--surface-1)]/40 p-3"
      data-testid={`queue-job-row-${job.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <Text variant="bodySm" className="font-medium truncate">
          {job.title || job.id || '—'}
        </Text>
        <Text
          variant="caption"
          className={statusToneClass(job.status)}
          data-testid={`queue-job-status-${job.id}`}
        >
          {t(`queueStatus.jobStatus.${job.status}`, job.status)}
        </Text>
      </div>
      <Caption className="mt-1 block">
        {t('queueStatus.jobStarted', 'Started {{at}}', {
          at: formatDateTime(job.started_at),
        })}
        {durationLabel
          ? ` · ${t('queueStatus.jobDuration', 'Took {{duration}}', {
              duration: durationLabel,
            })}`
          : ''}
      </Caption>
      {job.error ? (
        <div
          className="mt-2 flex items-start gap-2 rounded border border-rose-500/30 bg-rose-500/5 p-2"
          data-testid={`queue-job-error-${job.id}`}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" aria-hidden />
          <Text variant="error" className="break-words">{job.error}</Text>
        </div>
      ) : null}
    </li>
  )
}

export interface QueueJobDrawerProps {
  worker: string | null
  displayName?: string
  open: boolean
  onClose: () => void
  /** Override the fetch hook for Storybook / tests. */
  testHookOverride?: ReturnType<typeof useQueueJobs>
}

export function QueueJobDrawer({
  worker,
  displayName,
  open,
  onClose,
  testHookOverride,
}: QueueJobDrawerProps) {
  const { t } = useTranslation()
  // useQueueJobs requires a string identifier. When the drawer is
  // closed we still need to render a stable hook call, so pass an
  // empty placeholder and gate the network with enabled=false.
  const liveQuery = useQueueJobs(worker ?? '__none__', {
    enabled: Boolean(open && worker && !testHookOverride),
  })
  const query = testHookOverride ?? liveQuery

  const data = query.data
  const isLoading = query.isLoading && open
  const error = query.error && open ? query.error : null
  const jobs = data?.jobs ?? []

  const title = displayName
    ? t('queueStatus.drawer.titleWithWorker', 'Recent {{worker}} jobs', {
        worker: displayName,
      })
    : t('queueStatus.drawer.title', 'Recent jobs')

  return (
    <Drawer open={open} onClose={onClose} title={title}>
      <div data-testid="queue-job-drawer-body">
        {isLoading ? (
          <ListSkeleton
            rows={4}
            label={t('queueStatus.drawer.loading', 'Loading recent jobs…')}
            testId="queue-job-drawer-loading"
          />
        ) : error ? (
          <div
            className="flex items-start gap-3 rounded-md border border-rose-500/30 bg-rose-500/5 p-3"
            data-testid="queue-job-drawer-error"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden />
            <Text variant="error">
              {t(
                'queueStatus.drawer.error',
                'Could not load recent jobs. Check API logs and try again.',
              )}
            </Text>
          </div>
        ) : jobs.length === 0 ? (
          <Text
            variant="bodySm"
            className="text-[var(--text-secondary)] italic"
            data-testid="queue-job-drawer-empty"
          >
            {t(
              'queueStatus.drawer.empty',
              'No recent jobs to show. New jobs will appear here as the worker processes them.',
            )}
          </Text>
        ) : (
          <ul className="space-y-2" data-testid="queue-job-drawer-list">
            {jobs.map((job) => (
              <QueueJobRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  )
}

export default QueueJobDrawer
