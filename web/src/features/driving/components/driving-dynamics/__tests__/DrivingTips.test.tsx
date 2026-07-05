/**
 * DrivingTips — per-tip tone/icon regression + branch coverage.
 *
 * Pre-fix bug:
 *   Every tip row rendered a single icon chosen from ONE global signal
 *   (`throttleStyle === 'conservative' ? ShieldCheck : AlertTriangle`).
 *   Two consequences fell out of that:
 *     1. The "Drive your vehicle to start collecting dynamics data."
 *        informational prompt (shown when motorStats is null, and
 *        throttleStyle is therefore null) rendered a red-flag
 *        AlertTriangle — a warning glyph on a neutral onboarding hint.
 *     2. A genuinely *conservative* driver whose motor is running hot
 *        (maxMotorTemp > 120) got a reassuring green ShieldCheck on the
 *        "Motor temps are running high…" caution — the warning was
 *        visually disguised as an all-clear.
 *
 * Post-fix (this suite pins it):
 *   Each tip carries its own semantic `tone` ('info' | 'positive' |
 *   'caution'); the icon is derived from that tone, so the glyph always
 *   matches the message. The `throttleStyle` prop — the buggy global
 *   signal — is removed entirely; tone is a pure function of the tip.
 *
 * The component is presentational (no network, no interactive controls),
 * so these tests exercise every generation branch, the tone→icon
 * mapping, null-safety, and the list/heading accessibility contract.
 * i18n is stubbed to echo the English `defaultValue` (matches the
 * sibling SummaryStats / MotorEfficiencyInsights tests).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

import DrivingTips from '../DrivingTips'
import type { MotorStats } from '../helpers'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

function makeStats(overrides: Partial<MotorStats> = {}): MotorStats {
  return {
    totalReadings: 100,
    avgTorque: 50,
    maxTorque: 200,
    avgMotorTemp: 40,
    maxMotorTemp: 60,
    avgPower: 0,
    peakPower: 0,
    minPower: 0,
    peakRegen: 0,
    highTorquePct: 10,
    ...overrides,
  }
}

/** Expected lucide class per tone (createLucideIcon → `lucide-<kebab>`). */
const TONE_ICON_CLASS: Record<string, string> = {
  info: 'lucide-lightbulb',
  positive: 'lucide-shield-check',
  caution: 'lucide-triangle-alert',
}

function getTipItems(): HTMLElement[] {
  const list = screen.getByRole('list')
  return within(list).getAllByRole('listitem')
}

function toneOf(li: HTMLElement): string | null {
  return li.getAttribute('data-tone')
}

function iconClassOf(li: HTMLElement): string {
  const svg = li.querySelector('svg')
  return svg?.getAttribute('class') ?? ''
}

describe('DrivingTips — panel + accessibility', () => {
  it('always renders the panel heading, even with no data', () => {
    render(<DrivingTips motorStats={null} />)
    const heading = screen.getByRole('heading', { name: /Driving Style Recommendations/i })
    expect(heading).toBeInTheDocument()
    expect(heading.tagName).toBe('H3')
  })

  it('exposes the tips as a semantic list with one <li> per tip', () => {
    render(<DrivingTips motorStats={makeStats({ avgPower: 120 })} />)
    const list = screen.getByRole('list')
    expect(list.tagName).toBe('UL')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
  })

  it('marks every tip icon decorative (aria-hidden) so screen readers rely on the text', () => {
    render(<DrivingTips motorStats={makeStats({ avgPower: 5 })} />)
    const items = getTipItems()
    for (const li of items) {
      const svg = li.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
    }
  })
})

describe('DrivingTips — no-data / info branch', () => {
  it('renders exactly the onboarding hint when motorStats is null', () => {
    render(<DrivingTips motorStats={null} />)
    expect(
      screen.getByText('Drive your vehicle to start collecting dynamics data.'),
    ).toBeInTheDocument()
    const items = getTipItems()
    expect(items).toHaveLength(1)
  })

  it('shows the info (Lightbulb) icon — NOT a warning triangle — for the onboarding hint (regression)', () => {
    render(<DrivingTips motorStats={null} />)
    const [li] = getTipItems()
    expect(toneOf(li)).toBe('info')
    expect(iconClassOf(li)).toContain(TONE_ICON_CLASS.info)
    // Pre-fix this row rendered AlertTriangle because throttleStyle was null.
    const list = screen.getByRole('list')
    expect(list.querySelector('.lucide-triangle-alert')).toBeNull()
  })
})

