import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { motion, AnimatePresence } from '@/components/motion'
import { Link } from 'react-router-dom'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { cn } from '@/lib/cn'

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
 * Icon and border colors align with `severityTokens` in `@/lib/tokens`.
 * Toned-down 300-level shades avoid neon accents on white, except the
 * `error` variant which keeps the brand `tesla-red` border.
 *
 * Accessibility:
 *   - Each toast renders with `role="alert"` for the `error` variant (assertive
 *     announcement) and `role="status"` for `success`/`info`/`warning` (polite
 *     announcement). Both implicitly set the appropriate `aria-live` value, so
 *     screen readers announce new toasts as they appear without us having to
 *     manage a separate live-region.
 *   - The entrance/exit animation collapses to an instant transition when the
 *     user has set `prefers-reduced-motion: reduce` (via `useMotionPreference`).
 */
type ToastType = 'success' | 'error' | 'info' | 'warning'

/**
 * Optional action rendered in the toast body.
 *
 * Two flavours, discriminated by which field is set:
 *
 *  - Navigation action: `{ label, to }` renders a React Router `<Link>`.
 *    Used by alert toasts for "View" links into the
 *    relevant context page (e.g. /battery?vehicle_id=12&t=...&signal=...).
 *
 *  - Callback action: `{ label, onClick }` renders a `<button>` that fires
 *    the supplied handler then dismisses the toast. Used by undoable bulk
 *    operations where clicking "Undo" must run
 *    arbitrary mutation code rather than navigate.
 *
 * Exactly one of `to` / `onClick` should be supplied; if both are present
 * the navigation form wins so existing call-sites stay intact.
 */
export interface ToastAction {
  /** Visible label, e.g. "View" or "Undo". */
  label: string
  /** React Router target. Use a string (path + query) — same shape as
   *  `<Link to=>`. Avoid external URLs here. Mutually exclusive with
   *  `onClick`. */
  to?: string
  /** Callback invoked when the action is clicked. The toast auto-dismisses
   *  after firing so the caller doesn't need to do that manually. Mutually
   *  exclusive with `to`. */
  onClick?: () => void
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

/**
 * useOptionalToast — non-throwing variant of {@link useToast} that returns
 * `null` when no `<ToastProvider>` is mounted in the tree. Useful for
 * primitives like `<CopyButton withToast>` that want to surface a toast when
 * available but should not crash in isolated component tests or storybook
 * stories that don't wrap with the provider.
 */
export function useOptionalToast(): ToastContextValue | null {
  return useContext(ToastContext)
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

// Errors get an assertive live-region (role="alert"); informational toasts get
// a polite one (role="status"). Both are equivalent to setting aria-live.
const ariaRole: Record<ToastType, 'alert' | 'status'> = {
  success: 'status',
  error:   'alert',
  info:    'status',
  warning: 'status',
}

let toastCounter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const { reduce } = useMotionPreference()

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
                role={ariaRole[t.type]}
                aria-live={ariaRole[t.type] === 'alert' ? 'assertive' : 'polite'}
                aria-atomic="true"
                layout
                initial={reduce ? false : { opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: 80, scale: 0.95 }}
                transition={reduce ? { duration: 0 } : { type: 'spring', bounce: 0.2, duration: 0.4 }}
                className={cn(
                  'pointer-events-auto rounded-xl border backdrop-blur-xl p-4 bg-white/[0.03]',
                  // Windows High Contrast / forced-colors mode.
                  // Toast borders are tinted alpha (e.g. `border-emerald-500/30`)
                  // and the box-shadow glow is suppressed entirely under
                  // `forced-colors: active`. Without an explicit system-colour
                  // border the toast turns into floating text against the
                  // Canvas background. Pin the boundary + opaque Canvas bg so
                  // the toast remains perceivable for low-vision users.
                  'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
                  s.border, s.glow
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn('mt-0.5 flex-shrink-0', s.icon)} aria-hidden="true">
                    {icons[t.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{t.title}</p>
                    {t.message && <p className="mt-0.5 text-xs text-[var(--text-secondary)] line-clamp-2">{t.message}</p>}
                    {t.action && (
                      t.action.to ? (
                        <Link
                          to={t.action.to}
                          onClick={() => dismiss(t.id)}
                          className={cn(
                            'mt-2 inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded',
                            s.icon,
                          )}
                        >
                          {t.action.label} →
                        </Link>
                      ) : t.action.onClick ? (
                        <button
                          type="button"
                          onClick={() => {
                            t.action!.onClick!()
                            dismiss(t.id)
                          }}
                          className={cn(
                            'mt-2 inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded',
                            s.icon,
                          )}
                        >
                          {t.action.label}
                        </button>
                      ) : null
                    )}
                  </div>
                  <button
                    onClick={() => dismiss(t.id)}
                    aria-label="Dismiss notification"
                    className="flex-shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
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
