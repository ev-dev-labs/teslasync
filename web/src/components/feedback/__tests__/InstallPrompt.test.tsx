import * as React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react'

/**
 * InstallPrompt contract tests.
 *
 * The prompt is a PWA "Add to home screen" banner that:
 *   • listens for the browser's `beforeinstallprompt` event and only then
 *     surfaces itself (never on standalone-mode or within a recent dismissal),
 *   • drives the native install dialog and retires itself once the event is
 *     consumed (single-use per the spec — regardless of accept/dismiss),
 *   • persists a 14-day snooze + broadcasts to peer tabs on manual dismiss,
 *   • hides on `appinstalled` and on a cross-tab `install.dismissed` message.
 *
 * `react-i18next`, `framer-motion`, and the cross-tab `@/lib/broadcast` bus are
 * stubbed so the test focuses purely on behaviour, not animation or transport.
 */

// Cross-tab bus seam: capture the subscriber the component registers so tests
// can simulate a peer-tab message, and spy on the outbound broadcast + the
// unsubscribe cleanup.
const bus = vi.hoisted(() => ({
  broadcastMock: vi.fn(),
  unsubscribeSpy: vi.fn(),
  ref: { current: undefined as ((msg: any) => void) | undefined },
}))

vi.mock('@/lib/broadcast', () => ({
  broadcast: bus.broadcastMock,
  subscribe: (handler: (msg: any) => void) => {
    bus.ref.current = handler
    return bus.unsubscribeSpy
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
  }),
}))

// Strip framer-motion's animation-only props so jsdom doesn't warn about
// unknown DOM attributes, and collapse AnimatePresence to a passthrough.
vi.mock('framer-motion', () => {
  const STRIP = new Set([
    'initial', 'animate', 'exit', 'transition',
    'whileHover', 'whileTap', 'whileInView', 'variants', 'layout',
  ])
  const renderDiv = (props: Record<string, any>) => {
    const domProps: Record<string, any> = {}
    for (const key of Object.keys(props)) {
      if (!STRIP.has(key) && key !== 'children') domProps[key] = props[key]
    }
    return React.createElement('div', domProps, props.children)
  }
  return {
    motion: new Proxy({} as Record<string, any>, { get: () => renderDiv }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useReducedMotion: () => false,
  }
})

import InstallPrompt from '../InstallPrompt'

const DISMISS_KEY = 'teslasync-pwa-install-dismissed'

type PromptOutcome = 'accepted' | 'dismissed'

interface FakeInstallEvent extends Event {
  prompt: ReturnType<typeof vi.fn>
  userChoice: Promise<{ outcome: PromptOutcome }>
}

function makeInstallEvent(
  outcome: PromptOutcome = 'accepted',
  promptImpl?: () => Promise<void>,
): FakeInstallEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as FakeInstallEvent
  event.prompt = vi.fn(promptImpl ?? (() => Promise.resolve()))
  event.userChoice = Promise.resolve({ outcome })
  return event
}

