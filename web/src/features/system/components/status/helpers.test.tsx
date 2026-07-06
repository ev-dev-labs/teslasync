/**
 * status/helpers — behaviour, branch, a11y, null-safety & regression coverage
 * for every export of the System Status helper module.
 *
 * These are pure functions (plus one stateless icon factory) with no network,
 * router, or settings dependency, so a bare render()/direct call is enough —
 * `@testing-library/user-event` is intentionally NOT a dependency of this repo
 * (see AccordionSection.test.tsx), and there is nothing interactive here anyway.
 *
 * The suite pins the bugs the hardening pass fixed:
 *   - CONSISTENCY: statusToBadgeVariant dropped 'connected' from its success
 *     set while getStatusColor / statusTextClass / getStatusIcon all treat it
 *     as success — a healthy DB/MQTT "connected" status rendered a grey neutral
 *     badge instead of a green one.
 *   - OVERFLOW: formatBytes indexed sizes[i] past the array for >= 1 PB
 *     ("1.0 undefined") and produced garbage for negative / non-finite input.
 *   - NEGATIVE / NaN: formatUptime emitted "NaNm" / "-1d …" for missing or
 *     clock-skewed uptime values.
 *   - A11Y: getStatusIcon rendered a bare decorative <svg> with no aria-hidden.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react'

import {
  getStatusColor,
  statusTextClass,
  getStatusIcon,
  formatUptime,
  formatBytes,
  statusToBadgeVariant,
} from './helpers'

const SUCCESS = ['healthy', 'ok', 'online', 'connected', 'ready', 'sent', 'completed']
const WARNING = ['degraded', 'warning', 'pending', 'queued', 'processing']
const DANGER = ['unhealthy', 'offline', 'error', 'down', 'failed']

describe('getStatusColor', () => {
  it('maps every success status to green', () => {
    for (const s of SUCCESS) expect(getStatusColor(s)).toBe('#22c55e')
  })

  it('maps warning and danger statuses to amber and red', () => {
    for (const s of WARNING) expect(getStatusColor(s)).toBe('#f59e0b')
    for (const s of DANGER) expect(getStatusColor(s)).toBe('#ef4444')
  })

  it('is case-insensitive', () => {
    expect(getStatusColor('HEALTHY')).toBe('#22c55e')
    expect(getStatusColor('Warning')).toBe('#f59e0b')
    expect(getStatusColor('ERROR')).toBe('#ef4444')
  })

  it('falls back to grey for unknown, empty, and nullish input', () => {
    expect(getStatusColor('bananas')).toBe('#6b7280')
    expect(getStatusColor('')).toBe('#6b7280')
    // Guards runtime null/undefined arriving from untyped API payloads.
    expect(getStatusColor(null as unknown as string)).toBe('#6b7280')
    expect(getStatusColor(undefined as unknown as string)).toBe('#6b7280')
  })
})

describe('statusTextClass', () => {
  it('returns the matching tone class per severity bucket', () => {
    expect(statusTextClass('online')).toBe('text-green-400')
    expect(statusTextClass('pending')).toBe('text-amber-400')
    expect(statusTextClass('failed')).toBe('text-red-400')
  })

  it('uses the theme muted var (not a raw text-white/gray) for the default', () => {
    expect(statusTextClass('mystery')).toBe('text-[var(--text-muted)]')
    expect(statusTextClass(null as unknown as string)).toBe('text-[var(--text-muted)]')
  })
})

describe('getStatusIcon', () => {
  it('returns the correct icon component for each severity bucket', () => {
    for (const s of SUCCESS) expect(getStatusIcon(s).type).toBe(CheckCircle)
    for (const s of WARNING) expect(getStatusIcon(s).type).toBe(AlertTriangle)
    for (const s of DANGER) expect(getStatusIcon(s).type).toBe(XCircle)
  })

  it('defaults unknown/nullish status to the warning triangle', () => {
    expect(getStatusIcon('unknown').type).toBe(AlertTriangle)
    expect(getStatusIcon(null as unknown as string).type).toBe(AlertTriangle)
  })

  it('threads the status tone class through to the icon', () => {
    expect(getStatusIcon('healthy').props.className).toContain('text-green-400')
    expect(getStatusIcon('healthy').props.className).toContain('h-4 w-4')
    expect(getStatusIcon('error').props.className).toContain('text-red-400')
  })

  it('marks the decorative icon aria-hidden and renders an actual <svg>', () => {
    expect(getStatusIcon('online').props['aria-hidden']).toBe('true')

    const { container } = render(getStatusIcon('online'))
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg?.getAttribute('class')).toContain('text-green-400')
  })
})

describe('formatUptime', () => {
  it('renders days/hours/minutes once uptime exceeds a day', () => {
    // 2d 3h 4m => 2*86400 + 3*3600 + 4*60 = 183840
    expect(formatUptime(183840)).toBe('2d 3h 4m')
  })

  it('drops the day segment below 24h and the hour segment below 1h', () => {
    // 5h 6m => 5*3600 + 6*60 = 18360
    expect(formatUptime(18360)).toBe('5h 6m')
    // 7m => 7*60 = 420
    expect(formatUptime(420)).toBe('7m')
    expect(formatUptime(0)).toBe('0m')
  })

  it('floors fractional seconds to whole minutes', () => {
    expect(formatUptime(90.9)).toBe('1m')
  })

  it('clamps negative and non-finite input to 0m (no "NaNm" / "-1d")', () => {
    expect(formatUptime(-500)).toBe('0m')
    expect(formatUptime(Number.NaN)).toBe('0m')
    expect(formatUptime(Infinity)).toBe('0m')
    expect(formatUptime(undefined as unknown as number)).toBe('0m')
  })
})

describe('formatBytes', () => {
  it('formats within each binary unit at one decimal place', () => {
    expect(formatBytes(512)).toBe('512.0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB')
  })

  it('extends into PB and never overflows the unit table (no "undefined")', () => {
    expect(formatBytes(3 * 1024 ** 5)).toBe('3.0 PB')
    // Beyond an exabyte the index is clamped to PB rather than reading past
    // the array — the pre-fix bug rendered "… undefined" here.
    const huge = formatBytes(1024 ** 7)
    expect(huge).toContain('PB')
    expect(huge).not.toContain('undefined')
  })

  it('treats zero, negative and non-finite byte counts as 0 B', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1024)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(Infinity)).toBe('0 B')
    expect(formatBytes(undefined as unknown as number)).toBe('0 B')
  })

  it('keeps sub-1-byte fractional values in the B bucket', () => {
    // Pre-fix this floored the index to -1 and read sizes[-1] === undefined.
    expect(formatBytes(0.5)).toBe('0.5 B')
  })
})

describe('statusToBadgeVariant', () => {
  it('maps each severity bucket to its badge variant', () => {
    for (const s of WARNING) expect(statusToBadgeVariant(s)).toBe('warning')
    for (const s of DANGER) expect(statusToBadgeVariant(s)).toBe('danger')
  })

  it('treats "connected" as success alongside the other healthy statuses', () => {
    // Regression: 'connected' (a real DB/MQTT status) used to fall through to
    // 'neutral' while the sibling helpers all treated it as success.
    expect(statusToBadgeVariant('connected')).toBe('success')
    for (const s of SUCCESS) expect(statusToBadgeVariant(s)).toBe('success')
  })

  it('returns neutral for unknown, empty and nullish status', () => {
    expect(statusToBadgeVariant('weird')).toBe('neutral')
    expect(statusToBadgeVariant('')).toBe('neutral')
    expect(statusToBadgeVariant(null as unknown as string)).toBe('neutral')
  })
})

describe('status helper consistency', () => {
  // All four status helpers must agree on which bucket a status belongs to,
  // otherwise the same status renders green text but a grey badge (etc.).
  const iconBucket = (s: string) => {
    const t = getStatusIcon(s).type
    if (t === CheckCircle) return 'success'
    if (t === XCircle) return 'danger'
    return 'warning-or-default'
  }

  it('classifies every success status identically across all helpers', () => {
    for (const s of SUCCESS) {
      expect(getStatusColor(s)).toBe('#22c55e')
      expect(statusTextClass(s)).toBe('text-green-400')
      expect(statusToBadgeVariant(s)).toBe('success')
      expect(iconBucket(s)).toBe('success')
    }
  })

  it('classifies every danger status identically across all helpers', () => {
    for (const s of DANGER) {
      expect(getStatusColor(s)).toBe('#ef4444')
      expect(statusTextClass(s)).toBe('text-red-400')
      expect(statusToBadgeVariant(s)).toBe('danger')
      expect(iconBucket(s)).toBe('danger')
    }
  })
})
