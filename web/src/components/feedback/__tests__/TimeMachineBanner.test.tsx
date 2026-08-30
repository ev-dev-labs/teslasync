import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { OperationalModeProvider } from '@/hooks/useOperationalMode'

/**
 * TimeMachineBanner contract.
 *
 * The banner reads `?as_of=` via {@link useAsOfDate} and renders inside
 * the layout shell. Tests use the `testHookAsOf` and `testHookPickerOpen`
 * props to bypass URL-state plumbing for visual assertions, and a
 * MemoryRouter wrapper so the `useAsOfDate` hook (which calls
 * `useSearchParams`) renders without crashing.
 *
 * react-i18next is stubbed to echo defaults so assertions match the
 * fallback English copy directly.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      if (typeof defaultOrOpts === 'string') {
        let out = defaultOrOpts
        const interp = opts ?? {}
        for (const [k, v] of Object.entries(interp)) {
          out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
        }
        return out
      }
      return _key
    },
    i18n: { language: 'en-US' },
  }),
}))

import {
  TIME_MACHINE_OPEN_PICKER_EVENT,
  TimeMachineBanner,
} from '../TimeMachineBanner'

function wrapperWith(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>
      <OperationalModeProvider>{children}</OperationalModeProvider>
    </MemoryRouter>
  )
}

describe('TimeMachineBanner', () => {
  it('renders nothing in live mode with the picker closed', () => {
    const { container } = render(<TimeMachineBanner />, {
      wrapper: wrapperWith('/page'),
    })
    expect(container.firstChild).toBeNull()
  })

  it('renders the historical-mode banner when as_of is set in the URL', () => {
    render(<TimeMachineBanner />, {
      wrapper: wrapperWith('/page?as_of=2024-11-12T14%3A30%3A00Z'),
    })
    const banner = screen.getByTestId('time-machine-banner')
    expect(banner).toBeInTheDocument()
    expect(banner.getAttribute('data-as-of')).toBe('2024-11-12T14:30:00.000Z')
    expect(screen.getByTestId('time-machine-banner-body')).toBeInTheDocument()
  })

  it('exposes role=status with polite live region for screen readers', () => {
    render(
      <TimeMachineBanner testHookAsOf="2024-11-12T14:30:00Z" />,
      { wrapper: wrapperWith('/page') },
    )
    const banner = screen.getByTestId('time-machine-banner')
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.getAttribute('aria-live')).toBe('polite')
  })

  it('shows the "Return to live" affordance only when in time-machine mode', () => {
    const { rerender } = render(
      <TimeMachineBanner testHookAsOf="2024-11-12T14:30:00Z" />,
      { wrapper: wrapperWith('/page') },
    )
    expect(screen.getByTestId('time-machine-banner-return')).toBeInTheDocument()

    rerender(<TimeMachineBanner testHookAsOf={null} testHookPickerOpen />)
    expect(screen.queryByTestId('time-machine-banner-return')).toBeNull()
  })

  it('opens the inline picker when the TIME_MACHINE_OPEN_PICKER_EVENT fires', () => {
    render(<TimeMachineBanner />, { wrapper: wrapperWith('/page') })
    expect(screen.queryByTestId('time-machine-banner-picker')).toBeNull()
    act(() => {
      window.dispatchEvent(new CustomEvent(TIME_MACHINE_OPEN_PICKER_EVENT))
    })
    expect(screen.getByTestId('time-machine-banner-picker')).toBeInTheDocument()
    // Picker pre-fills with yesterday at noon (a sensible default landing
    // inside the 90-day lookback). Just assert it is non-empty.
    const input = screen.getByTestId('time-machine-banner-input') as HTMLInputElement
    expect(input.value).not.toBe('')
  })

  it('toggles the picker open and closed when the "Pick" button is clicked', () => {
    render(
      <TimeMachineBanner testHookAsOf="2024-11-12T14:30:00Z" />,
      { wrapper: wrapperWith('/page') },
    )
    expect(screen.queryByTestId('time-machine-banner-picker')).toBeNull()
    fireEvent.click(screen.getByTestId('time-machine-banner-pick'))
    expect(screen.getByTestId('time-machine-banner-picker')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('time-machine-banner-cancel'))
    expect(screen.queryByTestId('time-machine-banner-picker')).toBeNull()
  })

  it('disables submit until the user enters a date', () => {
    render(<TimeMachineBanner testHookPickerOpen />, {
      wrapper: wrapperWith('/page'),
    })
    const submit = screen.getByTestId('time-machine-banner-submit') as HTMLButtonElement
    const input = screen.getByTestId('time-machine-banner-input') as HTMLInputElement
    // Force the input value back to empty (override the auto-seed) so we
    // can prove the disabled state of submit.
    fireEvent.change(input, { target: { value: '' } })
    expect(submit.disabled).toBe(true)
  })

  it('sticky-positions the banner at the top of the layout column', () => {
    render(
      <TimeMachineBanner testHookAsOf="2024-11-12T14:30:00Z" />,
      { wrapper: wrapperWith('/page') },
    )
    const banner = screen.getByTestId('time-machine-banner')
    // The Layout stack relies on top-0 sticky + z-[55] so the banner
    // sits below MaintenanceBanner z-[60] and ImpersonationBanner
    // z-[65] but above the page content.
    expect(banner.className).toContain('sticky')
    expect(banner.className).toContain('top-0')
    expect(banner.className).toContain('z-[55]')
  })
})
