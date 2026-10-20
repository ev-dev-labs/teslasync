import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { LiveStatusPill } from '../LiveStatusPill'
import type { StatusLiveState } from '../../../hooks/useStatusLiveSSE'

/**
 * LiveStatusPill contract.
 *
 * A purely presentational connection-state badge (no query/router/i18n
 * providers required). It must:
 *   - map each StatusLiveState to the right label, dot colour, icon and pulse,
 *   - render the relative "updated Xs ago" label across every branch of the
 *     internal `relative()` helper (including clamping future timestamps),
 *   - expose a live-region role + descriptive aria-label for screen readers,
 *   - keep decorative glyphs out of the accessibility tree, and
 *   - degrade to the offline tone (never throw) when handed an unknown state.
 */

// A fixed "now" keeps the relative-label maths deterministic.
const NOW = 1_700_000_000_000

function renderPill(props: Partial<React.ComponentProps<typeof LiveStatusPill>> = {}) {
  return render(
    <LiveStatusPill state="live" lastUpdateAt={NOW - 42_000} now={NOW} {...props} />,
  )
}

describe('LiveStatusPill', () => {
  it('renders the live tone: green dot (no pulse), label and tone ring classes', () => {
    renderPill({ state: 'live' })
    const pill = screen.getByRole('status')

    expect(within(pill).getByText('Live')).toBeInTheDocument()
    expect(pill).toHaveAttribute('data-status-live-state', 'live')
    expect(pill.className).toContain('text-green-300')
    expect(pill.className).toContain('ring-green-400/30')

    const dot = pill.querySelector('.rounded-full.h-2, .h-2.w-2') as HTMLElement
    expect(dot.className).toContain('bg-green-400')
    // "live" is a steady state — the dot must NOT pulse.
    expect(pill.querySelector('.animate-pulse')).toBeNull()
  })

  it('renders the reconnecting tone with a pulsing amber dot', () => {
    renderPill({ state: 'reconnecting' })
    const pill = screen.getByRole('status')

    expect(within(pill).getByText('Reconnecting')).toBeInTheDocument()
    expect(pill).toHaveAttribute('data-status-live-state', 'reconnecting')
    expect(pill.className).toContain('text-amber-200')

    const pulsingDot = pill.querySelector('.animate-pulse') as HTMLElement
    expect(pulsingDot).not.toBeNull()
    expect(pulsingDot.className).toContain('bg-amber-400')
  })

  it('renders the offline tone with a grey, non-pulsing dot', () => {
    renderPill({ state: 'offline', lastUpdateAt: null })
    const pill = screen.getByRole('status')

    expect(within(pill).getByText('Offline')).toBeInTheDocument()
    expect(pill.className).toContain('text-zinc-300')
    expect(pill.querySelector('.animate-pulse')).toBeNull()
    expect(pill.querySelector('.bg-zinc-400')).not.toBeNull()
  })

  it('shows an em dash and never a stale timestamp when lastUpdateAt is null', () => {
    renderPill({ state: 'offline', lastUpdateAt: null })
    const pill = screen.getByRole('status')

    // The update age lives in the tooltip + accessible name, not as visible text.
    expect(pill).toHaveAttribute('title', 'Updated —')
    expect(pill.getAttribute('aria-label')).toContain('updated —')
    expect(pill.textContent).not.toMatch(/[0-9]/)
  })

  it('formats the relative label across every duration bucket', () => {
    const cases: Array<[number, string]> = [
      [2_000, 'just now'], // < 5s
      [42_000, '42s ago'], // < 60s
      [5 * 60_000 + 30_000, '5m ago'], // < 60m, floored
      [2 * 3_600_000 + 61_000, '2h ago'], // >= 60m, floored
    ]

    for (const [deltaMs, expected] of cases) {
      const { unmount } = renderPill({ state: 'live', lastUpdateAt: NOW - deltaMs })
      const pill = screen.getByRole('status')
      expect(pill).toHaveAttribute('title', `Updated ${expected}`)
      expect(pill.getAttribute('aria-label')).toContain(`updated ${expected}`)
      unmount()
    }
  })

  it('clamps a future timestamp (clock skew) to "just now" instead of a negative age', () => {
    renderPill({ state: 'live', lastUpdateAt: NOW + 10_000 })
    const pill = screen.getByRole('status')
    expect(pill).toHaveAttribute('title', 'Updated just now')
    expect(pill.getAttribute('aria-label')).toContain('updated just now')
  })

  it('exposes an accessible live region describing the state and freshness', () => {
    renderPill({ state: 'reconnecting', lastUpdateAt: NOW - 42_000 })
    const pill = screen.getByRole('status')

    expect(pill).toHaveAttribute('aria-live', 'polite')
    const label = pill.getAttribute('aria-label') ?? ''
    expect(label).toContain('Reconnecting')
    expect(label).toContain('42s ago')
  })

  it('keeps the decorative dot out of the accessibility tree', () => {
    renderPill({ state: 'live' })
    const pill = screen.getByRole('status')

    // The face carries only the tone word; the state dot is decorative.
    const hidden = pill.querySelectorAll('[aria-hidden="true"]')
    expect(hidden.length).toBe(1)
    expect(pill.textContent).toBe('Live')
  })

  it('degrades to the offline tone without throwing when given an unknown state', () => {
    const unknown = 'connecting' as unknown as StatusLiveState
    expect(() => renderPill({ state: unknown, lastUpdateAt: NOW })).not.toThrow()

    const pill = screen.getByRole('status')
    // Falls back to the offline visual tone …
    expect(pill.className).toContain('text-zinc-300')
    expect(within(pill).getByText('Offline')).toBeInTheDocument()
    // … while still reflecting the raw value for debugging.
    expect(pill).toHaveAttribute('data-status-live-state', 'connecting')
  })
})
