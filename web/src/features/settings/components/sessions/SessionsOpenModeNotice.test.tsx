/**
 * SessionsOpenModeNotice contract.
 *
 * The AUTH_MODE_OPEN placeholder the ActiveSessionsPage renders when the
 * install has no forward-auth header. It takes no props and has no branches,
 * so the contract worth locking in is the *shape* of what it renders:
 *
 *   1. The panel is never blank — it always surfaces the container test-id,
 *      the heading, and the operator-facing remediation copy.
 *   2. i18n wiring: both the title and message go through `t()` with the
 *      documented keys AND the English defaults (so a missing `settings`
 *      namespace still renders usable copy).
 *   3. Accessibility: the panel is a *named* landmark region (so keyboard /
 *      screen-reader users can jump to it), the notice is a polite live
 *      region (announced when open mode flips on), the decorative shield
 *      icon is hidden, and the region's accessible name matches the visible
 *      heading rather than being an anonymous "region".
 *   4. Both the named and default exports point at the same component.
 *
 * `react-i18next` is stubbed with a passthrough spy that returns the
 * `defaultValue` argument, matching the repo convention. The component only
 * consumes `useTranslation`, so no QueryClient / Router providers are needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Hoisted so the vi.mock factory (which is itself hoisted above the imports)
// can capture the same spy instance we assert against below.
const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn(
    (key: string, defaultValue?: string) =>
      typeof defaultValue === 'string' ? defaultValue : key,
  ),
}))

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: tSpy,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import SessionsOpenModeNoticeDefault, {
  SessionsOpenModeNotice,
} from './SessionsOpenModeNotice'

const TITLE = 'Session tracking unavailable'

beforeEach(() => {
  tSpy.mockClear()
})

describe('SessionsOpenModeNotice — rendering', () => {
  it('renders the container panel with the documented test-id', () => {
    render(<SessionsOpenModeNotice />)
    expect(screen.getByTestId('active-sessions-open-mode')).toBeInTheDocument()
  })

  it('renders the title as a heading and the remediation message', () => {
    render(<SessionsOpenModeNotice />)

    expect(
      screen.getByRole('heading', { name: TITLE }),
    ).toBeInTheDocument()

    const message = screen.getByText(/Active session tracking requires forward-auth mode/)
    expect(message).toBeInTheDocument()
    // The operator instruction must name the exact header to inject.
    expect(message.textContent).toContain('X-Forwarded-User')
  })
})

describe('SessionsOpenModeNotice — i18n contract', () => {
  it('requests the documented keys with their English defaults', () => {
    render(<SessionsOpenModeNotice />)

    expect(tSpy).toHaveBeenCalledWith(
      'account.sessions.openMode.title',
      'Session tracking unavailable',
    )
    expect(tSpy).toHaveBeenCalledWith(
      'account.sessions.openMode.message',
      expect.stringContaining('X-Forwarded-User'),
    )
  })

  it('looks the title key up once and shares it across heading + label (DRY)', () => {
    render(<SessionsOpenModeNotice />)

    const titleCalls = tSpy.mock.calls.filter(
      ([key]) => key === 'account.sessions.openMode.title',
    )
    expect(titleCalls).toHaveLength(1)
  })
})

describe('SessionsOpenModeNotice — accessibility', () => {
  it('exposes a landmark region named by the notice title', () => {
    render(<SessionsOpenModeNotice />)

    const region = screen.getByRole('region', { name: TITLE })
    expect(region).toHaveAttribute('data-testid', 'active-sessions-open-mode')
    // The accessible name must match the visible heading, not be anonymous.
    expect(region).toHaveAccessibleName(TITLE)
  })

  it('announces the notice via a polite live status region', () => {
    render(<SessionsOpenModeNotice />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(TITLE)
    expect(status.textContent).toContain('forward-auth mode')
  })

  it('marks the shield icon as decorative so the heading owns the name', () => {
    const { container } = render(<SessionsOpenModeNotice />)

    const icon = container.querySelector('svg[aria-hidden="true"]')
    expect(icon).not.toBeNull()
    // No stray accessible name leaks from the decorative glyph.
    expect(screen.getByRole('heading', { name: TITLE })).toHaveTextContent(TITLE)
  })
})

describe('SessionsOpenModeNotice — exports', () => {
  it('exposes the same component as the default and named binding', () => {
    expect(SessionsOpenModeNoticeDefault).toBe(SessionsOpenModeNotice)
  })
})
