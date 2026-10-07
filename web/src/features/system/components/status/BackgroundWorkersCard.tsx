/**
 * BackgroundWorkersCard — operator-grade per-instance worker visibility.
 *
 * The default `/system/workers` payload may carry multiple rows per worker
 * `name` when the operator has horizontally scaled a worker (one row per
 * host). Single-instance deployments still emit one row per worker. This
 * card groups rows by `name` so the operator can see, at a glance:
 *
 *  - Which worker types are healthy overall (rollup chip per group)
 *  - Which specific instances (host:port URLs) are healthy vs degraded
 *  - The exact error message when a probe fails (HTTP code or dial err)
 *  - Per-instance latency to spot slow but-still-up replicas
 *
 * No backend changes required for the single-instance path. When the
 * backend is configured with `*_HOSTS` (plural) env vars, the same card
 * automatically renders the additional rows under the same group.
 */

import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, Boxes, Server } from 'lucide-react'

import type { WorkersHealth, WorkerStatus } from '@/api/types'
import { Trans, useTranslation } from 'react-i18next'
import { SystemSummaryBrief } from '../operationalbrief-all/SystemSummaryBrief'
import { Caption, Code, Text } from '@/components/ui'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'

interface BackgroundWorkersCardProps {
  health: WorkersHealth | undefined
  retained?: boolean
  loading?: boolean
}

type Severity = 'healthy' | 'degraded' | 'down' | 'unknown'

interface WorkerGroup {
  name: string
  instances: WorkerStatus[]
  healthy: number
  total: number
  severity: Severity
}

