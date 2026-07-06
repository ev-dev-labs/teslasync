/**
 * DriveScore — behaviour, scoring maths, null-safety and a11y coverage.
 *
 * Three exports are exercised:
 *   - computeDriveScore(): pure scoring maths over SI-canonical drive fields,
 *     including the num()-hardening that stops NaN/null poisoning the result.
 *   - getScoreColor(): the bad/warn/good tier mapping + non-finite fail-closed.
 *   - <DriveScore>: the gauge + breakdown component, its screen-reader
 *     semantics (role="img" gauge, role="progressbar" bars) and its
 *     score-tier colouring.
 *
 * i18n is mocked to return the English fallback (with {{var}} interpolation)
 * and useMotionPreference is mocked so both the animated and the
 * prefers-reduced-motion branches are deterministically reachable.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DriveScore, computeDriveScore, getScoreColor } from './DriveScore'
import { COLOR } from '@/lib/colors'
import { useMotionPreference } from '@/hooks/useMotionPreference'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | undefined, opts?: Record<string, unknown>) => {
      let tpl = fallback ?? ''
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          tpl = tpl.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
        }
      }
      return tpl
    },
  }),
}))

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: vi.fn(() => ({ reduce: false, durationMs: 250 })),
}))

// The documented "defaults" result — an empty drive falls back to
// 100→100 battery, 0 distance/duration. Reused as the expected value for
// every input that must collapse to defaults (NaN, null, undefined).
const DEFAULTS = { total: 23, efficiency: 13, speed: 10, range: 0, trip: 0 }

// A long, efficient, smooth trip: 50km at ~150 Wh/km, no explicit max speed.
const GOOD_DRIVE = {
  distance_m: 50_000,
  duration_s: 2_400,
  start_battery_pct: 90,
  end_battery_pct: 80,
}
const GOOD_RESULT = { total: 98, efficiency: 40, speed: 20, range: 18, trip: 20 }

beforeEach(() => {
  vi.mocked(useMotionPreference).mockReturnValue({ reduce: false, durationMs: 250 })
})

describe('computeDriveScore — scoring maths', () => {
  it('scores an empty drive from the documented defaults', () => {
    expect(computeDriveScore({})).toEqual(DEFAULTS)
  })

  it('rewards an efficient long smooth trip with a near-perfect score', () => {
    const result = computeDriveScore(GOOD_DRIVE)
    expect(result).toEqual(GOOD_RESULT)
    expect(result.total).toBeGreaterThanOrEqual(90)
  })

  it('treats camelCase aliases identically to snake_case fields', () => {
    const camel = computeDriveScore({
      distanceM: 50_000,
      durationS: 2_400,
      startBatteryPct: 90,
      endBatteryPct: 80,
    })
    expect(camel).toEqual(computeDriveScore(GOOD_DRIVE))
    expect(camel).toEqual(GOOD_RESULT)
  })

  it('prefers snake_case over camelCase when both are present', () => {
    // distance_m (50km) must win over distanceM (1km) — trip plateaus at 50km.
    const result = computeDriveScore({
      ...GOOD_DRIVE,
      distanceM: 1_000,
    })
    expect(result).toEqual(GOOD_RESULT)
    expect(result.trip).toBe(20)
  })

  it('penalises erratic driving with a low avg/max speed ratio', () => {
    // 30km in 1h → avg ~8.3 m/s but a 35 m/s spike → poor speed discipline.
    const erratic = computeDriveScore({
      distance_m: 30_000,
      duration_s: 3_600,
      max_speed_mps: 35,
      start_battery_pct: 80,
      end_battery_pct: 74,
    })
    const smooth = computeDriveScore({
      distance_m: 30_000,
      duration_s: 3_600,
      start_battery_pct: 80,
      end_battery_pct: 74,
    })
    expect(erratic.speed).toBe(5)
    expect(smooth.speed).toBe(20)
    expect(erratic.speed).toBeLessThan(smooth.speed)
  })

  it('clamps every component and the total into range for extreme input', () => {
    // Absurd distance + zero battery use would overshoot without clamps.
    const result = computeDriveScore({
      distance_m: 10_000_000,
      duration_s: 1,
      start_battery_pct: 100,
      end_battery_pct: 100,
    })
    expect(result.total).toBeLessThanOrEqual(100)
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.efficiency).toBeLessThanOrEqual(40)
    expect(result.speed).toBeLessThanOrEqual(20)
    expect(result.range).toBeLessThanOrEqual(20)
    expect(result.trip).toBeLessThanOrEqual(20)
  })
})

describe('computeDriveScore — hardening (bug fixes)', () => {
  it('coerces NaN inputs to defaults instead of propagating NaN', () => {
    const result = computeDriveScore({
      distance_m: NaN,
      duration_s: NaN,
      start_battery_pct: NaN,
      end_battery_pct: NaN,
    })
    expect(result).toEqual(DEFAULTS)
    // Every field must be a finite number — never NaN in the gauge.
    for (const v of Object.values(result)) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('never throws and falls back to defaults for a null or undefined drive', () => {
    expect(() => computeDriveScore(null)).not.toThrow()
    expect(() => computeDriveScore(undefined)).not.toThrow()
    expect(computeDriveScore(null)).toEqual(DEFAULTS)
    expect(computeDriveScore(undefined)).toEqual(DEFAULTS)
  })
})

describe('getScoreColor', () => {
  it('maps score tiers to bad / warn / good boundaries', () => {
    const cases: Array<[number, string]> = [
      [0, COLOR.BAD],
      [39, COLOR.BAD],
      [40, COLOR.WARN],
      [69, COLOR.WARN],
      [70, COLOR.GOOD],
      [100, COLOR.GOOD],
    ]
    for (const [score, expected] of cases) {
      expect(getScoreColor(score)).toBe(expected)
    }
  })

  it('fails closed to the bad colour for a non-finite score', () => {
    expect(getScoreColor(NaN)).toBe(COLOR.BAD)
    expect(getScoreColor(Infinity)).toBe(COLOR.BAD)
    // Regression guard: NaN < 40 is false, so the old code returned GOOD.
    expect(getScoreColor(NaN)).not.toBe(COLOR.GOOD)
  })
})

describe('<DriveScore> — rendering', () => {
  it('renders the title, the score caption and the computed total', () => {
    render(<DriveScore drive={{}} />)
    expect(screen.getByText('Drive Score')).toBeInTheDocument()
    expect(screen.getByText('Score')).toBeInTheDocument()
    expect(screen.getByText(String(DEFAULTS.total))).toBeInTheDocument()
  })

  it('renders all four score-breakdown rows with their value / max readouts', () => {
    const { container } = render(<DriveScore drive={{}} />)
    expect(screen.getByText('Efficiency')).toBeInTheDocument()
    expect(screen.getByText('Speed Discipline')).toBeInTheDocument()
    expect(screen.getByText('Range Preservation')).toBeInTheDocument()
    expect(screen.getByText('Trip Length')).toBeInTheDocument()
    expect(container.textContent).toContain('13/40')
    expect(container.textContent).toContain('10/20')
    expect(container.textContent).toContain('0/20')
  })
})

describe('<DriveScore> — accessibility', () => {
  it('exposes the gauge as a labelled image for screen readers', () => {
    render(<DriveScore drive={{}} />)
    const gauge = screen.getByRole('img', {
      name: 'Drive score: 23 out of 100',
    })
    expect(gauge).toBeInTheDocument()
  })

  it('updates the gauge label with the actual score', () => {
    render(<DriveScore drive={GOOD_DRIVE} />)
    expect(
      screen.getByRole('img', { name: 'Drive score: 98 out of 100' }),
    ).toBeInTheDocument()
  })

  it('represents each breakdown as an accessible progressbar', () => {
    render(<DriveScore drive={{}} />)
    expect(screen.getAllByRole('progressbar')).toHaveLength(4)

    const efficiency = screen.getByRole('progressbar', { name: 'Efficiency' })
    expect(efficiency).toHaveAttribute('aria-valuenow', '13')
    expect(efficiency).toHaveAttribute('aria-valuemin', '0')
    expect(efficiency).toHaveAttribute('aria-valuemax', '40')

    const trip = screen.getByRole('progressbar', { name: 'Trip Length' })
    expect(trip).toHaveAttribute('aria-valuenow', '0')
    expect(trip).toHaveAttribute('aria-valuemax', '20')
  })
})

describe('<DriveScore> — score-tier colouring', () => {
  it('paints the gauge arc red for a poor score and green for a strong one', () => {
    const { container: poor } = render(<DriveScore drive={{}} />) // total 23 → BAD
    expect(poor.querySelector(`circle[stroke="${COLOR.BAD}"]`)).not.toBeNull()
    expect(poor.querySelector(`circle[stroke="${COLOR.GOOD}"]`)).toBeNull()

    const { container: strong } = render(<DriveScore drive={GOOD_DRIVE} />) // total 98 → GOOD
    expect(strong.querySelector(`circle[stroke="${COLOR.GOOD}"]`)).not.toBeNull()
  })
})

describe('<DriveScore> — reduced motion', () => {
  it('respects prefers-reduced-motion without dropping any content', () => {
    vi.mocked(useMotionPreference).mockReturnValue({ reduce: true, durationMs: 0 })
    render(<DriveScore drive={{}} />)

    expect(useMotionPreference).toHaveBeenCalled()
    // Content is identical whether or not motion is reduced.
    expect(screen.getByText(String(DEFAULTS.total))).toBeInTheDocument()
    expect(screen.getAllByRole('progressbar')).toHaveLength(4)
    expect(
      screen.getByRole('img', { name: 'Drive score: 23 out of 100' }),
    ).toBeInTheDocument()
  })
})
