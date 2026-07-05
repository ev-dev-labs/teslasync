/**
 * Pure aggregations for the Active Sessions page.
 *
 * Kept side-effect-free and hook-free so the page can `useMemo` over them and
 * the sub-components stay presentational. Everything is null-safe: an
 * undefined/empty list yields zeroed stats and empty breakdowns rather than
 * throwing.
 */

import type { ActiveSession } from '@/api/types'
import { parseUserAgent } from './deviceLabel'

/** A single grouped row for a breakdown panel (browser / platform / network). */
export interface BreakdownItem {
  /** Stable React key + group identity. */
  key: string
  /** Display label (proper noun or em-dash for "unknown"). */
  label: string
  /** Number of sessions in this group. */
  count: number
}

export interface SessionStats {
  total: number
  /** The session flagged `current` (this browser), if present. */
  current: ActiveSession | null
  /** Count of sessions other than the current one. */
  otherCount: number
  /** Most-recent `last_seen_at` across all sessions (ISO string) or null. */
  lastActive: string | null
  byBrowser: BreakdownItem[]
  byOS: BreakdownItem[]
  byNetwork: BreakdownItem[]
}

const UNKNOWN = '—'

/** Tally sessions by a derived key, sorted by count desc then label asc. */
function tally(
  sessions: readonly ActiveSession[],
  keyFn: (session: ActiveSession) => string,
): BreakdownItem[] {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const key = keyFn(session) || UNKNOWN
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** Derive KPI values + device breakdowns from the raw session list. */
export function computeSessionStats(
  sessions: readonly ActiveSession[] | null | undefined,
): SessionStats {
  const list = sessions ?? []

  const current = list.find((session) => session.current) ?? null
  const otherCount = list.filter((session) => !session.current).length

  // Track the running maximum as a parsed epoch so (a) an invalid timestamp
  // earlier in the list can't poison the result — `validTime > NaN` is always
  // false, which previously stuck `lastActive` on the first unparseable value
  // and hid every later real timestamp — and (b) we don't re-parse the current
  // winner on every iteration.
  let lastActive: string | null = null
  let lastActiveMs = Number.NEGATIVE_INFINITY
  for (const session of list) {
    const ts = session.last_seen_at
    if (!ts) continue
    const ms = new Date(ts).getTime()
    if (Number.isNaN(ms)) continue
    if (ms > lastActiveMs) {
      lastActiveMs = ms
      lastActive = ts
    }
  }

  return {
    total: list.length,
    current,
    otherCount,
    lastActive,
    byBrowser: tally(list, (session) => parseUserAgent(session.user_agent).browser ?? UNKNOWN),
    byOS: tally(list, (session) => parseUserAgent(session.user_agent).os ?? UNKNOWN),
    byNetwork: tally(list, (session) => session.ip || UNKNOWN),
  }
}
