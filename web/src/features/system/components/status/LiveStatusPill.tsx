/**
 * LiveStatusPill connection-state badge.
 *
 * Mounted next to the Refresh button on /system-status. Reflects the
 * SSE pump in useStatusLiveSSE:
 *
 *   • live          → green dot + "Live" — SSE flowing
 *   • reconnecting  → amber pulse + "Reconnecting" — last open errored
 *   • offline       → grey + "Offline" — gave up after backoff (will resume on visibility)
 *
 * Includes "Updated <relative>" so operators can verify the stream
 * hasn't silently stopped delivering.
 */

import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import type { StatusLiveState } from '../../hooks/useStatusLiveSSE'

interface LiveStatusPillProps {
  state: StatusLiveState
  lastUpdateAt: number | null
  /** "now" tick passed in so the relative label re-renders. */
  now: number
}

function relative(now: number, lastUpdateAt: number | null): string {
  if (lastUpdateAt == null) return '—'
  const secs = Math.max(0, Math.floor((now - lastUpdateAt) / 1000))
  // relative-time: shown only in the pill's tooltip and accessible name
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

const TONE: Record<StatusLiveState, { dot: string; pulse: boolean; label: string; cls: string }> = {
  live:         { dot: 'bg-green-400', pulse: false, label: 'Live', cls: 'text-green-300 bg-green-500/10 ring-green-400/30' },
  reconnecting: { dot: 'bg-amber-400', pulse: true,  label: 'Reconnecting',     cls: 'text-amber-200 bg-amber-500/10 ring-amber-400/30' },
  offline:      { dot: 'bg-zinc-400',  pulse: false, label: 'Offline',  cls: 'text-zinc-300 bg-zinc-500/10 ring-zinc-400/30' },
}

export function LiveStatusPill({ state, lastUpdateAt, now }: LiveStatusPillProps) {
  // Fall back to the offline tone if an unknown state slips through (e.g. an
  // untyped caller or a future StatusLiveState member added without a TONE
  // entry). This pill renders in the page actions slot, so an unguarded lookup
  // would crash the whole header rather than degrade gracefully.
  const tone = TONE[state] ?? TONE.offline
  const rel = useMemo(() => relative(now, lastUpdateAt), [now, lastUpdateAt])
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 tabular-nums',
        tone.cls,
      )}
      role="status"
      aria-live="polite"
      aria-label={`Live status stream: ${tone.label}, updated ${rel}`}
      title={`Updated ${rel}`}
      data-status-live-state={state}
    >
      {/* State dot + word; the update age lives in the tooltip, not as visible text. */}
      <span className={cn('inline-block h-2 w-2 rounded-full', tone.dot, tone.pulse && 'animate-pulse')} aria-hidden />
      <span>{tone.label}</span>
    </span>
  )
}
