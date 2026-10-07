import * as React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
    motion: new Proxy({}, {
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
    expect(screen.getByText('Achievement Unlocked')).toBeInTheDocument()
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
