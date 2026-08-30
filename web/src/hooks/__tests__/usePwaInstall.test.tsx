import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { detectInstallCapability, isIosPlatform, usePwaInstall } from '../usePwaInstall'

/**
 * Installability detection (PWA-01).
 *
 * The load-bearing assertion in this file is the honesty one: iOS must never
 * be reported as `native-prompt`, because `beforeinstallprompt` does not exist
 * in WebKit and an Install button there would do nothing when tapped.
 */

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  iosFacebookWebview:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/470.0]',
  ipadOs:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  mac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  firefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
}

describe('isIosPlatform', () => {
  it('detects iPhone', () => {
    expect(isIosPlatform(UA.iphoneSafari)).toBe(true)
  })

  it('detects iPadOS masquerading as desktop Safari via touch points', () => {
    expect(isIosPlatform(UA.ipadOs, 5)).toBe(true)
    expect(isIosPlatform(UA.ipadOs, 0)).toBe(false)
  })

  it('does not misfire on a real Mac', () => {
    expect(isIosPlatform(UA.mac, 0)).toBe(false)
  })
})

describe('detectInstallCapability', () => {
  const detect = (
    userAgent: string,
    patch: { standalone?: boolean; hasDeferredPrompt?: boolean; maxTouchPoints?: number } = {},
  ) =>
    detectInstallCapability({
      userAgent,
      standalone: patch.standalone ?? false,
      hasDeferredPrompt: patch.hasDeferredPrompt ?? false,
      maxTouchPoints: patch.maxTouchPoints ?? 0,
    })

  it('reports an installed app first, whatever the platform', () => {
    expect(detect(UA.androidChrome, { standalone: true, hasDeferredPrompt: true })).toBe('installed')
    expect(detect(UA.iphoneSafari, { standalone: true })).toBe('installed')
  })

  it('uses the real native prompt when the browser fired one', () => {
    expect(detect(UA.androidChrome, { hasDeferredPrompt: true })).toBe('native-prompt')
    expect(detect(UA.desktopChrome, { hasDeferredPrompt: true })).toBe('native-prompt')
  })

  it('NEVER claims a native prompt on iOS Safari — WebKit has no install API', () => {
    expect(detect(UA.iphoneSafari)).toBe('ios-manual')
    expect(detect(UA.ipadOs, { maxTouchPoints: 5 })).toBe('ios-manual')
  })

  it.each([
    ['Chrome on iOS', UA.iphoneChrome],
    ['Firefox on iOS', UA.iphoneFirefox],
    ['an in-app webview', UA.iosFacebookWebview],
  ])('stays silent in %s, where installing is impossible', (_label, ua) => {
    expect(detect(ua)).toBe('ios-unsupported-browser')
  })

  it('reports "unavailable" when no signal exists yet', () => {
    expect(detect(UA.desktopChrome)).toBe('unavailable')
    expect(detect(UA.firefox)).toBe('unavailable')
    expect(detect('')).toBe('unavailable')
  })
})

describe('usePwaInstall', () => {
  function setUserAgent(value: string) {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value })
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

  function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: ReturnType<typeof vi.fn>
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
    }
    event.prompt = vi.fn(() => Promise.resolve())
    event.userChoice = Promise.resolve({ outcome })
    act(() => {
      window.dispatchEvent(event)
    })
    return event
  }

  beforeEach(() => {
    stubMatchMedia(false)
    setUserAgent(UA.desktopChrome)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('upgrades to native-prompt once the browser offers one', async () => {
    const { result } = renderHook(() => usePwaInstall())
    expect(result.current.capability).toBe('unavailable')

    fireBeforeInstallPrompt()

    await waitFor(() => expect(result.current.capability).toBe('native-prompt'))
  })

  it('suppresses the browser mini-infobar so the app can place the offer', () => {
    renderHook(() => usePwaInstall())
    const event = fireBeforeInstallPrompt()
    expect(event.defaultPrevented).toBe(true)
  })

  it('reports the accepted outcome and retires the single-use event', async () => {
    const { result } = renderHook(() => usePwaInstall())
    const event = fireBeforeInstallPrompt('accepted')
    await waitFor(() => expect(result.current.capability).toBe('native-prompt'))

    let accepted: boolean | undefined
    await act(async () => {
      accepted = await result.current.promptInstall()
    })

    expect(accepted).toBe(true)
    expect(event.prompt).toHaveBeenCalledTimes(1)
    // The event cannot be replayed, so the capability must fall back rather
    // than leaving a button wired to a consumed handle.
    await waitFor(() => expect(result.current.capability).toBe('unavailable'))
  })

  it('reports a dismissed outcome as "not installed"', async () => {
    const { result } = renderHook(() => usePwaInstall())
    fireBeforeInstallPrompt('dismissed')
    await waitFor(() => expect(result.current.capability).toBe('native-prompt'))

    let accepted: boolean | undefined
    await act(async () => {
      accepted = await result.current.promptInstall()
    })
    expect(accepted).toBe(false)
  })

  it('resolves false instead of throwing when there is nothing to prompt', async () => {
    setUserAgent(UA.iphoneSafari)
    const { result } = renderHook(() => usePwaInstall())
    expect(result.current.capability).toBe('ios-manual')

    let accepted: boolean | undefined
    await act(async () => {
      accepted = await result.current.promptInstall()
    })
    expect(accepted).toBe(false)
  })

  it('flips to installed on appinstalled', async () => {
    const { result } = renderHook(() => usePwaInstall())
    fireBeforeInstallPrompt()
    await waitFor(() => expect(result.current.capability).toBe('native-prompt'))

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    await waitFor(() => expect(result.current.capability).toBe('installed'))
    expect(result.current.standalone).toBe(true)
  })

  it('detects an already-installed standalone launch', () => {
    stubMatchMedia(true)
    const { result } = renderHook(() => usePwaInstall())
    expect(result.current.standalone).toBe(true)
    expect(result.current.capability).toBe('installed')
  })

  it('falls back to navigator.standalone when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: true,
    })

    const { result } = renderHook(() => usePwaInstall())
    expect(result.current.capability).toBe('installed')

    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: undefined,
    })
  })
})
