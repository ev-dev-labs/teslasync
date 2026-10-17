import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TOUR_OPEN_LAUNCHER_EVENT } from '@/lib/tourRegistry'
import { GuidedHelpPanel } from './GuidedHelpPanel'

const translation = vi.hoisted(() => ({
  labels: {} as Record<string, string>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => translation.labels[key] ?? fallback,
  }),
}))

vi.mock('@/components/ui', async () => {
  const { Button } = await import('@/components/ui/Button')
  const { GlassPanel } = await import('@/components/ui/GlassPanel')
  const { PanelTitle, Text } = await import('@/components/ui/Typography')
  return { Button, GlassPanel, PanelTitle, Text }
})

// Only the downstream wizard is a fixture: exercise the real local buttons
// without recording onboarding completion or claiming native dialog behavior.
vi.mock('@/components/feedback/OnboardingWizard', async () => {
  const { Button } = await import('@/components/ui/Button')
  return {
    default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
      open ? (
        <div role="dialog" aria-label="Product introduction fixture">
          <Button onClick={onClose}>Close introduction fixture</Button>
        </div>
      ) : null,
  }
})

beforeEach(() => {
  translation.labels = {}
})

afterEach(() => {
  cleanup()
})

describe('GuidedHelpPanel phase6 local mobile declarations', () => {
  it('retains the panel, title, opt-in explanation, both action labels and decorative icon', () => {
    render(<GuidedHelpPanel />)

    const panel = screen.getByTestId('guided-help-panel')
    expect(within(panel).getByRole('heading', { name: 'Show me around' })).toBeVisible()
    expect(within(panel).getByText(
      'Walkthroughs run only when you ask for them — nothing here starts on its own.',
    )).toBeVisible()
    expect(within(panel).getAllByRole('button').map(button => button.textContent)).toEqual([
      'Replay the product introduction',
      'Browse guided tours',
    ])
    expect(screen.getByTestId('open-product-intro').querySelector('svg'))
      .toHaveAttribute('aria-hidden', 'true')
    expect(panel).toHaveClass('p-4', 'sm:p-5')
  })

  it('adds below-md minima to both real Button hosts without replacing desktop small sizing', () => {
    render(<GuidedHelpPanel />)

    for (const id of ['open-product-intro', 'open-tour-launcher']) {
      const button = screen.getByTestId(id)
      expect(button.tagName).toBe('BUTTON')
      expect(button).toHaveAttribute('type', 'button')
      expect(button).toBeEnabled()
      expect(button).toHaveClass(
        'max-md:min-h-11',
        'max-md:min-w-11',
        'h-9',
        'px-3',
        'text-sm',
        'focus-visible:outline-2',
        'focus-visible:outline-offset-2',
      )
      expect(button).not.toHaveClass('min-h-11', 'min-w-11', 'h-11', 'h-12')
    }
  })

  it('does not mount the introduction or dispatch tours until explicitly requested', () => {
    const launch = vi.fn()
    window.addEventListener(TOUR_OPEN_LAUNCHER_EVENT, launch)
    try {
      const { rerender } = render(<GuidedHelpPanel />)
      rerender(<GuidedHelpPanel />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(launch).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(TOUR_OPEN_LAUNCHER_EVENT, launch)
    }
  })

  it('opens, unmounts on close and reopens the controlled introduction without launching tours', async () => {
    const user = userEvent.setup()
    const launch = vi.fn()
    window.addEventListener(TOUR_OPEN_LAUNCHER_EVENT, launch)
    try {
      render(<GuidedHelpPanel />)
      await user.click(screen.getByRole('button', { name: 'Replay the product introduction' }))
      const dialog = screen.getByRole('dialog', { name: 'Product introduction fixture' })
      expect(dialog).toBeVisible()

      await user.click(within(dialog).getByRole('button', { name: 'Close introduction fixture' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('open-product-intro'))
      expect(screen.getByRole('dialog')).toBeVisible()
      expect(launch).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(TOUR_OPEN_LAUNCHER_EVENT, launch)
    }
  })

  it('dispatches the existing launcher event per click while retaining the panel and closed introduction', async () => {
    const user = userEvent.setup()
    const launch = vi.fn()
    window.addEventListener(TOUR_OPEN_LAUNCHER_EVENT, launch)
    try {
      render(<GuidedHelpPanel />)
      await user.click(screen.getByRole('button', { name: 'Browse guided tours' }))
      expect(launch).toHaveBeenCalledTimes(1)
      expect(launch.mock.calls[0][0]).toBeInstanceOf(CustomEvent)
      expect(launch.mock.calls[0][0].type).toBe(TOUR_OPEN_LAUNCHER_EVENT)
      await user.click(screen.getByTestId('open-tour-launcher'))
      expect(launch).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByTestId('guided-help-panel')).toBeVisible()
    } finally {
      window.removeEventListener(TOUR_OPEN_LAUNCHER_EVENT, launch)
    }
  })

  it('retains tab order and Enter/Space activation on the native button hosts in jsdom', async () => {
    const user = userEvent.setup()
    const launch = vi.fn()
    window.addEventListener(TOUR_OPEN_LAUNCHER_EVENT, launch)
    try {
      render(<GuidedHelpPanel />)
      await user.tab()
      expect(screen.getByTestId('open-product-intro')).toHaveFocus()
      await user.tab()
      expect(screen.getByTestId('open-tour-launcher')).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(launch).toHaveBeenCalledTimes(1)
      await user.keyboard(' ')
      expect(launch).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await user.tab({ shift: true })
      expect(screen.getByTestId('open-product-intro')).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(screen.getByRole('dialog')).toBeVisible()
    } finally {
      window.removeEventListener(TOUR_OPEN_LAUNCHER_EVENT, launch)
    }
  })

  it('retains complete long localized labels and the existing wrapping action rail', () => {
    translation.labels = {
      'help.guided.title': 'Erkunde die Anwendung und alle vorhandenen Funktionen',
      'help.guided.subtitle': 'Diese Einführung beginnt ausschließlich auf ausdrücklichen Wunsch.',
      'help.guided.intro': 'Die vollständige Produkteinführung mit allen Erklärungen erneut öffnen',
      'help.guided.tours': 'Alle verfügbaren geführten Rundgänge durch die Anwendung durchsuchen',
    }
    render(<GuidedHelpPanel />)

    expect(screen.getByRole('heading', { name: translation.labels['help.guided.title'] }))
      .toBeVisible()
    expect(screen.getByText(translation.labels['help.guided.subtitle'])).toBeVisible()
    for (const key of ['help.guided.intro', 'help.guided.tours']) {
      expect(screen.getByRole('button', { name: translation.labels[key] })).toBeVisible()
    }
    expect(screen.getByTestId('open-product-intro').parentElement)
      .toHaveClass('flex', 'flex-wrap', 'gap-2')
  })
})
