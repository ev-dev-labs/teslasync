/**
 * @module hooks/usePwaInstall
 *
 * Installability detection for Android and iOS (PWA-01).
 *
 * ## Why this is not just `beforeinstallprompt`
 *
 * `beforeinstallprompt` is a Chromium-only event. WebKit has never shipped it
 * and has publicly declined to. On iOS the ONLY way to install a web app is
 * the user manually choosing *Share → Add to Home Screen* in Safari — and it
 * is unavailable in third-party iOS browsers (Chrome, Firefox, Edge on iOS
 * are all Safari's engine but do not expose the Add to Home Screen action)
 * and inside in-app webviews.
 *
 * A generic "Install" button on iOS therefore does nothing when tapped. The
 * honest behaviour, implemented here, is to detect the platform and render
 * real instructions instead of a dead button, and to render nothing at all
 * where installation genuinely is not possible.
 *
 * {@link detectInstallCapability} is pure so every branch of the matrix is
 * unit-testable without a browser.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

/** The Chromium-only deferred install event. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallCapability =
  /** Already running as an installed app — nothing to offer. */
  | 'installed'
  /** Chromium fired `beforeinstallprompt`; a real one-tap install exists. */
  | 'native-prompt'
  /** iOS Safari: installable, but only through Share → Add to Home Screen. */
  | 'ios-manual'
  /** iOS, but not in Safari — installation is impossible in this browser. */
  | 'ios-unsupported-browser'
  /** No signal yet (desktop Chromium before the event, Firefox, …). */
  | 'unavailable'

export interface DetectInstallCapabilityInput {
  userAgent: string
  /** `display-mode: standalone` OR the iOS-only `navigator.standalone`. */
  standalone: boolean
  /** A `beforeinstallprompt` event has been captured. */
  hasDeferredPrompt: boolean
  /** `navigator.maxTouchPoints`, used to spot iPadOS masquerading as macOS. */
  maxTouchPoints?: number
}

const IOS_UA = /iPad|iPhone|iPod/
// iPadOS 13+ reports a desktop Safari UA; the touch-point count is the
// standard way to tell it apart from a real Mac.
const MAC_UA = /Macintosh/
// Third-party iOS browsers append their own token. None of them expose
// Add to Home Screen, so the instructions would be wrong for them.
const IOS_NON_SAFARI = /(CriOS|FxiOS|EdgiOS|OPiOS|Mercury|GSA)\//
// In-app webviews (Facebook, Instagram, LinkedIn, …) cannot install either.
const IOS_WEBVIEW = /(FBAN|FBAV|Instagram|LinkedInApp|Twitter)/

/** `true` for iOS/iPadOS regardless of the reported browser. */
export function isIosPlatform(
  userAgent: string,
  maxTouchPoints = 0,
): boolean {
  if (IOS_UA.test(userAgent)) return true
  return MAC_UA.test(userAgent) && maxTouchPoints > 1
}

/**
 * Resolve what install affordance (if any) this device can honestly offer.
 *
 * Order matters: an already-installed app short-circuits everything, and a
 * real `beforeinstallprompt` always wins over heuristics.
 */
export function detectInstallCapability(
  input: DetectInstallCapabilityInput,
): InstallCapability {
  if (input.standalone) return 'installed'
  if (input.hasDeferredPrompt) return 'native-prompt'

  const ua = input.userAgent ?? ''
  if (isIosPlatform(ua, input.maxTouchPoints ?? 0)) {
    if (IOS_WEBVIEW.test(ua) || IOS_NON_SAFARI.test(ua)) {
      return 'ios-unsupported-browser'
    }
    return 'ios-manual'
  }
  return 'unavailable'
}

function readStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (
      typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches
    ) {
      return true
    }
  } catch {
    // matchMedia can be absent (older embedded webviews) or throw on a
    // malformed query — fall back to the iOS-only navigator.standalone signal.
  }
  return (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export interface UsePwaInstallResult {
  capability: InstallCapability
  /** `true` when the app is already running in a standalone window. */
  standalone: boolean
  /**
   * Trigger the Chromium install dialog. Resolves `false` on every platform
   * where no native prompt exists — it never pretends to have installed
   * anything.
   */
  promptInstall: () => Promise<boolean>
  /** Forget the captured event (after install, or after a dismissal). */
  clearPrompt: () => void
}

export function usePwaInstall(): UsePwaInstallResult {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [standalone, setStandalone] = useState<boolean>(readStandalone)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const onBeforeInstallPrompt = (event: Event) => {
      if (readStandalone()) return
      // Suppress Chromium's own mini-infobar so the app can present the
      // offer in context instead of at an arbitrary moment.
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setDeferredPrompt(null)
      setStandalone(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)

    // A user can enter standalone mode without a reload (iOS launches the
    // saved icon into a fresh context, but desktop Chromium can transition
    // in place), so track the media query too.
    let media: MediaQueryList | null = null
    const onDisplayModeChange = () => setStandalone(readStandalone())
    try {
      media = window.matchMedia?.('(display-mode: standalone)') ?? null
      media?.addEventListener?.('change', onDisplayModeChange)
    } catch {
      media = null
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      media?.removeEventListener?.('change', onDisplayModeChange)
    }
  }, [])

  const capability = useMemo(
    () =>
      detectInstallCapability({
        userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
        standalone,
        hasDeferredPrompt: deferredPrompt != null,
        maxTouchPoints:
          typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0),
      }),
    [standalone, deferredPrompt],
  )

  const promptInstall = useCallback(async (): Promise<boolean> => {
    const event = deferredPrompt
    if (event == null) return false
    try {
      await event.prompt()
      const choice = await event.userChoice
      return choice?.outcome === 'accepted'
    } catch {
      // prompt() rejects when the event was already consumed or the browser
      // refused; there is nothing to recover.
      return false
    } finally {
      // `beforeinstallprompt` is single-use — the browser will not let us
      // replay a consumed event, so the captured handle must be retired.
      setDeferredPrompt(null)
    }
  }, [deferredPrompt])

  const clearPrompt = useCallback(() => setDeferredPrompt(null), [])

  return { capability, standalone, promptInstall, clearPrompt }
}
