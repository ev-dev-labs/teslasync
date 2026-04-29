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
 * Auto-reloads after a short countdown so the user always gets
 * the latest version without manual intervention.
 */
export default function ReloadPrompt() {
  const { t } = useTranslation()
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl: string, registration?: ServiceWorkerRegistration) {
      if (registration) {
        setInterval(() => registration.update(), UPDATE_CHECK_INTERVAL_MS)
      }
    },
    onRegisterError(_error: unknown) {
      console.error('[SW] Registration error:', _error)
    },
  })

  const doReload = useCallback(() => {
    updateServiceWorker(true)
  }, [updateServiceWorker])

  useEffect(() => {
    if (!needRefresh) return

    setCountdown(COUNTDOWN_SECONDS)
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          doReload()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [needRefresh, doReload])

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] animate-in slide-in-from-bottom-4 fade-in duration-300">
      <GlassPanel className="!p-4 flex items-center gap-3 border border-neon-cyan/30 shadow-lg shadow-neon-cyan/10 max-w-sm">
        <div className="rounded-lg bg-neon-cyan/10 p-2">
          <RefreshCw className="h-5 w-5 text-neon-cyan animate-spin" />
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
          variant="primary"
          size="sm"
          onClick={doReload}
          className="shrink-0"
        >
          {t('pwa.reloadNow', 'Reload Now')}
        </Button>
      </GlassPanel>
    </div>
  )
}
