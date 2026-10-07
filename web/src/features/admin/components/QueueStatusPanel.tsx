/**
 * Operator-facing view of the background worker fleet.
 *
 * Renders one
 * card per known worker (notification, export, automation) with:
 *
 *   • heartbeat-staleness severity badge (ok / warn / critical / down)
 *   • pending + in-progress depth
 *   • succeeded / failed counts over the last 24 hours
 *   • oldest-pending age (when there is a backlog)
 *   • host + version reported by the worker process
 *
 * Clicking a card opens QueueJobDrawer with the most recent jobs for
 * that worker. Auto-refresh and pause-when-hidden semantics live
 * inside useQueueStatus — the panel is purely presentational so
 * tests can drive it with stub data via the testHookOverride prop.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, AlertTriangle, ChevronRight } from 'lucide-react'

import { GlassPanel, Button } from '@/components/ui'
import { Heading, Text, Caption } from '@/components/ui/Typography'
import { MetricBar } from '@/components/data-display'
import { Skeleton } from '@/components/feedback'
import { fmtNumber } from '@/lib/numberFormat'
import { formatRelative, formatDurationMsLong } from '@/lib/dateFormat'
import { useQueueStatus } from '@/api/hooks/useSystemQueues'
import type { QueueHeartbeatSeverity, QueueStat } from '@/api/types'

import { QueueJobDrawer } from './QueueJobDrawer'

// Severity → hex colour passed into MetricBar (which expects a raw
// string for its dynamic gradient + glow). Hex rather than CSS
// variables keeps the gradient maths inside MetricBar working
// without a runtime lookup; the audit:inline-style guard tolerates
// dynamic per-row colour values per the chart-colour exception.
const SEVERITY_COLOR: Record<QueueHeartbeatSeverity, string> = {
  ok: '#10b981', // emerald-500
  warn: '#f59e0b', // amber-500
  critical: '#ef4444', // red-500
  down: '#94a3b8', // slate-400
}

const SEVERITY_TONE_CLASS: Record<QueueHeartbeatSeverity, string> = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  critical: 'text-rose-300',
  down: 'text-[var(--text-muted)]',
}

interface WorkerCardProps {
  stat: QueueStat
  onOpen: (worker: string) => void
}

function WorkerCard({ stat, onOpen }: WorkerCardProps) {
  const { t } = useTranslation()
  const tone = SEVERITY_TONE_CLASS[stat.heartbeat_severity]
  const color = SEVERITY_COLOR[stat.heartbeat_severity]
  const total = stat.pending + stat.in_progress

  const severityLabel = t(
    `queueStatus.severity.${stat.heartbeat_severity}`,
    stat.heartbeat_severity,
  )

  const lastBeatLabel = useMemo(() => {
    if (!stat.last_heartbeat_at) {
      return t('queueStatus.heartbeatNever', 'No heartbeat recorded')
    }
    return t('queueStatus.heartbeatRelative', 'Last beat {{when}}', {
      when: formatRelative(stat.last_heartbeat_at),
    })
  }, [stat.last_heartbeat_at, t])

  const oldestLabel = useMemo(() => {
    if (stat.oldest_pending_age_seconds <= 0) return null
    return t('queueStatus.oldestPending', 'Oldest pending: {{duration}}', {
      duration: formatDurationMsLong(stat.oldest_pending_age_seconds * 1000),
    })
  }, [stat.oldest_pending_age_seconds, t])

  const handleOpen = () => onOpen(stat.worker)

  return (
    <Button
      type="button"
      variant="ghost"
      size="auto"
      onClick={handleOpen}
      className="h-auto w-full flex-col items-stretch justify-start rounded-xl border border-white/[0.06] bg-[var(--surface-1)]/40 p-4 text-left hover:bg-[var(--surface-1)]/70"
      data-testid={`queue-worker-card-${stat.worker}`}
      aria-label={t('queueStatus.openDrawer', 'Show recent {{worker}} jobs', {
        worker: stat.display_name,
      })}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Text variant="bodySm" className="font-semibold">
            {stat.display_name}
          </Text>
          <Caption className="block mt-0.5 truncate">
            {stat.host
              ? t('queueStatus.hostVersion', '{{host}} · {{version}}', {
                  host: stat.host,
                  version: stat.version || t('queueStatus.versionUnknown', 'unknown'),
                })
              : t('queueStatus.hostUnknown', 'No host reported')}
          </Caption>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Text
            variant="caption"
            className={tone}
            data-testid={`queue-severity-${stat.worker}`}
          >
            {severityLabel}
          </Text>
          <ChevronRight
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden
          />
        </div>
      </div>

      <div className="mt-3">
        <MetricBar
          value={total}
          max={total > 0 ? total : 1}
          color={color}
          label={t('queueStatus.queueDepth', 'Queue depth')}
          sublabel={t(
            'queueStatus.queueDepthDetail',
            '{{pending}} pending · {{inProgress}} in progress',
            {
              pending: fmtNumber(stat.pending),
              inProgress: fmtNumber(stat.in_progress),
            },
          )}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div>
          <Caption>{t('queueStatus.metric.succeeded24h', 'Succeeded 24h')}</Caption>
          <Text
            variant="bodySm"
            className="font-medium text-emerald-300"
            data-testid={`queue-succeeded-${stat.worker}`}
          >
            {fmtNumber(stat.succeeded_24h)}
          </Text>
        </div>
        <div>
          <Caption>{t('queueStatus.metric.failed24h', 'Failed 24h')}</Caption>
          <Text
            variant="bodySm"
            className={
              stat.failed_24h > 0
                ? 'font-medium text-rose-300'
                : 'font-medium text-[var(--text-primary)]'
            }
            data-testid={`queue-failed-${stat.worker}`}
          >
            {fmtNumber(stat.failed_24h)}
          </Text>
        </div>
      </dl>

      <div className="mt-3 space-y-0.5">
        <Caption className={tone} data-testid={`queue-heartbeat-${stat.worker}`}>
          {stat.heartbeat_detail || lastBeatLabel}
        </Caption>
        {oldestLabel ? (
          <Caption className="text-amber-300/80">{oldestLabel}</Caption>
        ) : null}
      </div>
    </Button>
  )
}

export interface QueueStatusPanelProps {
  /** Override the auto-refresh hook for Storybook / tests. */
  testHookOverride?: ReturnType<typeof useQueueStatus>
}

