import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * BrowserCompatBanner contract.
 *
 * The component composes <AlertBanner> and reads detection from
 * @/lib/browserCompat. Tests use the `testHookMissing` prop to
 * deterministically simulate an unsupported browser without
 * monkey-patching every global at once. react-i18next is stubbed
 * to echo the default value so assertions match the fallback English
 * copy directly.
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
  }),
}))

import { BrowserCompatBanner } from '../BrowserCompatBanner'
import {
  COMPAT_WARNING_STORAGE_KEY,
  __resetCompatWarningForTests,
} from '@/lib/browserCompat'

describe('BrowserCompatBanner', () => {
  beforeEach(() => {
    __resetCompatWarningForTests()
  })

  afterEach(() => {
    __resetCompatWarningForTests()
  })

  it('renders nothing when no features are missing', () => {
    const { container } = render(<BrowserCompatBanner testHookMissing={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the warning banner with the missing feature names', () => {
    render(<BrowserCompatBanner testHookMissing={['BroadcastChannel', 'CSS :has()']} />)
    const banner = screen.getByTestId('browser-compat-banner')
    expect(banner).toBeInTheDocument()
    expect(banner.getAttribute('data-missing')).toBe('BroadcastChannel, CSS :has()')
    expect(screen.getByTestId('browser-compat-banner-body').textContent).toContain(
      'BroadcastChannel, CSS :has()',
    )
  })

  it('surfaces a dismiss control that hides the banner and persists the choice', () => {
    const { rerender } = render(<BrowserCompatBanner testHookMissing={['BroadcastChannel']} />)
    expect(screen.getByTestId('browser-compat-banner')).toBeInTheDocument()

    // The dismiss X is the only <button> inside the banner.
    const banner = screen.getByTestId('browser-compat-banner')
    const dismiss = banner.querySelector('button')
    expect(dismiss).not.toBeNull()
    fireEvent.click(dismiss as HTMLButtonElement)

    expect(screen.queryByTestId('browser-compat-banner')).toBeNull()
    expect(globalThis.localStorage.getItem(COMPAT_WARNING_STORAGE_KEY)).toBe('1')

    // Re-render — even with the same missing list the banner must
    // stay hidden because the dismissal is persisted.
    rerender(<BrowserCompatBanner testHookMissing={['BroadcastChannel']} />)
    expect(screen.queryByTestId('browser-compat-banner')).toBeNull()
  })

  it('stays hidden across remounts after dismissal (simulated reload)', () => {
    globalThis.localStorage.setItem(COMPAT_WARNING_STORAGE_KEY, '1')
    const { container } = render(
      <BrowserCompatBanner testHookMissing={['BroadcastChannel']} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('reappears once localStorage is cleared (user resets the browser)', () => {
    globalThis.localStorage.setItem(COMPAT_WARNING_STORAGE_KEY, '1')
    const { rerender } = render(
      <BrowserCompatBanner testHookMissing={['BroadcastChannel']} />,
    )
    expect(screen.queryByTestId('browser-compat-banner')).toBeNull()
    __resetCompatWarningForTests()
    rerender(<BrowserCompatBanner testHookMissing={[]} />)
    rerender(<BrowserCompatBanner testHookMissing={['BroadcastChannel']} />)
    // The dismissed state lives in component state, not in detection,
    // so a remount with cleared storage re-checks isCompatWarningDismissed().
    const { container } = render(
      <BrowserCompatBanner testHookMissing={['BroadcastChannel']} />,
    )
    expect(container.querySelector('[data-testid="browser-compat-banner"]')).not.toBeNull()
  })

  it('uses role=status with polite live region so screen readers are not interrupted', () => {
    render(<BrowserCompatBanner testHookMissing={['BroadcastChannel']} />)
    const banner = screen.getByTestId('browser-compat-banner')
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.getAttribute('aria-live')).toBe('polite')
  })
})