function fireInstallEvent(event: Event) {
  act(() => {
    window.dispatchEvent(event)
  })
}

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe('InstallPrompt', () => {
  beforeEach(() => {
    window.localStorage.clear()
    bus.broadcastMock.mockClear()
    bus.unsubscribeSpy.mockClear()
    bus.ref.current = undefined
    // Default browser tab: not standalone, no iOS navigator.standalone flag.
    stubMatchMedia(false)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nothing until a beforeinstallprompt event fires', () => {
    const { container } = render(<InstallPrompt />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument()
  })

  it('surfaces an accessible prompt with install + dismiss controls when eligible', () => {
    const event = makeInstallEvent()
    const preventDefault = vi.spyOn(event, 'preventDefault')

    render(<InstallPrompt />)
    fireInstallEvent(event)

    const banner = screen.getByTestId('install-prompt')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    // The handler must cancel the browser's default mini-infobar.
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Install TeslaSync')).toBeInTheDocument()
    expect(screen.getByText('Add to home screen for native experience')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss install prompt' })).toBeInTheDocument()
  })

  it('runs the native install flow and retires the banner when accepted', async () => {
    const event = makeInstallEvent('accepted')
    render(<InstallPrompt />)
    fireInstallEvent(event)
    expect(screen.getByTestId('install-prompt')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(event.prompt).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument()
    })
  })

  it('retires the banner even when the user dismisses the native dialog (no dead Install button)', async () => {
    const event = makeInstallEvent('dismissed')
    render(<InstallPrompt />)
    fireInstallEvent(event)

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(event.prompt).toHaveBeenCalledTimes(1)
    // Bug-fix guard: the single-use event is consumed, so the banner must go
    // away rather than leaving an Install button wired to a null prompt.
    await waitFor(() => {
      expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument()
    })
  })

  it('retires the banner when prompt() rejects instead of leaving it stuck', async () => {
    const event = makeInstallEvent('accepted', () => Promise.reject(new Error('already used')))
    render(<InstallPrompt />)
    fireInstallEvent(event)

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    await waitFor(() => {
      expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument()
    })
    expect(event.prompt).toHaveBeenCalledTimes(1)
  })

  it('persists a snooze and broadcasts to peer tabs on manual dismiss', () => {
    const event = makeInstallEvent()
    render(<InstallPrompt />)
    fireInstallEvent(event)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install prompt' }))

    expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument()
    const stored = window.localStorage.getItem(DISMISS_KEY)
    expect(Number(stored)).toBeGreaterThan(0)
    expect(bus.broadcastMock).toHaveBeenCalledWith({ type: 'install.dismissed' })
  })

  it('stays hidden when a recent dismissal is already recorded', () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
    const event = makeInstallEvent()

    render(<InstallPrompt />)
    fireInstallEvent(event)

    expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument()
    // The event IS still captured (and the browser's mini-infobar suppressed)
    // so the offer can be re-surfaced once the 14-day snooze expires without
    // waiting for Chromium to fire `beforeinstallprompt` a second time —
    // which it only does on a fresh navigation.
    expect(event.defaultPrevented).toBe(true)
  })

  it('stays hidden when running as an installed standalone PWA', () => {
    stubMatchMedia(true)
    const event = makeInstallEvent()

    render(<InstallPrompt />)
    fireInstallEvent(event)

    expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument()
  })

  it('hides itself when the browser reports the app was installed', () => {
    const event = makeInstallEvent()
    render(<InstallPrompt />)
    fireInstallEvent(event)
    expect(screen.getByTestId('install-prompt')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument()
  })

  it('hides on a cross-tab install.dismissed message but ignores unrelated messages', () => {
    const event = makeInstallEvent()
    render(<InstallPrompt />)
    fireInstallEvent(event)
    expect(screen.getByTestId('install-prompt')).toBeInTheDocument()

    // Unrelated bus traffic must not dismiss the prompt.
    act(() => {
      bus.ref.current?.({ type: 'theme.changed', themeId: 'neon-cyan', modeId: 'dark' })
    })
    expect(screen.getByTestId('install-prompt')).toBeInTheDocument()

    // A peer tab dismissing the prompt should hide it here too.
    act(() => {
      bus.ref.current?.({ type: 'install.dismissed' })
    })
    expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument()
  })

  it('unsubscribes from the broadcast bus on unmount', () => {
    const { unmount } = render(<InstallPrompt />)
    expect(bus.unsubscribeSpy).not.toHaveBeenCalled()

    unmount()

    expect(bus.unsubscribeSpy).toHaveBeenCalledTimes(1)
  })

  it('does not crash and still surfaces when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    const event = makeInstallEvent()

    render(<InstallPrompt />)
    fireInstallEvent(event)

    expect(screen.getByTestId('install-prompt')).toBeInTheDocument()
  })
})
