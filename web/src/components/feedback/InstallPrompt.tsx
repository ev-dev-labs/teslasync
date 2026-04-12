import { useState, useEffect, useCallback } from 'react'
import { Download, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'teslasync-pwa-install-dismissed'
const DISMISS_DAYS = 14

function wasDismissedRecently(): boolean {
  const raw = localStorage.getItem(DISMISS_KEY)
  if (!raw) return false
  const ts = Number(raw)
  return Date.now() - ts < DISMISS_DAYS * 86_400_000
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (wasDismissedRecently()) return

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setVisible(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setVisible(false)
    }
    setDeferredPrompt(null)
  }, [deferredPrompt])

  const handleDismiss = useCallback(() => {
    setVisible(false)
    setDeferredPrompt(null)
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 60 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-2rem)] max-w-md pb-safe"
          style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div
            className="flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-xl"
            style={{
              background: 'var(--glass-bg, rgba(15,15,25,0.85))',
              borderColor: 'var(--glass-border, rgba(255,255,255,0.08))',
            }}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#00f0ff] to-[#10b981]">
              <Download className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--text-primary, #fff)' }}>
                Install TeslaSync
              </p>
              <p className="text-xs leading-tight mt-0.5" style={{ color: 'var(--text-muted, rgba(255,255,255,0.5))' }}>
                Add to home screen for native experience
              </p>
            </div>
            <button
              onClick={handleInstall}
              className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              style={{ background: 'linear-gradient(135deg, #00f0ff, #10b981)' }}
            >
              Install
            </button>
            <button
              onClick={handleDismiss}
              className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/10"
              aria-label="Dismiss install prompt"
            >
              <X className="h-4 w-4" style={{ color: 'var(--text-muted, rgba(255,255,255,0.5))' }} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