function groupByName(workers: WorkerStatus[]): WorkerGroup[] {
  const groups = new Map<string, WorkerStatus[]>()
  for (const w of workers) {
    const list = groups.get(w.name)
    if (list) {
      list.push(w)
    } else {
      groups.set(w.name, [w])
    }
  }
  const out: WorkerGroup[] = []
  for (const [name, instances] of groups) {
    const healthy = instances.filter((i) => i.status === 'healthy').length
    const total = instances.length
    let severity: Severity
    if (instances.every((i) => i.status === 'healthy')) severity = 'healthy'
    else if (instances.every((i) => i.status === 'down')) severity = 'down'
    else severity = 'degraded'
    out.push({ name, instances, healthy, total, severity })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function severityClasses(s: Severity): { dot: string; chip: string; label: string } {
  switch (s) {
    case 'healthy':
      return {
        dot: 'bg-emerald-400',
        chip: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
        label: 'all healthy',
      }
    case 'degraded':
      return {
        dot: 'bg-amber-400',
        chip: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
        label: 'degraded',
      }
    case 'down':
      return {
        dot: 'bg-red-500',
        chip: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
        label: 'down',
      }
    case 'unknown':
    default:
      return {
        dot: 'bg-[var(--surface-2)]',
        chip: 'bg-white/[0.06] text-[var(--text-muted)] ring-1 ring-white/10',
        label: 'unknown',
      }
  }
}

function instanceClasses(status: WorkerStatus['status']): { dot: string; label: string; chip: string } {
  if (status === 'healthy') {
    return {
      dot: 'bg-emerald-400',
      label: 'healthy',
      chip: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/25',
    }
  }
  if (status === 'unhealthy') {
    return {
      dot: 'bg-amber-400',
      label: 'unhealthy',
      chip: 'bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/25',
    }
  }
  return {
    dot: 'bg-red-500',
    label: 'down',
    chip: 'bg-red-500/10 text-red-300 ring-1 ring-red-500/25',
  }
}

// Strip `http://` and trailing `/healthz` so the host column is readable
// without sacrificing the underlying detail (full URL stays in title=).
function shortHost(rawUrl: string): string {
  let s = rawUrl.replace(/^https?:\/\//, '')
  s = s.replace(/\/healthz\/?$/, '')
  return s
}

function fmtLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return `${Math.round(ms)} ms`
}

export function BackgroundWorkersCard({ health, retained = false, loading = false }: BackgroundWorkersCardProps) {
  const { t } = useTranslation()
  const workers: WorkerStatus[] = health?.workers ?? []
  const groups = groupByName(workers)
  const totalInstances = workers.length
  const healthyInstances = workers.filter((w) => w.status === 'healthy').length
  const groupCount = groups.length
  const healthyGroups = groups.filter((g) => g.severity === 'healthy').length
  const multiInstanceGroups = groups.filter((g) => g.total > 1).length
  const summary = (
    <SystemSummaryBrief
      title={t('systemStatus.bgWorkers', 'Background workers')}
      description={t('systemStatus.workersBrief.description', 'Reported worker types, healthy replicas, and replicated types from the worker health response.')}
      scope={t('systemStatus.workersBrief.scope', 'Reported instances only; this response does not prove unreported replicas are healthy.')}
      available={health != null} retained={retained} loading={loading}
      metrics={[
        { metricId: 'count', occurrenceId: 'types', rawValue: health ? healthyGroups : null,
          label: t('systemStatus.workersCopy.types', 'Worker types'), display: { countTotal: groupCount },
          context: t('systemStatus.workersCopy.typeCounts', '{{healthy}} of {{total}} types', { healthy: healthyGroups, total: groupCount }) },
        { metricId: 'count', occurrenceId: 'instances', rawValue: health ? healthyInstances : null,
          label: t('systemStatus.workersCopy.instances', 'Instances'), display: { countTotal: totalInstances },
          context: t('systemStatus.workersCopy.instanceCounts', '{{healthy}} of {{total}} instances', { healthy: healthyInstances, total: totalInstances }) },
        { metricId: 'count', occurrenceId: 'replicated', rawValue: health ? multiInstanceGroups : null,
          label: t('systemStatus.workersCopy.replicated', 'Replicated'), display: { countTotal: groupCount },
          context: multiInstanceGroups > 0
            ? groupCount === 1
              ? t('systemStatus.workersCopy.replicatedType', '{{replicated}} of {{total}} type', { replicated: multiInstanceGroups, total: groupCount })
              : t('systemStatus.workersCopy.replicatedTypes', '{{replicated}} of {{total}} types', { replicated: multiInstanceGroups, total: groupCount })
            : t('systemStatus.workersCopy.singleEach', 'single instance each') },
      ]}
    />
  )

  if (!health || workers.length === 0) {
    return (
      <div className="space-y-3">
        {summary}
        <Text as="p" variant="bodySm" className="rounded-lg bg-white/[0.03] p-4">
          {!health
            ? t('systemStatus.workersCopy.unavailable', 'Background worker health is unavailable.')
            : t('systemStatus.workersCopy.empty', 'No background workers reporting. Ensure the notification, export, and automation worker processes are running and reachable on their configured ports.')}
        </Text>
      </div>
    )
  }


  return (
    <div className="space-y-4">
      {/* Top-line summary — types vs. instances. The two-axis count is the
          key differentiator for horizontally-scaled deployments: the
          operator needs to see *which replicas* are healthy, not just that
          some replica answered. */}
      {summary}

      {/* Per-worker-name groups, each containing 1..N instance rows. */}
      <ul className="space-y-3">
        {groups.map((g) => {
          const groupCls = severityClasses(g.severity)
          const isMulti = g.total > 1
          return (
            <li
              key={g.name}
              className="overflow-hidden rounded-lg bg-white/[0.03] ring-1 ring-white/[0.05]"
            >
              {/* Group header */}
              <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.05] bg-white/[0.02] px-3 py-2">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${groupCls.dot}`}
                  role="img"
                  aria-label={t('systemStatus.workersCopy.groupStatus', '{{name}} status: {{status}}', {
                    name: g.name,
                    status: t(`systemStatus.workerStates.${g.severity}`, groupCls.label),
                  })}
                />
                <Boxes className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
                <Text size="sm" weight="medium" color="primary" className="min-w-0 break-words">{g.name}</Text>
                <Text
                  size="xs"
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${groupCls.chip}`}
                >
                  {t('systemStatus.summary.healthy', '{{healthy}} / {{total}} healthy', { healthy: g.healthy, total: g.total })}
                </Text>
                <Caption className="ms-auto">
                  {isMulti
                    ? t('systemStatus.workersCopy.instanceCount', '{{count}} instances', { count: g.total })
                    : t('systemStatus.workersCopy.oneInstance', '1 instance')}
                </Caption>
              </div>

              {/* Per-instance rows */}
              <ul className="divide-y divide-white/[0.05]">
                {g.instances.map((inst) => {
                  const cls = instanceClasses(inst.status)
                  const host = shortHost(inst.host)
                  return (
                    <li
                      key={`${inst.name}::${inst.host}`}
                      className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${cls.dot}`}
                          role="img"
                          aria-label={t('systemStatus.workersCopy.instanceStatus', 'instance status: {{status}}', {
                            status: t(`systemStatus.workerInstanceStates.${cls.label}`, cls.label),
                          })}
                        />
                        <Server className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden />
                        <Text
                          mono size="xs" color="primary"
                          className="min-w-0 break-all"
                          title={inst.host}
                        >
                          {host}
                        </Text>
                      </div>

                      <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                        <Text
                          size="xs"
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${cls.chip}`}
                        >
                          {t(`systemStatus.workerInstanceStates.${cls.label}`, cls.label)}
                        </Text>
                        <Caption className="w-16 text-end tabular-nums">
                          {fmtLatency(inst.latency_ms)}
                        </Caption>
                      </div>

                      {inst.error && (
                        <div className="basis-full sm:basis-full">
                          <Text as="div" size="xs" className="mt-1 flex items-start gap-1.5 rounded-md bg-red-500/10 px-2 py-1 text-red-300 ring-1 ring-red-500/25">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                            <span className="break-all">{inst.error}</span>
                          </Text>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ul>

      {/* Footer guidance: explain how to scale, since most operators won't
          know the *_HOSTS env contract until the panel tells them. */}
      {multiInstanceGroups === 0 && (
        <Text as="p" variant="caption" className="break-words rounded-md bg-white/[0.02] p-2.5 ring-1 ring-white/[0.05]">
          <Trans
            i18nKey="systemStatus.workersCopy.replicationGuidance"
            defaults="Running multiple instances of a worker? Set <notification>{{notification}}</notification>, <export>{{export}}</export>, or <automation>{{automation}}</automation> to a comma-separated list of hostnames. Each instance will then appear here with its own status and latency."
            values={{
              notification: 'NOTIFICATION_WORKER_HOSTS',
              export: 'EXPORT_WORKER_HOSTS',
              automation: 'AUTOMATION_WORKER_HOSTS',
            }}
            components={{ notification: <Code />, export: <Code />, automation: <Code /> }}
          >
            Running multiple instances of a worker? Set{' '}
            <Code>NOTIFICATION_WORKER_HOSTS</Code>,{' '}
            <Code>EXPORT_WORKER_HOSTS</Code>, or{' '}
            <Code>AUTOMATION_WORKER_HOSTS</Code> to a comma-separated list of hostnames. Each instance will then appear here with its own status and latency.
          </Trans>
        </Text>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
        <Link
          to="/api-logs"
          className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-cyan-300 hover:bg-white/[0.04]', typography.size.xs)}
        >
          <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('systemStatus.workersCopy.apiLogs', 'API logs')}
        </Link>
      </div>
    </div>
  )
}