export function QueueStatusPanel({ testHookOverride }: QueueStatusPanelProps = {}) {
  const { t } = useTranslation()
  const liveQuery = useQueueStatus({ enabled: !testHookOverride })
  const query = testHookOverride ?? liveQuery

  const data = query.data
  const isLoading = query.isLoading
  const isFetching = query.isFetching
  const error = query.error
  const refetch = query.refetch

  const workers = data?.workers ?? []

  const updatedLabel = useMemo(() => {
    if (!data?.generated_at) return null
    return t('queueStatus.lastUpdated', 'Updated {{when}}', {
      when: formatRelative(data.generated_at),
    })
  }, [data?.generated_at, t])

  const [openWorker, setOpenWorker] = useState<string | null>(null)
  const openStat = workers.find((w) => w.worker === openWorker) ?? null

  return (
    <GlassPanel className="p-5" data-testid="queue-status-panel">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <Heading level="panel" className="mb-1">
            {t('queueStatus.title', 'Background workers')}
          </Heading>
          <Text variant="bodySm" className="text-[var(--text-secondary)] max-w-[80ch]">
            {t(
              'queueStatus.subtitle',
              'Live view of the notification, export, and automation worker queues. Heartbeat colour switches from green to amber after 60 seconds and to red after 5 minutes of silence; "down" means the worker has never reported in.',
            )}
          </Text>
          {updatedLabel ? (
            <Caption className="mt-2 block">{updatedLabel}</Caption>
          ) : null}
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            void refetch()
          }}
          loading={isFetching && !isLoading}
          disabled={isFetching}
          icon={<RefreshCw className="h-4 w-4" aria-hidden />}
          data-testid="queue-refresh-button"
        >
          {t('queueStatus.refresh', 'Refresh')}
        </Button>
      </div>

      {isLoading ? (
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-3"
          data-testid="queue-loading"
          role="status"
          aria-busy="true"
          aria-label={t('queueStatus.loading', 'Loading worker status…')}
        >
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              aria-hidden="true"
              className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-14" />
              </div>
              <Skeleton className="h-10 w-full" />
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div
          className="flex items-start gap-3 rounded-md border border-rose-500/30 bg-rose-500/5 p-3"
          data-testid="queue-error"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden />
          <Text variant="error">
            {t(
              'queueStatus.error',
              'Could not load worker status. Check API logs and try again.',
            )}
          </Text>
        </div>
      ) : workers.length === 0 ? (
        <Text
          variant="bodySm"
          className="text-[var(--text-secondary)] italic"
          data-testid="queue-empty"
        >
          {t(
            'queueStatus.empty',
            'No workers are currently registered. The notification, export, and automation processes report here once they start.',
          )}
        </Text>
      ) : (
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
          data-testid="queue-rows"
        >
          {workers.map((stat) => (
            <WorkerCard
              key={stat.worker}
              stat={stat}
              onOpen={setOpenWorker}
            />
          ))}
        </div>
      )}

      <QueueJobDrawer
        worker={openStat?.worker ?? null}
        displayName={openStat?.display_name}
        open={Boolean(openStat)}
        onClose={() => setOpenWorker(null)}
      />
    </GlassPanel>
  )
}

export default QueueStatusPanel
