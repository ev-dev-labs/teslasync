import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const icons: Record<ToastType, ReactNode> = {
  success: <CheckCircle className="h-5 w-5" />,
  error: <AlertCircle className="h-5 w-5" />,
  info: <Info className="h-5 w-5" />,
  warning: <AlertTriangle className="h-5 w-5" />,
}

const styles: Record<ToastType, { border: string; icon: string; glow: string }> = {
  success: { border: 'border-neon-green/30', icon: 'text-neon-green', glow: 'shadow-[0_0_20px_rgba(16,185,129,0.15)]' },
  error: { border: 'border-tesla-red/30', icon: 'text-tesla-red', glow: 'shadow-[0_0_20px_rgba(227,25,55,0.15)]' },
  info: { border: 'border-neon-cyan/30', icon: 'text-neon-cyan', glow: 'shadow-[0_0_20px_rgba(0,240,255,0.15)]' },
  warning: { border: 'border-neon-amber/30', icon: 'text-neon-amber', glow: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]' },
}

let toastCounter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = `toast-${++toastCounter}`
    const duration = opts.duration ?? 4000
    setToasts(prev => [...prev.slice(-4), { ...opts, id }])
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
  }, [dismiss])

  const value: ToastContextValue = {
    toast: addToast,
    success: (title, message) => addToast({ type: 'success', title, message }),
    error: (title, message) => addToast({ type: 'error', title, message }),
    info: (title, message) => addToast({ type: 'info', title, message }),
    warning: (title, message) => addToast({ type: 'warning', title, message }),
    dismiss,
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none" style={{ maxWidth: 380 }} aria-live="assertive" aria-atomic="true">
        <AnimatePresence mode="popLayout">
          {toasts.map(t => {
            const s = styles[t.type]
            return (
              <motion.div
                key={t.id}
                layout
                role="alert"
                aria-live="assertive"
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 80, scale: 0.95 }}
                transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                className={clsx(
                  'pointer-events-auto rounded-xl border backdrop-blur-xl p-4',
                  s.border, s.glow
                )}
                style={{ background: 'var(--surface-2)' }}
              >
                <div className="flex items-start gap-3">
                  <div className={clsx('mt-0.5 flex-shrink-0', s.icon)}>
                    {icons[t.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{t.title}</p>
                    {t.message && <p className="mt-0.5 text-xs text-[var(--text-secondary)] line-clamp-2">{t.message}</p>}
                  </div>
                  <button
                    onClick={() => dismiss(t.id)}
                    aria-label={`Dismiss ${t.type} notification: ${t.title}`}
                    className="flex-shrink-0 rounded-lg p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.05] transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
