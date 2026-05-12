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

interface BackgroundWorkersCardProps {
  health: WorkersHealth | undefined
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
        dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
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
        dot: 'bg-white/30',
        chip: 'bg-white/[0.06] text-[var(--text-muted)] ring-1 ring-white/10',
        label: 'unknown',
      }
  }
}

function instanceClasses(status: WorkerStatus['status']): { dot: string; label: string; chip: string } {
  if (status === 'healthy') {
    return {
      dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.55)]',
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

export function BackgroundWorkersCard({ health }: BackgroundWorkersCardProps) {
  const workers: WorkerStatus[] = health?.workers ?? []
  const groups = groupByName(workers)

  if (!health || workers.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-white/[0.03] p-4 text-sm text-[var(--text-muted)]">
          No background workers reporting. Ensure the notification, export, and
          automation worker processes are running and reachable on their
          configured ports.
        </div>
      </div>
    )
  }

  const totalInstances = workers.length
  const healthyInstances = workers.filter((w) => w.status === 'healthy').length
  const groupCount = groups.length
  const healthyGroups = groups.filter((g) => g.severity === 'healthy').length
  const multiInstanceGroups = groups.filter((g) => g.total > 1).length

  return (
    <div className="space-y-4">
      {/* Top-line summary — types vs. instances. The two-axis count is the
          key differentiator for horizontally-scaled deployments: the
          operator needs to see *which replicas* are healthy, not just that
          some replica answered. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
        <div>
          <div className="text-xs text-[var(--text-muted)]">Worker types</div>
          <div className="tabular-nums text-[var(--text-primary)]">
            {healthyGroups} of {groupCount} types
          </div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">Instances</div>
          <div className="tabular-nums text-[var(--text-primary)]">
            {healthyInstances} of {totalInstances} instances
          </div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">Replicated</div>
          <div className="tabular-nums text-[var(--text-primary)]">
            {multiInstanceGroups > 0
              ? `${multiInstanceGroups} of ${groupCount} type${groupCount === 1 ? '' : 's'}`
              : 'single instance each'}
          </div>
        </div>
      </div>

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
                  aria-label={`${g.name} status: ${groupCls.label}`}
                />
                <Boxes className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
                <span className="font-medium text-[var(--text-primary)]">{g.name}</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${groupCls.chip}`}
                >
                  {g.healthy} / {g.total} healthy
                </span>
                <span className="ml-auto text-[11px] text-[var(--text-muted)]">
                  {isMulti ? `${g.total} instances` : '1 instance'}
                </span>
              </div>

              {/* Per-instance rows */}
              <ul className="divide-y divide-white/[0.05]">
                {g.instances.map((inst) => {
                  const cls = instanceClasses(inst.status)
                  const host = shortHost(inst.host)
                  return (
                    <li
                      key={`${inst.name}::${inst.host}`}
                      className="flex flex-col gap-1.5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${cls.dot}`}
                          aria-label={`instance status: ${cls.label}`}
                        />
                        <Server className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden />
                        <span
                          className="truncate font-mono text-xs text-[var(--text-primary)]"
                          title={inst.host}
                        >
                          {host}
                        </span>
                      </div>

                      <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${cls.chip}`}
                        >
                          {cls.label}
                        </span>
                        <span className="w-16 text-right text-[11px] tabular-nums text-[var(--text-muted)]">
                          {fmtLatency(inst.latency_ms)}
                        </span>
                      </div>

                      {inst.error && (
                        <div className="basis-full sm:basis-full">
                          <div className="mt-1 flex items-start gap-1.5 rounded-md bg-red-500/10 px-2 py-1 text-[11px] text-red-300 ring-1 ring-red-500/25">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                            <span className="break-all">{inst.error}</span>
                          </div>
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
        <div className="rounded-md bg-white/[0.02] p-2.5 text-[11px] text-[var(--text-muted)] ring-1 ring-white/[0.05]">
          Running multiple instances of a worker? Set{' '}
          <code className="font-mono text-[var(--text-primary)]">NOTIFICATION_WORKER_HOSTS</code>,{' '}
          <code className="font-mono text-[var(--text-primary)]">EXPORT_WORKER_HOSTS</code>, or{' '}
          <code className="font-mono text-[var(--text-primary)]">AUTOMATION_WORKER_HOSTS</code> to a
          comma-separated list of hostnames. Each instance will then appear
          here with its own status and latency.
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
        <Link
          to="/api-logs"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-cyan-300 hover:text-cyan-200 hover:bg-white/[0.04] min-h-[36px]"
        >
          <Activity className="h-3.5 w-3.5" />
          API logs
        </Link>
      </div>
    </div>
  )
}
