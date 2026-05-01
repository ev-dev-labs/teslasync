import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'

/**
 * Toast — transient mutation feedback (auto-dismisses after 4s).
 *
 * Use Toast for short-lived confirmation that a user-initiated action succeeded
 * or failed (saved settings, deleted rule, sent test alert, …). Use the
 * `useMutationToast()` helper from `@/api/hooks/_toastHelpers` to wire toasts
 * into TanStack Query mutations with i18n-aware messages.
 *
 * For persistent page-level messages (e.g. "Tesla connection expired —
 * reconnect"), use `<AlertBanner>` from `@/components/feedback/AlertBanner`
 * instead — toasts are not durable and disappear on their own.
 *
 * Icon and border colors are aligned with `severityTokens` in `@/lib/tokens`
 * (Phase-40 Prompt 09) — toned-down 300-level shades on white instead of neon
 * accents — except the `error` variant which keeps the brand `tesla-red`
 * border.
 */
type ToastType = 'success' | 'error' | 'info' | 'warning'

/**
 * Optional action link rendered in the toast body. Currently used by alert
 * toasts (Phase 40 / Prompt 14) to add a "View" link that drills through to
 * the relevant context page (e.g. /battery?vehicle_id=12&t=...&signal=...).
 */
export interface ToastAction {
  /** Visible link label, e.g. "View". */
  label: string
  /** React Router target. Use a string (path + query) — same shape as
   *  `<Link to=>`. Avoid external URLs here. */
  to: string
}

interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
  action?: ToastAction
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

// Colors mirror severityTokens from @/lib/tokens — body text/icons use the
// toned-down 300-level shade rather than neon. The `error` variant intentionally
// keeps `border-tesla-red/30` because Tesla red is a brand color, not neon.
const styles: Record<ToastType, { border: string; icon: string; glow: string }> = {
  success: { border: 'border-emerald-500/30', icon: 'text-emerald-300', glow: 'shadow-[0_0_20px_rgba(16,185,129,0.15)]' },
  error:   { border: 'border-tesla-red/30',   icon: 'text-red-300',     glow: 'shadow-[0_0_20px_rgba(227,25,55,0.15)]' },
  info:    { border: 'border-sky-500/30',     icon: 'text-sky-300',     glow: 'shadow-[0_0_20px_rgba(56,189,248,0.15)]' },
  warning: { border: 'border-amber-500/30',   icon: 'text-amber-300',   glow: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]' },
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
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[100] flex flex-col gap-3 pointer-events-none safe-bottom" style={{ maxWidth: 'min(380px, calc(100vw - 2rem))' }}>
        <AnimatePresence mode="popLayout">
          {toasts.map(t => {
            const s = styles[t.type]
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 80, scale: 0.95 }}
                transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                className={clsx(
                  'pointer-events-auto rounded-xl border backdrop-blur-xl p-4 bg-white/[0.03]',
                  s.border, s.glow
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={clsx('mt-0.5 flex-shrink-0', s.icon)}>
                    {icons[t.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{t.title}</p>
                    {t.message && <p className="mt-0.5 text-xs text-[var(--text-secondary)] line-clamp-2">{t.message}</p>}
                    {t.action && (
                      <Link
                        to={t.action.to}
                        onClick={() => dismiss(t.id)}
                        className={clsx(
                          'mt-2 inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline',
                          s.icon,
                        )}
                      >
                        {t.action.label} →
                      </Link>
                    )}
                  </div>
                  <button
                    onClick={() => dismiss(t.id)}
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
