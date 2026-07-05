/**
 * incidentPresentation — presentation-token + helper contract tests.
 *
 * incidentPresentation.ts is the framework-light source of truth for how the
 * per-incident timeline surface renders severity/status. It carries three
 * parallel Record maps, one duration formatter, and one i18n label hook, all
 * consumed in 3+ places (IncidentSeverityChip, IncidentTimelineList,
 * IncidentUpdateForm, IncidentTimelinePage). The value of a test here is to
 * LOCK the exact invariants each consumer silently relies on so a copy-paste
 * edit can't regress the UI without a red test. Each block mirrors a real
 * consumer:
 *   SEVERITY_TONE          → IncidentSeverityChip (`SEVERITY_TONE[severity] ?? .minor`;
 *                            `const Icon = tone.Icon; <Icon/>` + `tone.chip` utilities)
 *   STATUS_BADGE           → IncidentTimelineList / IncidentTimelinePage
 *                            (`<Badge variant={STATUS_BADGE[status] ?? 'neutral'}>`)
 *   STATUS_COLOR           → IncidentTimelinePage (`<MetricCard color={STATUS_COLOR[s] ?? 'cyan'}>`
 *                            → neonColorMap[color] lookup)
 *   fmtDuration            → IncidentTimelinePage (`fmtDuration(started_at, resolved_at)`,
 *                            open incident passes no end → "so far" from now)
 *   useIncidentStatusLabel → all three sub-components (`statusLabel(status)`)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import { AlertCircle, AlertTriangle, AlertOctagon } from 'lucide-react'
import { createElement } from 'react'

import { neonColorMap, type NeonColor } from '@/lib/tokens'
import type { IncidentSeverity, IncidentStatus } from '@/api/hooks/useIncidents'
import {
  SEVERITY_TONE,
  STATUS_BADGE,
  STATUS_COLOR,
  fmtDuration,
  useIncidentStatusLabel,
  type IncidentBadgeVariant,
} from './incidentPresentation'

// react-i18next → a STABLE `t` that echoes the developer fallback, so label
// output is deterministic under jsdom AND the returned resolver keeps a stable
// identity across renders (proving the hook's useCallback memoisation). Only
// useTranslation is overridden; every other real export is preserved for
// transitive importers. `vi.hoisted` lets the factory reference the shared fn
// despite vi.mock being hoisted above module-scope declarations.
const { stableT } = vi.hoisted(() => ({
  stableT: (key: string, fallback?: string) =>
    typeof fallback === 'string' ? fallback : key,
}))
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: stableT,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

// The unions the maps must cover — declared explicitly so the tests fail loudly
// if a union (and therefore a map's key set) ever changes.
const ALL_SEVERITIES: IncidentSeverity[] = ['minor', 'major', 'critical']
const ALL_STATUSES: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved']

// Badge does `variants[variant]` with NO fallback, so a STATUS_BADGE value
// outside this set renders an unstyled badge (mirrors Badge.tsx `variants`).
const BADGE_VARIANTS: IncidentBadgeVariant[] = ['warning', 'danger', 'info', 'success']

// A fixed base instant so relative durations are exact regardless of wall clock.
const BASE = Date.UTC(2024, 0, 1, 12, 0, 0)
const iso = (ms: number): string => new Date(ms).toISOString()

describe('SEVERITY_TONE — severity chip icon + tinted classes', () => {
  it('covers exactly the three severities, no more no less', () => {
    expect(Object.keys(SEVERITY_TONE).sort()).toEqual([...ALL_SEVERITIES].sort())
  })

  it('pins each severity to its escalating lucide icon', () => {
    expect(SEVERITY_TONE.minor.Icon).toBe(AlertCircle)
    expect(SEVERITY_TONE.major.Icon).toBe(AlertTriangle)
    expect(SEVERITY_TONE.critical.Icon).toBe(AlertOctagon)
  })

  it('gives every chip a bg + border + toned 300-level text triad (no raw neon body text)', () => {
    for (const sev of ALL_SEVERITIES) {
      const { chip } = SEVERITY_TONE[sev]
      expect(chip).toMatch(/\bbg-[a-z]+-500\/10\b/)
      expect(chip).toMatch(/\bborder-[a-z]+-500\/30\b/)
      expect(chip).toMatch(/\btext-[a-z]+-300\b/)
      // Never the saturated neon hue on the text itself (rule 11 body-text ban).
      expect(chip).not.toMatch(/text-neon-/)
    }
  })

  it('uses a hotter hue as severity escalates (amber → orange → rose)', () => {
    expect(SEVERITY_TONE.minor.chip).toContain('text-amber-300')
    expect(SEVERITY_TONE.major.chip).toContain('text-orange-300')
    expect(SEVERITY_TONE.critical.chip).toContain('text-rose-300')
  })

  it('exposes each Icon as a genuinely mountable component that renders an <svg>', () => {
    for (const sev of ALL_SEVERITIES) {
      const { container, unmount } = render(
        createElement(SEVERITY_TONE[sev].Icon, { 'aria-hidden': true }),
      )
      expect(container.querySelector('svg')).not.toBeNull()
      unmount()
    }
  })
})

describe('STATUS_BADGE — status → Badge variant', () => {
  it('covers exactly the four lifecycle statuses', () => {
    expect(Object.keys(STATUS_BADGE).sort()).toEqual([...ALL_STATUSES].sort())
  })

  it('pins the exact status → variant mapping (escalation semantics)', () => {
    expect(STATUS_BADGE).toEqual({
      investigating: 'danger',
      identified: 'warning',
      monitoring: 'info',
      resolved: 'success',
    })
  })

  it('maps every status to a variant the Badge component can actually render', () => {
    for (const status of ALL_STATUSES) {
      expect(BADGE_VARIANTS).toContain(STATUS_BADGE[status])
    }
  })
})

describe('STATUS_COLOR — status → neon MetricCard color', () => {
  it('covers exactly the four lifecycle statuses', () => {
    expect(Object.keys(STATUS_COLOR).sort()).toEqual([...ALL_STATUSES].sort())
  })

  it('pins the exact status → NeonColor mapping', () => {
    expect(STATUS_COLOR).toEqual({
      investigating: 'red',
      identified: 'amber',
      monitoring: 'cyan',
      resolved: 'green',
    })
  })

  it('maps every status to a real neonColorMap key (MetricCard/IconBox lookup contract)', () => {
    for (const status of ALL_STATUSES) {
      const color: NeonColor = STATUS_COLOR[status]
      expect(neonColorMap[color]).toBeDefined()
      expect(typeof neonColorMap[color].dot).toBe('string')
    }
  })

  it('keeps STATUS_COLOR and STATUS_BADGE key sets aligned', () => {
    expect(Object.keys(STATUS_COLOR).sort()).toEqual(Object.keys(STATUS_BADGE).sort())
  })
})

describe('fmtDuration — human "1h 5m" style span', () => {
  it('renders sub-minute spans in seconds, including a zero span', () => {
    expect(fmtDuration(iso(BASE), iso(BASE))).toBe('0s')
    expect(fmtDuration(iso(BASE), iso(BASE + 5_000))).toBe('5s')
    expect(fmtDuration(iso(BASE), iso(BASE + 59_000))).toBe('59s')
  })

  it('renders sub-hour spans in floored whole minutes', () => {
    expect(fmtDuration(iso(BASE), iso(BASE + 60_000))).toBe('1m')
    expect(fmtDuration(iso(BASE), iso(BASE + 90_000))).toBe('1m') // floors 90s → 1m
    expect(fmtDuration(iso(BASE), iso(BASE + 3_599_000))).toBe('59m')
  })

  it('renders sub-day spans as "Hh Mm"', () => {
    expect(fmtDuration(iso(BASE), iso(BASE + 3_600_000))).toBe('1h 0m')
    expect(fmtDuration(iso(BASE), iso(BASE + 3_661_000))).toBe('1h 1m')
    expect(fmtDuration(iso(BASE), iso(BASE + 86_399_000))).toBe('23h 59m')
  })

  it('renders multi-day spans as "Dd Hh" (minutes intentionally dropped)', () => {
    expect(fmtDuration(iso(BASE), iso(BASE + 86_400_000))).toBe('1d 0h')
    // 1d 1h 1m 1s → coarse "1d 1h"
    expect(fmtDuration(iso(BASE), iso(BASE + 90_061_000))).toBe('1d 1h')
  })

  it('clamps a negative span (end before start / clock skew) to "0s"', () => {
    expect(fmtDuration(iso(BASE), iso(BASE - 5_000))).toBe('0s')
  })

  it('returns "" for an unparseable start or end so callers can render "—"', () => {
    expect(fmtDuration('not-a-date', iso(BASE))).toBe('')
    expect(fmtDuration(iso(BASE), 'not-a-date')).toBe('')
    expect(fmtDuration('', 'also-bad')).toBe('')
  })

  describe('open-incident path (no / empty end → measured from now)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(BASE))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('defaults a missing end to Date.now()', () => {
      expect(fmtDuration(iso(BASE - 90_000))).toBe('1m')
      expect(fmtDuration(iso(BASE - 5_000))).toBe('5s')
    })

    it('treats an empty-string end (API "not resolved yet") as now, not epoch 0', () => {
      expect(fmtDuration(iso(BASE - 5_000), '')).toBe('5s')
    })
  })
})

describe('useIncidentStatusLabel — i18n status resolver', () => {
  it('resolves every known status to its translated label', () => {
    const { result } = renderHook(() => useIncidentStatusLabel())
    const label = result.current
    expect(label('investigating')).toBe('Investigating')
    expect(label('identified')).toBe('Identified')
    expect(label('monitoring')).toBe('Monitoring')
    expect(label('resolved')).toBe('Resolved')
  })

  it('falls back to the raw value for an unknown status (never renders blank)', () => {
    const { result } = renderHook(() => useIncidentStatusLabel())
    // A future/unmapped enum member arriving from the API.
    expect(result.current('postmortem' as IncidentStatus)).toBe('postmortem')
  })

  it('returns a stable resolver reference across re-renders (memoised for .map loops)', () => {
    const { result, rerender } = renderHook(() => useIncidentStatusLabel())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('exposes a callable resolver covering every declared status', () => {
    const { result } = renderHook(() => useIncidentStatusLabel())
    for (const status of ALL_STATUSES) {
      expect(typeof result.current(status)).toBe('string')
      expect(result.current(status).length).toBeGreaterThan(0)
    }
  })
})
