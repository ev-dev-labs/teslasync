import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, X } from 'lucide-react'
import { motion, AnimatePresence } from '@/components/motion'
import { Button } from '@/components/ui/runtime'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { broadcast, subscribe } from '@/lib/broadcast'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

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

function isStandaloneMode(): boolean {
  try {
    if (
      typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches
    ) {
      return true
    }
  } catch {
    // matchMedia can be absent (SSR / older embedded webviews) or throw on a
    // malformed query — fall back to the iOS-only navigator.standalone signal.
  }
  return (window.navigator as NavigatorWithStandalone).standalone === true
}

export default function InstallPrompt() {
  const { t } = useTranslation()
  const { reduce } = useMotionPreference()
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isStandaloneMode() || wasDismissedRecently()) return

    const handler = (e: Event) => {
      if (isStandaloneMode()) return
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setVisible(true)
    }

    const installedHandler = () => {
      setVisible(false)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', installedHandler)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    const promptEvent = deferredPrompt
    if (!promptEvent) return
    // `beforeinstallprompt` is single-use: once prompt() runs the browser will
    // not let us replay the saved event. Retire the banner after the native
    // dialog resolves regardless of the outcome — otherwise the Install button
    // stays wired to a consumed (null) event and silently does nothing.
    try {
      await promptEvent.prompt()
      await promptEvent.userChoice
    } catch {
      // prompt() rejects if the event was already consumed or the browser
      // refused the request; nothing to recover — retire it below.
    } finally {
      setVisible(false)
      setDeferredPrompt(null)
    }
  }, [deferredPrompt])

  const handleDismiss = useCallback(() => {
    setVisible(false)
    setDeferredPrompt(null)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Ignore storage failures; dismissing still hides the prompt for this render.
    }
    broadcast({ type: 'install.dismissed' })
  }, [])

  // When another tab dismisses the install prompt,
  // hide it here too so the user doesn't have to dismiss it on every tab.
  useEffect(() => {
    return subscribe((m) => {
      if (m.type === 'install.dismissed') {
        setVisible(false)
        setDeferredPrompt(null)
      }
    })
  }, [])

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
            className="flex w-full items-start gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--surface-1)] px-3 py-3 text-[var(--text-primary)] shadow-xl backdrop-blur-xl sm:items-center sm:px-4"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#00f0ff] to-[#10b981]">
              <Download className="h-5 w-5 text-[var(--text-inverse)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight text-[var(--text-primary)]">
                {t('installPrompt.title', 'Install TeslaSync')}
              </p>
              <p className="text-xs leading-tight mt-0.5 text-[var(--text-secondary)]">
                {t('installPrompt.subtitle', 'Add to home screen for native experience')}
              </p>
            </div>
            <Button
              type="button"
              onClick={handleInstall}
              size="sm"
              className="h-8 shrink-0 rounded-lg bg-gradient-to-br from-[#00f0ff] to-[#10b981] px-3 text-xs font-semibold text-[var(--text-inverse)] hover:opacity-90"
            >
              {t('installPrompt.install', 'Install')}
            </Button>
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
