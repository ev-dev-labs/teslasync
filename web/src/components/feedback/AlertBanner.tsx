import { type ReactNode, type HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { X } from 'lucide-react'

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger'

export interface AlertBannerProps extends HTMLAttributes<HTMLDivElement> {
  variant: AlertVariant
  title?: string
  children: ReactNode
  onClose?: () => void
  icon?: ReactNode
  /**
   * Accessible label for the dismiss control. Defaults to a translated
   * "Dismiss"; pass a more specific label (e.g. "Dismiss offline warning")
   * when several banners can share the screen.
   */
  closeLabel?: string
}

const alertVariantMap: Record<AlertVariant, { border: string; bg: string; text: string; titleText: string }> = {
  info:    { border: 'border-neon-cyan/20',   bg: 'bg-neon-cyan/5',   text: 'text-cyan-800 dark:text-cyan-200',       titleText: 'text-cyan-800 dark:text-cyan-300' },
  success: { border: 'border-neon-green/20',  bg: 'bg-neon-green/5',  text: 'text-emerald-800 dark:text-emerald-200', titleText: 'text-emerald-800 dark:text-emerald-300' },
  warning: { border: 'border-neon-amber/20',  bg: 'bg-neon-amber/5',  text: 'text-amber-800 dark:text-amber-200',      titleText: 'text-amber-800 dark:text-amber-300' },
  danger:  { border: 'border-neon-red/20',    bg: 'bg-neon-red/5',    text: 'text-rose-800 dark:text-rose-200',       titleText: 'text-rose-800 dark:text-rose-300' },
}

/**
 * AlertBanner — persistent, page-level inline notification (info / success /
 * warning / danger).
 *
 * Use AlertBanner for messages that should remain on screen until either the
 * underlying condition resolves or the user dismisses them — e.g. "Tesla
 * connection expired — reconnect", "Vehicle is offline", "Beta feature".
 *
 * For transient feedback after a user-initiated mutation (saved settings,
 * deleted rule, sent test alert, …), use the toast system instead — see
 * `useMutationToast()` from `@/api/hooks/_toastHelpers` and the
 * `<ToastProvider>` mounted in `main.tsx`. Toasts auto-dismiss after 4s and
 * stack at the bottom-right; AlertBanners stay rendered in-flow.
 *
 * For "the live data pipe has been down for >2 minutes", do not roll your
 * own AlertBanner — drop in `<LiveStaleDataBanner />` from the same module
 * (`@/components/feedback`). It wraps AlertBanner with the right copy,
 * threshold, and `useLiveConnection` wiring.
 */
export function AlertBanner({ variant, title, children, onClose, icon, className, closeLabel, ...props }: AlertBannerProps) {
  const { t } = useTranslation()
  const v = alertVariantMap[variant] ?? alertVariantMap.info
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-4 backdrop-blur-sm', v.border, v.bg, className)} {...props}>
      {icon && <div className={cn('shrink-0 mt-0.5', v.titleText)} aria-hidden>{icon}</div>}
      <div className="flex-1 min-w-0">
        {title && <p className={cn('text-sm font-medium', v.titleText)}>{title}</p>}
        <div className={cn('text-xs', v.text, title && 'mt-0.5')}>{children}</div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel ?? t('common.dismiss', 'Dismiss')}
          className={cn(
            'shrink-0 rounded-lg p-1.5 transition-colors hover:bg-[var(--surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-current',
            v.text,
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}
