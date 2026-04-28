import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui'

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
  const { t } = useTranslation()
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
          className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[9998] mx-auto max-w-md lg:inset-x-auto lg:right-4 lg:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] lg:w-[28rem]"
        >
          <div
            className="flex w-full items-start gap-3 rounded-2xl border border-white/[0.08] bg-slate-950/90 px-3 py-3 shadow-xl backdrop-blur-xl sm:items-center sm:px-4"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#00f0ff] to-[#10b981]">
              <Download className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight text-white/90">
                {t('installPrompt.title', 'Install TeslaSync')}
              </p>
              <p className="text-xs leading-tight mt-0.5 text-white/40">
                {t('installPrompt.subtitle', 'Add to home screen for native experience')}
              </p>
            </div>
            <Button
              type="button"
              onClick={handleInstall}
              size="sm"
              className="h-8 shrink-0 rounded-lg bg-gradient-to-br from-[#00f0ff] to-[#10b981] px-3 text-xs font-semibold text-white hover:opacity-90"
            >
              {t('installPrompt.install', 'Install')}
            </Button>
            <Button
              type="button"
              onClick={handleDismiss}
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 rounded-lg p-0 text-white/40 hover:bg-white/10"
              aria-label={t('installPrompt.dismiss', 'Dismiss install prompt')}
            >
              <X className="h-4 w-4 text-white/40" />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
