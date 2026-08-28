import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { motion, AnimatePresence } from '@/components/motion'
import { Button } from '@/components/ui/runtime'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { usePwaInstall } from '@/hooks/usePwaInstall'
import { broadcast, subscribe } from '@/lib/broadcast'

/**
 * Install affordance for Android and iOS (PWA-01).
 *
 * The banner adapts to what the platform can ACTUALLY do:
 *
 *  - Chromium fired `beforeinstallprompt` → a real one-tap Install button.
 *  - iOS Safari → step-by-step *Share → Add to Home Screen* instructions,
 *    because WebKit has no install API and a button would be a lie.
 *  - iOS in Chrome/Firefox/Edge or an in-app webview → nothing, because
 *    installation is impossible there and telling the user to look for a
 *    menu item that does not exist is worse than staying quiet.
 *  - Already installed → nothing.
 *
 * Dismissal is remembered for 14 days and mirrored across tabs.
 */

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

const DISMISS_KEY = 'teslasync-pwa-install-dismissed'
const DISMISS_DAYS = 14

function wasDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_DAYS * 86_400_000
  } catch {
    return false
  }
}

/**
 * Standalone detection that survives `matchMedia` being absent (older
 * embedded webviews) by falling back to the iOS-only `navigator.standalone`
 * signal. Exported for the regression tests that pin that fallback.
 */
export function isStandaloneMode(): boolean {
  try {
    if (
      typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches
    ) {
      return true
    }
  } catch {
    // matchMedia can throw on a malformed query — fall through.
  }
  return (window.navigator as NavigatorWithStandalone).standalone === true
}

export default function InstallPrompt() {
  const { t } = useTranslation()
  const { reduce } = useMotionPreference()
  const { capability, promptInstall, clearPrompt } = usePwaInstall()
  const [dismissed, setDismissed] = useState<boolean>(() => wasDismissedRecently())

  const handleInstall = useCallback(async () => {
    await promptInstall()
    // Retire the banner regardless of the outcome: the event is single-use,
    // so leaving it up would wire the button to a consumed (null) handle.
    setDismissed(true)
  }, [promptInstall])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    clearPrompt()
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Ignore storage failures; dismissing still hides the prompt for this render.
    }
    broadcast({ type: 'install.dismissed' })
  }, [clearPrompt])

  // When another tab dismisses the install prompt,
  // hide it here too so the user doesn't have to dismiss it on every tab.
  useEffect(() => {
    return subscribe((m) => {
      if (m.type === 'install.dismissed') {
        setDismissed(true)
      }
    })
  }, [])

  const showNative = capability === 'native-prompt'
  const showIosGuide = capability === 'ios-manual'
  const visible = !dismissed && (showNative || showIosGuide)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 60 }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[9998] mx-auto max-w-md lg:inset-x-auto lg:right-4 lg:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] lg:w-[28rem]"
        >
          <div
            role="status"
            aria-live="polite"
            data-testid="install-prompt"
            data-install-capability={capability}
            className="flex w-full items-start gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--surface-1)] px-3 py-3 text-[var(--text-primary)] shadow-xl backdrop-blur-xl sm:px-4"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#00f0ff] to-[#10b981]">
              {showIosGuide ? (
                <Share className="h-5 w-5 text-[var(--text-inverse)]" aria-hidden="true" />
              ) : (
                <Download className="h-5 w-5 text-[var(--text-inverse)]" aria-hidden="true" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight text-[var(--text-primary)]">
                {t('installPrompt.title', 'Install TeslaSync')}
              </p>

              {showIosGuide ? (
                // No fake button: iOS has no install API, so the only honest
                // affordance is the exact sequence of taps.
                <div data-testid="install-prompt-ios-steps" className="mt-1">
                  <p className="text-xs leading-tight text-[var(--text-secondary)]">
                    {t(
                      'installPrompt.ios.intro',
                      'iOS installs web apps from the Safari share menu — there is no automatic install button.',
                    )}
                  </p>
                  <ol className="mt-1.5 space-y-1 text-xs leading-tight text-[var(--text-secondary)]">
                    <li className="flex items-center gap-1.5">
                      <Share className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden="true" />
                      <span>
                        {t('installPrompt.ios.step1', 'Tap the Share button in Safari.')}
                      </span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <SquarePlus
                        className="h-3.5 w-3.5 shrink-0 text-cyan-300"
                        aria-hidden="true"
                      />
                      <span>
                        {t('installPrompt.ios.step2', 'Choose Add to Home Screen.')}
                      </span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Download
                        className="h-3.5 w-3.5 shrink-0 text-cyan-300"
                        aria-hidden="true"
                      />
                      <span>{t('installPrompt.ios.step3', 'Confirm with Add.')}</span>
                    </li>
                  </ol>
                </div>
              ) : (
                <p className="text-xs leading-tight mt-0.5 text-[var(--text-secondary)]">
                  {t('installPrompt.subtitle', 'Add to home screen for native experience')}
                </p>
              )}
            </div>

            {showNative && (
              <Button
                type="button"
                onClick={handleInstall}
                size="sm"
                data-testid="install-prompt-install"
                className="h-8 shrink-0 rounded-lg bg-gradient-to-br from-[#00f0ff] to-[#10b981] px-3 text-xs font-semibold text-[var(--text-inverse)] hover:opacity-90"
              >
                {t('installPrompt.install', 'Install')}
              </Button>
            )}
            <Button
              type="button"
              onClick={handleDismiss}
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 rounded-lg p-0 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
              aria-label={t('installPrompt.dismiss', 'Dismiss install prompt')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
