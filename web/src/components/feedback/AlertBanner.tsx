import { type ReactNode, type HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { Button } from '@/components/ui/runtime'
import { Text } from '@/components/ui/Typography'
import { severityTokens } from '@/lib/tokens'
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

const alertVariantMap = {
  info: severityTokens.info,
  success: severityTokens.success,
  warning: severityTokens.warn,
  danger: severityTokens.critical,
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
    <div className={cn('flex min-w-0 items-start gap-3 rounded-panel border p-4 shadow-none forced-colors:bg-[Canvas] forced-colors:border-[CanvasText] forced-colors:text-[CanvasText]', v.border, v.bg, className)} {...props}>
      {icon && <div className={cn('shrink-0 mt-0.5 forced-colors:text-[CanvasText]', v.fg)} aria-hidden>{icon}</div>}
      <div className="flex-1 min-w-0 break-words">
        {title && <Text as="p" size="sm" weight="semibold" color="primary" className="forced-colors:text-[CanvasText]">{title}</Text>}
        <Text as="div" variant="body" className={cn('leading-relaxed forced-colors:text-[CanvasText]', title && 'mt-1')}>{children}</Text>
      </div>
      {onClose && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label={closeLabel ?? t('common.dismiss', 'Dismiss')}
          className={cn(
            'h-11 w-11 md:h-8 md:w-8 shrink-0 rounded-shape-sm p-0',
          )}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}
