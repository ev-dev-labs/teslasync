import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { Button, GlassPanel } from '../ui'

/**
 * Shows a non-intrusive banner when a new version is deployed.
 * Uses service worker update detection — when the SW finds new assets,
 * the user is prompted to reload and get the latest version.
 */
export default function ReloadPrompt() {
  const [dismissed, setDismissed] = useState(false)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl: string, registration?: ServiceWorkerRegistration) {
      // Check for updates every 5 minutes
      if (registration) {
        setInterval(() => registration.update(), 5 * 60 * 1000)
      }
    },
    onRegisterError(_error: unknown) {
      console.error('[SW] Registration error:', _error)
    },
  })

  if (!needRefresh || dismissed) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] animate-in slide-in-from-bottom-4 fade-in duration-300">
      <GlassPanel className="!p-4 flex items-center gap-3 border border-neon-cyan/30 shadow-lg shadow-neon-cyan/10 max-w-sm">
        <div className="rounded-lg bg-neon-cyan/10 p-2">
          <RefreshCw className="h-5 w-5 text-neon-cyan" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">New version available</p>
          <p className="text-xs text-[var(--text-muted)]">Reload to get the latest features</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => updateServiceWorker(true)}
          className="shrink-0"
        >
          Reload
        </Button>
        <button
          onClick={() => setDismissed(true)}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </GlassPanel>
    </div>
  )
}
