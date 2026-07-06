import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { GlassPanel } from '../ui/GlassPanel'

const COUNTDOWN_SECONDS = 3
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000

/**
 * Shows a non-intrusive banner when a new version is deployed.
 *
 * NOTE: After the switch to `registerType: 'autoUpdate'` (vite.config.ts),
 * `needRefresh` is never set to `true` by `useRegisterSW` — vite-plugin-pwa
 * wires `onNeedRefresh` only in `prompt` mode. The banner UI is therefore
 * effectively dead code in production, but the hook is still mounted for
 * its useful side effect: the periodic `registration.update()` interval
 * below makes the browser fetch the manifest every 5 minutes so newly
 * deployed builds are picked up promptly even on tabs the user keeps
 * open. The `activated` listener inside vite-plugin-pwa's autoUpdate
 * branch then drives the auto-reload — see node_modules/vite-plugin-pwa
 * /dist/client/build/react.js.
 *
 * Counts down then auto-reloads so users always run the latest version,
 * but exposes a Dismiss button to opt out (cancels the countdown and
 * hides the banner — the next page navigation or update check picks up
 * the new build).
 */
export default function ReloadPrompt() {
  const { t } = useTranslation()
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl: string, registration?: ServiceWorkerRegistration) {
      if (registration) {
        // Keep a handle so the interval can be torn down on unmount —
        // otherwise it keeps calling registration.update() forever, even
        // after this component leaves the tree, leaking a timer per mount.
        updateIntervalRef.current = setInterval(() => {
          void registration.update()
        }, UPDATE_CHECK_INTERVAL_MS)
      }
    },
    onRegisterError(error: unknown) {
      console.error('[SW] Registration error:', error)
    },
  })

  const clearCountdown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const doReload = useCallback(() => {
    clearCountdown()
    updateServiceWorker(true)
  }, [updateServiceWorker, clearCountdown])

  const dismiss = useCallback(() => {
    clearCountdown()
    setNeedRefresh(false)
  }, [clearCountdown, setNeedRefresh])

  useEffect(() => {
    if (!needRefresh) return

    setCountdown(COUNTDOWN_SECONDS)
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearCountdown()
          updateServiceWorker(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return clearCountdown
  }, [needRefresh, updateServiceWorker, clearCountdown])

  // Tear down the periodic service-worker update poll on unmount so a
  // remounted prompt never stacks multiple update() intervals.
  useEffect(
    () => () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current)
        updateIntervalRef.current = null
      }
    },
    [],
  )

  if (!needRefresh) return null

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="reload-prompt"
      className="fixed bottom-4 right-4 z-[9999] animate-in slide-in-from-bottom-4 fade-in duration-normal"
    >
      <GlassPanel className="!p-4 flex items-center gap-3 border border-neon-cyan/30 shadow-lg shadow-neon-cyan/10 max-w-sm">
        <div className="rounded-lg bg-neon-cyan/10 p-2">
          <RefreshCw className="h-5 w-5 text-neon-cyan animate-spin" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {t('pwa.newVersion', 'New version available')}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            {t('pwa.reloadingIn', 'Reloading in {{seconds}}s...', { seconds: countdown })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={dismiss}
          data-testid="reload-prompt-dismiss"
          className="shrink-0 text-[var(--text-secondary)]"
        >
          {t('pwa.later', 'Later')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={doReload}
          data-testid="reload-prompt-reload"
          className="shrink-0"
        >
          {t('pwa.reloadNow', 'Reload Now')}
        </Button>
      </GlassPanel>
    </div>
  )
}

