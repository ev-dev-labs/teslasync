import { type ReactNode, type HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { Button } from '@/components/ui'
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
  info:    { border: 'border-neon-cyan/25',   bg: 'bg-neon-cyan/10',  text: 'text-cyan-800 dark:text-cyan-100',       titleText: 'text-cyan-900 dark:text-cyan-200' },
  success: { border: 'border-neon-green/25',  bg: 'bg-neon-green/10', text: 'text-emerald-800 dark:text-emerald-100', titleText: 'text-emerald-900 dark:text-emerald-200' },
  warning: { border: 'border-neon-amber/25',  bg: 'bg-neon-amber/10', text: 'text-amber-800 dark:text-amber-100',      titleText: 'text-amber-900 dark:text-amber-200' },
  danger:  { border: 'border-neon-red/25',    bg: 'bg-neon-red/10',   text: 'text-rose-800 dark:text-rose-100',       titleText: 'text-rose-900 dark:text-rose-200' },
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
    <div className={cn('flex items-start gap-3.5 rounded-panel border p-4 shadow-e1 backdrop-blur-sm', v.border, v.bg, className)} {...props}>
      {icon && <div className={cn('shrink-0 mt-0.5', v.titleText)} aria-hidden>{icon}</div>}
      <div className="flex-1 min-w-0">
        {title && <p className={cn('text-sm font-semibold', v.titleText)}>{title}</p>}
        <div className={cn('text-sm leading-relaxed', v.text, title && 'mt-1')}>{children}</div>
      </div>
      {onClose && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label={closeLabel ?? t('common.dismiss', 'Dismiss')}
          className={cn(
            'h-8 w-8 shrink-0 rounded-shape-md p-0 transition-colors hover:bg-[var(--surface-2)] focus-visible:ring-current',
            v.text,
          )}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}