describe('DrivingTips — power branches', () => {
  it('aggressive power (>80) → two caution tips about easing off', () => {
    render(<DrivingTips motorStats={makeStats({ avgPower: 95 })} />)
    expect(
      screen.getByText('Ease into the accelerator — gradual inputs save energy and tire wear.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Brake earlier and lighter to improve regen capture.'),
    ).toBeInTheDocument()
    const items = getTipItems()
    expect(items).toHaveLength(2)
    expect(items.map(toneOf)).toEqual(['caution', 'caution'])
    expect(items.every((li) => iconClassOf(li).includes(TONE_ICON_CLASS.caution))).toBe(true)
  })

  it('moderate power (>20, <=80) → two smooth-throttle caution tips', () => {
    render(<DrivingTips motorStats={makeStats({ avgPower: 45 })} />)
    expect(
      screen.getByText('Smooth throttle transitions can improve efficiency by 10–15%.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Lift off the pedal earlier to let regen do the work.')).toBeInTheDocument()
    expect(getTipItems().map(toneOf)).toEqual(['caution', 'caution'])
  })

  it('economical power (<=20) → two positive tips with the green shield icon', () => {
    render(<DrivingTips motorStats={makeStats({ avgPower: 12 })} />)
    expect(
      screen.getByText('Excellent driving style! Maintaining this maximizes range and comfort.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Keep monitoring your scores — consistency is key.')).toBeInTheDocument()
    const items = getTipItems()
    expect(items.map(toneOf)).toEqual(['positive', 'positive'])
    expect(items.every((li) => iconClassOf(li).includes(TONE_ICON_CLASS.positive))).toBe(true)
  })
})

describe('DrivingTips — branch boundaries', () => {
  it('avgPower === 80 is NOT aggressive → falls through to the moderate tips', () => {
    render(<DrivingTips motorStats={makeStats({ avgPower: 80 })} />)
    expect(
      screen.getByText('Smooth throttle transitions can improve efficiency by 10–15%.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Ease into the accelerator — gradual inputs save energy and tire wear.'),
    ).toBeNull()
  })

  it('avgPower === 20 is NOT moderate → falls through to the positive tips', () => {
    render(<DrivingTips motorStats={makeStats({ avgPower: 20 })} />)
    expect(
      screen.getByText('Excellent driving style! Maintaining this maximizes range and comfort.'),
    ).toBeInTheDocument()
    // The praise row keeps a positive tone — pre-fix a moderate
    // throttleStyle at this boundary painted it with a warning triangle.
    expect(getTipItems().every((li) => toneOf(li) === 'positive')).toBe(true)
  })
})

describe('DrivingTips — thermal caution', () => {
  it('appends a caution thermal tip when maxMotorTemp > 120', () => {
    render(<DrivingTips motorStats={makeStats({ avgPower: 12, maxMotorTemp: 135 })} />)
    const items = getTipItems()
    expect(items).toHaveLength(3)
    expect(
      screen.getByText('Motor temps are running high — consider easing off sustained high power.'),
    ).toBeInTheDocument()
  })

  it('keeps the praise rows positive while the thermal warning stays caution (regression)', () => {
    render(<DrivingTips motorStats={makeStats({ avgPower: 12, maxMotorTemp: 135 })} />)
    const tones = getTipItems().map(toneOf)
    // Pre-fix ALL three rows shared one icon (green shield for a
    // conservative driver) — hiding the thermal warning. Now the
    // warning row is independently a caution.
    expect(tones).toEqual(['positive', 'positive', 'caution'])
    const list = screen.getByRole('list')
    expect(list.querySelector('.lucide-shield-check')).not.toBeNull()
    expect(list.querySelector('.lucide-triangle-alert')).not.toBeNull()
  })

  it('does NOT append the thermal tip when maxMotorTemp <= 120', () => {
    render(<DrivingTips motorStats={makeStats({ avgPower: 12, maxMotorTemp: 120 })} />)
    expect(
      screen.queryByText('Motor temps are running high — consider easing off sustained high power.'),
    ).toBeNull()
    expect(getTipItems()).toHaveLength(2)
  })
})

describe('DrivingTips — null-safety', () => {
  it('treats a missing avgPower/maxMotorTemp as 0 without throwing', () => {
    // The MotorStats contract types these as numbers, but upstream JSON
    // can lie; the component coalesces to 0 so a partial payload still
    // lands in the positive branch instead of crashing on comparison.
    const partial = {
      ...makeStats(),
      avgPower: undefined,
      maxMotorTemp: undefined,
    } as unknown as MotorStats
    expect(() => render(<DrivingTips motorStats={partial} />)).not.toThrow()
    expect(
      screen.getByText('Excellent driving style! Maintaining this maximizes range and comfort.'),
    ).toBeInTheDocument()
    expect(getTipItems().every((li) => toneOf(li) === 'positive')).toBe(true)
  })
})
