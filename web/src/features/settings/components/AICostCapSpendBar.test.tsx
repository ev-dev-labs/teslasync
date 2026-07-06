/**
 * AICostCapSpendBar — the live "today" cost-cap progress bar on the Helix
 * settings panel. It reads `/ai/usage/today` (via `useAiUsageToday`) and shows
 * how close the user is to their daily $ cap.
 *
 * These tests lock in the behaviour that matters for a *safety* surface:
 *
 *   1. micro-cents → dollars conversion + the "$spent / $cap" readout.
 *   2. The three colour/level branches (ok < 80% ≤ warn < 100% ≤ critical) and
 *      their matching hint copy + `data-spend-level` + fill class.
 *   3. `pct` is clamped to [0, 100] so a spend over the cap can never blow past
 *      100% or produce an out-of-range `aria-valuenow`.
 *   4. Loading and error states each render distinct copy — an error must NOT
 *      surface a falsely-reassuring "$0.00", because the cap is still enforced
 *      server-side even when we can't display the number.
 *   5. A corrupt / NaN payload degrades to 0% instead of `width: NaN%`.
 *   6. The progressbar exposes a proper a11y contract (role + aria-value* +
 *      aria-label).
 *
 * Network is mocked at the `@/api/client` boundary (same convention as
 * AIUsageCard.test.tsx); react-i18next is stubbed so `{{var}}` interpolation is
 * deterministic (same convention as ResetSection.test.tsx). No real network.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AiUsageToday } from '@/api/hooks/useAiUsage'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        let result = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            if (k === 'defaultValue') continue
            result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
        }
        return result
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { AICostCapSpendBar } from './AICostCapSpendBar'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

/** A fully-populated /ai/usage/today payload with an overridable cost. */
function todayPayload(costMicroCents: number): AiUsageToday {
  return {
    user_subject: 'auth0|abc',
    call_count: 42,
    input_tokens: 1000,
    output_tokens: 500,
    cost_micro_cents: costMicroCents,
    error_count: 0,
    avg_latency_ms: 120,
  }
}

function renderBar(capCents: number) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <AICostCapSpendBar capCents={capCents} />
    </QueryClientProvider>,
  )
}

function panel() {
  return screen.getByTestId('ai-cost-cap-spend-bar')
}

function progressbar() {
  return screen.getByRole('progressbar')
}

