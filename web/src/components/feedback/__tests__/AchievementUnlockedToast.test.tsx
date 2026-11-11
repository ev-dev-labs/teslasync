import * as React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrOpts?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      if (typeof defaultOrOpts === 'string') {
        // Simple template substitution: {{name}} → opts?.name
        let out = defaultOrOpts
        const params = opts ?? {}
        for (const [k, v] of Object.entries(params)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v))
        }
        return out
      }
      return key
    },
  }),
}))

// Hide the framer-motion machinery so the test focuses on behaviour, not animation.
vi.mock('framer-motion', () => {
  return {
    m: new Proxy({}, {
      get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode),
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => false,
  }
})

import { AchievementUnlockedToast } from '../AchievementUnlockedToast'
import type { AchievementUnlockedEvent } from '@/api/hooks/useAchievementUnlocks'

const sampleEvent: AchievementUnlockedEvent = {
  vehicle_id: 0,
  unlocked_at: '2025-01-01T00:00:00Z',
  achievement: {
    id: 'first_drive',
    name: 'First Drive',
    description: 'Complete your first drive',
    icon: '🚗',
    unlocked: true,
    unlocked_at: '2025-01-01T00:00:00Z',
    progress: 100,
    target: 1,
    current: 1,
  },
}

describe('AchievementUnlockedToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function renderToast(onDismiss = vi.fn(), durationMs?: number) {
    return render(
      <MemoryRouter>
        <AchievementUnlockedToast
          event={sampleEvent}
          onDismiss={onDismiss}
          durationMs={durationMs}
        />
      </MemoryRouter>,
    )
  }

  it('renders the achievement name and description', () => {
    renderToast()
    // Both name and description appear inside the AchievementBadge AND the
    // toast body — assert presence rather than uniqueness.
    expect(screen.getAllByText('First Drive').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Complete your first drive').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Achievement unlocked')).toBeInTheDocument()
  })

  it('exposes a "View" affordance and a dismiss button', () => {
    renderToast()
    expect(screen.getByRole('button', { name: /view/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Dismiss achievement notification/i }),
    ).toBeInTheDocument()
  })

  it('calls onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn()
    renderToast(onDismiss)
    fireEvent.click(screen.getByRole('button', { name: /Dismiss achievement notification/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps shared actions keyboard reachable and preserves encoded navigation', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    function Destination() {
      const { pathname, search } = useLocation()
      return <span data-testid="destination">{pathname}{search}</span>
    }
    render(
      <MemoryRouter>
        <Destination />
        <AchievementUnlockedToast
          event={{ ...sampleEvent, achievement: { ...sampleEvent.achievement, id: 'first drive/1?' } }}
          onDismiss={onDismiss}
          durationMs={60_000}
        />
      </MemoryRouter>,
    )

    const view = screen.getByRole('button', { name: /view/i })
    const dismiss = screen.getByRole('button', { name: /Dismiss achievement notification/i })
    expect(view).toHaveAttribute('data-app-part', 'button feedback-actions')
    expect(view).toHaveAttribute('type', 'button')
    expect(view).toHaveClass('h-auto', 'p-0', 'text-yellow-300', 'hover:bg-transparent')
    expect(view).not.toHaveClass('h-9', 'px-3')
    expect(dismiss).toHaveAttribute('data-app-part', 'button feedback-dismiss')
    expect(dismiss).toHaveAttribute('type', 'button')
    expect(dismiss).toHaveClass('h-auto', 'p-1.5', 'rounded-lg')
    expect(dismiss).not.toHaveClass('h-9', 'px-3')

    view.focus()
    await user.tab()
    expect(dismiss).toHaveFocus()
    await user.keyboard(' ')
    expect(onDismiss).toHaveBeenCalledOnce()
    await user.tab({ shift: true })
    expect(view).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onDismiss).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('destination')).toHaveTextContent('/lifetime?achievement=first%20drive%2F1%3F')
  })

  it('auto-dismisses after the configured duration', () => {
    const onDismiss = vi.fn()
    renderToast(onDismiss, 1000)
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('uses role=status with aria-live=polite for accessibility', () => {
    renderToast()
    const toast = screen.getByTestId('achievement-unlocked-toast')
    expect(toast).toHaveAttribute('role', 'status')
    expect(toast).toHaveAttribute('aria-live', 'polite')
  })
})
