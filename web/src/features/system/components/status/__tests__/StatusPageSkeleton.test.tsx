import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GlassPanel } from '@/components/ui'
import { StatusHero, type HeroStatus } from '@/components/status'

const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((key: string, fallback?: string) => fallback ?? key),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tSpy,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

import { StatusPageSkeleton } from '../StatusPageSkeleton'

const PLACEHOLDER = '[class*="--skeleton-bg"]'
const PANEL = '[data-print-card]'

beforeEach(() => {
  tSpy.mockClear()
})

describe('StatusPageSkeleton', () => {
  it('exposes a single accessible, i18n-labelled busy status live region', () => {
    render(<StatusPageSkeleton />)

    const region = screen.getByTestId('status-page-skeleton')
    // The testid node IS the status live region (one region, not many).
    expect(region).toBe(screen.getByRole('status'))
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region).toHaveAttribute('aria-label', 'Loading system status')
    expect(
      screen.getByRole('status', { name: 'Loading system status' }),
    ).toBeInTheDocument()
    expect(region).not.toHaveClass('max-w-3xl', 'mx-auto')
  })

  it('sources the accessible name from i18n and falls back to English', () => {
    render(<StatusPageSkeleton />)

    // The label is routed through t() with the namespaced key the rest of
    // SystemStatusPage uses — not a hardcoded literal.
    expect(tSpy).toHaveBeenCalledWith(
      'systemStatus.skeletonLoading',
      'Loading system status',
    )
    // With no matching translation, react-i18next uses the fallback → English copy.
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe(
      'Loading system status',
    )
  })

  it('renders the translated label when i18n provides one (proves it is not hardcoded)', () => {
    tSpy.mockReturnValueOnce('Estado del sistema cargando')
    render(<StatusPageSkeleton />)

    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Estado del sistema cargando',
    )
  })

  it('allocates only one hero panel rather than duplicating independent source shells', () => {
    const { container } = render(<StatusPageSkeleton />)

    const panels = Array.from(container.querySelectorAll(PANEL)) as HTMLElement[]
    expect(panels).toHaveLength(1)
    const [hero] = panels
    expect(hero.querySelectorAll(PLACEHOLDER)).toHaveLength(4)
    expect(screen.getByTestId('status-page-skeleton').children).toHaveLength(1)
    expect(hero).toHaveClass('p-4', 'md:p-5')
  })

  it('matches the hero mobile stack and desktop row without a page-width constraint', () => {
    const { container } = render(<StatusPageSkeleton />)
    const blocks = container.querySelectorAll(PLACEHOLDER)
    expect(blocks[0].parentElement).toHaveClass(
      'flex', 'flex-col', 'items-center', 'gap-4', 'md:flex-row', 'md:gap-6',
    )
    expect(blocks[0]).toHaveClass('h-14', 'w-14', 'rounded-full', 'shrink-0')
    expect(blocks[1].parentElement).toHaveClass('flex-1', 'min-w-0', 'space-y-2')
    expect(blocks[3]).toHaveClass('h-11', 'shrink-0')
  })

  it('renders decorative-only blocks so the aria-label is the sole announcement', () => {
    const { container } = render(<StatusPageSkeleton />)
    const region = screen.getByTestId('status-page-skeleton')

    expect(container.querySelectorAll(PLACEHOLDER)).toHaveLength(4)
    for (const block of container.querySelectorAll(PLACEHOLDER)) {
      expect(block).toHaveAttribute('aria-hidden', 'true')
    }
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    // No readable text — assistive tech only hears the aria-label.
    expect(region.textContent).toBe('')
  })

  it.each<HeroStatus>(['healthy', 'degraded', 'unhealthy', 'unknown', 'maintenance'])(
    'preserves independent shells across the loading-to-%s hero transition',
    (status) => {
      const refresh = vi.fn()
      // Mirror the page's hero-only conditional; independent sources are siblings.
      const surface = (loading: boolean) => (
        <>
          {loading ? <StatusPageSkeleton /> : (
            <StatusHero
              status={status}
              headline={`Observed ${status}`}
              subline="Last checked 5s ago"
              cta={{ label: 'Run health check', onClick: refresh }}
            />
          )}
          <GlassPanel data-testid="resources-source">512 MB</GlassPanel>
          <GlassPanel data-testid="workers-source">2 / 2 healthy</GlassPanel>
        </>
      )
      const { container, rerender } = render(surface(true))
      const resources = screen.getByTestId('resources-source')
      const workers = screen.getByTestId('workers-source')
      expect(container.querySelectorAll(PANEL)).toHaveLength(3)
      expect(resources).toHaveTextContent('512 MB')
      expect(workers).toHaveTextContent('2 / 2 healthy')

      rerender(surface(false))
      expect(screen.queryByTestId('status-page-skeleton')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: `Observed ${status}` })).toBeInTheDocument()
      expect(screen.getByText('Last checked 5s ago')).toBeInTheDocument()
      expect(screen.getByTestId('resources-source')).toBe(resources)
      expect(screen.getByTestId('workers-source')).toBe(workers)
      expect(container.querySelectorAll(PANEL)).toHaveLength(3)
      fireEvent.click(screen.getByRole('button', { name: 'Run health check' }))
      expect(refresh).toHaveBeenCalledOnce()
    },
  )
})