function fill() {
  // The single child of the progressbar is the animated fill div.
  return progressbar().firstElementChild as HTMLElement
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('AICostCapSpendBar — request wiring + conversion', () => {
  it('reads /ai/usage/today and renders the micro-cents → dollars readout', async () => {
    // 5_000_000 micro-cents = $5.00 spent; cap 1000 cents = $10.00 → 50%.
    mockedRequest.mockResolvedValue(todayPayload(5_000_000))
    renderBar(1000)

    expect(await screen.findByText('$5.00 / $10.00')).toBeInTheDocument()
    expect(mockedRequest).toHaveBeenCalledWith('/ai/usage/today', expect.anything())
    // A stray micro-cents/cents mix-up would show $500000 or $0.05 — pin the math.
    expect(screen.queryByText(/\$5000/)).not.toBeInTheDocument()
  })

  it('rounds fractional micro-cents to two decimal places', async () => {
    // 1_234_560 micro-cents = $1.23456 → $1.23. Cap $10.00.
    mockedRequest.mockResolvedValue(todayPayload(1_234_560))
    renderBar(1000)

    expect(await screen.findByText('$1.23 / $10.00')).toBeInTheDocument()
  })
})

describe('AICostCapSpendBar — level branches', () => {
  it('renders the "ok" level (< 80%) with no warning hints', async () => {
    mockedRequest.mockResolvedValue(todayPayload(5_000_000)) // 50%
    renderBar(1000)

    await screen.findByText('$5.00 / $10.00')
    expect(panel()).toHaveAttribute('data-spend-level', 'ok')
    expect(fill().className).toContain('bg-cyan-300')
    expect(progressbar()).toHaveAttribute('aria-valuenow', '50')
    expect(fill().style.width).toBe('50%')
    // No warn/critical hint copy at the "ok" level.
    expect(screen.queryByText(/nearing today/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Cap reached/i)).not.toBeInTheDocument()
  })

  it('renders the "warn" level (>= 80%) with the warn hint only', async () => {
    mockedRequest.mockResolvedValue(todayPayload(8_500_000)) // 85%
    renderBar(1000)

    await screen.findByText('$8.50 / $10.00')
    expect(panel()).toHaveAttribute('data-spend-level', 'warn')
    expect(fill().className).toContain('bg-amber-300')
    expect(progressbar()).toHaveAttribute('aria-valuenow', '85')
    expect(screen.getByText(/nearing today/i)).toBeInTheDocument()
    expect(screen.queryByText(/Cap reached/i)).not.toBeInTheDocument()
  })

  it('renders the "critical" level (>= 100%) with the critical hint and clamps to 100%', async () => {
    // 12_000_000 micro-cents = $12.00 over a $10.00 cap → 120%, clamped to 100.
    mockedRequest.mockResolvedValue(todayPayload(12_000_000))
    renderBar(1000)

    await screen.findByText('$12.00 / $10.00')
    expect(panel()).toHaveAttribute('data-spend-level', 'critical')
    expect(fill().className).toContain('bg-rose-300')
    // Clamped: aria-valuenow never exceeds 100 and the fill never overflows.
    expect(progressbar()).toHaveAttribute('aria-valuenow', '100')
    expect(fill().style.width).toBe('100%')
    expect(screen.getByText(/Cap reached/i)).toBeInTheDocument()
    expect(screen.queryByText(/nearing today/i)).not.toBeInTheDocument()
  })

  it('treats exactly 80% as "warn" (threshold boundary)', async () => {
    mockedRequest.mockResolvedValue(todayPayload(8_000_000)) // exactly 80%
    renderBar(1000)

    await screen.findByText('$8.00 / $10.00')
    expect(panel()).toHaveAttribute('data-spend-level', 'warn')
    expect(progressbar()).toHaveAttribute('aria-valuenow', '80')
  })
})

describe('AICostCapSpendBar — loading + error states', () => {
  it('shows the loading copy while the request is in flight', () => {
    mockedRequest.mockReturnValue(new Promise(() => {})) // never resolves
    renderBar(1000)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    // Bar sits at 0% until data arrives — no misleading fill.
    expect(progressbar()).toHaveAttribute('aria-valuenow', '0')
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument()
  })

  it('shows an "unavailable" state on fetch failure instead of a false "$0.00"', async () => {
    mockedRequest.mockRejectedValue(new Error('500 server error'))
    renderBar(1000)

    expect(await screen.findByText('Spend unavailable')).toBeInTheDocument()
    // The reassuring "$0.00" readout must never appear on error.
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument()
    // The user is told the cap is still enforced even though the number is gone.
    expect(screen.getByText(/still enforced server-side/i)).toBeInTheDocument()
    // No warn/critical hints in the error state, bar pinned to 0%.
    expect(screen.queryByText(/Cap reached/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/nearing today/i)).not.toBeInTheDocument()
    expect(progressbar()).toHaveAttribute('aria-valuenow', '0')
  })
})

describe('AICostCapSpendBar — robustness', () => {
  it('degrades a NaN spend to 0% instead of "NaN%"', async () => {
    mockedRequest.mockResolvedValue(todayPayload(Number.NaN))
    renderBar(1000)

    // Wait for the resolved (NaN) payload — the readout leaves "Loading…".
    expect(await screen.findByText('$0.00 / $10.00')).toBeInTheDocument()
    expect(panel()).toHaveAttribute('data-spend-level', 'ok')
    expect(fill().style.width).toBe('0%')
    expect(fill().style.width).not.toContain('NaN')
    expect(progressbar()).toHaveAttribute('aria-valuenow', '0')
  })

  it('clamps a negative spend up to 0%', async () => {
    mockedRequest.mockResolvedValue(todayPayload(-9_000_000))
    renderBar(1000)

    expect(await screen.findByText('$0.00 / $10.00')).toBeInTheDocument()
    expect(progressbar()).toHaveAttribute('aria-valuenow', '0')
    expect(fill().style.width).toBe('0%')
  })

  it('does not divide by zero when the cap is 0 (falls back to 0%)', async () => {
    mockedRequest.mockResolvedValue(todayPayload(5_000_000))
    renderBar(0)

    expect(await screen.findByText('$5.00 / $0.00')).toBeInTheDocument()
    expect(progressbar()).toHaveAttribute('aria-valuenow', '0')
    expect(fill().style.width).toBe('0%')
  })
})

describe('AICostCapSpendBar — accessibility', () => {
  it('exposes a labelled progressbar with a bounded aria-value contract', async () => {
    mockedRequest.mockResolvedValue(todayPayload(5_000_000))
    renderBar(1000)

    await screen.findByText('$5.00 / $10.00')
    const bar = screen.getByRole('progressbar', { name: 'Helix cost cap usage' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuenow', '50')
  })
})
