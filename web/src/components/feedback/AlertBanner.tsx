import { type ReactNode, type HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { SeverityIcon } from '@/components/data-display/SeverityBadge'
import { Button } from '@/components/ui/runtime'
import { Text } from '@/components/ui/Typography'
import { cn } from '@/lib/cn'
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
  info: 'info',
  success: 'success',
  warning: 'warn',
  danger: 'critical',
} as const

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
  const tone = Object.prototype.hasOwnProperty.call(alertVariantMap, variant) ? variant : 'info'
  const severity = alertVariantMap[tone]
  const v = severityTokens[severity]
  const severityLabel = {
    info: () => t('severity.info', 'Info'),
    success: () => t('severity.success', 'Success'),
    warn: () => t('severity.warn', 'Warning'),
    critical: () => t('severity.critical', 'Critical'),
  }[severity]()
  return (
    <div data-app-part="feedback" data-app-feedback-kind="notice" data-app-tone={tone} className={cn('grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 rounded-panel border bg-[var(--surface-1)] shadow-none forced-colors:bg-[Canvas] forced-colors:border-[CanvasText] forced-colors:text-[CanvasText]', v.border, className)} {...props}>
      <div data-app-part="feedback-icon" className={cn('grid w-8 self-stretch place-items-center rounded-s-[inherit] border-e sm:w-10 forced-colors:bg-[Canvas] forced-colors:border-[CanvasText] forced-colors:text-[CanvasText]', v.bg, v.border, v.fg)} aria-hidden>
        {icon === undefined ? <SeverityIcon severity={severity} className="h-5 w-5" /> : icon}
      </div>
      <div data-app-part="feedback-content" className={cn('min-w-0 self-center py-2.5 [overflow-wrap:anywhere]', !onClose && 'pe-3')}>
        <Text data-app-part="feedback-severity" size="xs" weight="semibold" className={cn('block uppercase tracking-wide forced-colors:text-[CanvasText]', v.fg)}>{severityLabel}</Text>
        {title && <Text data-app-part="feedback-title" as="p" size="base" weight="semibold" color="primary" className="mt-0.5 forced-colors:text-[CanvasText]">{title}</Text>}
        <Text data-app-part="feedback-message" as="div" variant="body" className="mt-1 leading-relaxed forced-colors:text-[CanvasText]">{children}</Text>
      </div>
      {onClose && (
        <Button
          data-app-part="feedback-dismiss"
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label={closeLabel ?? t('common.dismiss', 'Dismiss')}
          className="my-1 me-1 h-11 w-11 shrink-0 self-center rounded-shape-sm p-0 md:h-8 md:w-8"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}
