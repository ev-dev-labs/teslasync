import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export function UpdatePrompt() {
  const [showUpdate, setShowUpdate] = useState(false)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setRegistration(detail.registration)
      setShowUpdate(true)
    }
    window.addEventListener('sw-update-available', handler)
    return () => window.removeEventListener('sw-update-available', handler)
  }, [])

  function handleUpdate() {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
    setShowUpdate(false)
  }

  if (!showUpdate) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-50"
      >
        <div className="glass-panel px-4 py-3 flex items-center gap-3 border border-neon-green/20 shadow-[0_0_30px_rgba(16,185,129,0.08)]">
          <RefreshCw className="h-4 w-4 text-neon-green shrink-0" />
          <p className="text-sm text-[var(--text-secondary)]">A new version is available</p>
          <button
            onClick={handleUpdate}
            className="px-3 py-1 text-xs font-medium rounded-lg bg-neon-green/15 text-neon-green border border-neon-green/25 hover:bg-neon-green/20 transition-colors"
          >
            Update Now
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
