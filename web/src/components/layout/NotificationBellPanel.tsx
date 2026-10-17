import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/dateFormat'
import { Button } from '@/components/ui/Button'
import { ErrorDisplay } from '@/components/feedback/ErrorDisplay'
import { StaleRefreshWarning } from '@/components/feedback/StaleRefreshWarning'
import { useDataState } from '@/hooks/useDataState'
import { typography } from '@/lib/tokens'
import { useBulkMarkRead, useUnreadNotifications, useAlertRules } from '@/api/hooks/useNotifications'
import { useVehicles } from '@/api/hooks/useVehicles'
import type { AlertRule } from '@/api/types'
import type { Vehicle } from '@/types/vehicle'

const PREVIEW_LIMIT = 10
const POPOVER_WIDTH_PX = 360

type Severity = 'info' | 'warn' | 'critical'

const NotificationSeverityFilter = lazy(() => import('./NotificationSeverityFilter'))

const SEVERITY_TONE: Record<Severity, { dot: string; ring: string; label: string }> = {
  info: { dot: 'bg-[var(--semantic-info)]', ring: 'ring-[var(--semantic-info-border)]', label: 'Info' },
  warn: { dot: 'bg-[var(--semantic-warning)]', ring: 'ring-[var(--semantic-warning-border)]', label: 'Warning' },
  critical: { dot: 'bg-[var(--semantic-danger)]', ring: 'ring-[var(--semantic-danger-border)]', label: 'Critical' },
}

function severityOf(rule?: AlertRule): Severity {
  const sev = (rule?.severity ?? 'info') as Severity
  if (sev === 'warn' || sev === 'critical') return sev
  return 'info'
}

// Selectors used by the focus trap. Mirrors the established
// `web/src/lib/focusTrap.ts` selector set but inlined so this file
// stays self-contained (the dialog is small and short-lived).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface NotificationBellPanelProps {
  headingId: string
  coords: { top: number; right: number }
  unreadBadgeCount: number
  onClose: () => void
  onNavigate: (to: string) => void
}

const NotificationBellPanel = forwardRef<HTMLDivElement, NotificationBellPanelProps>(
  function NotificationBellPanel(
    { headingId, coords, unreadBadgeCount, onClose, onNavigate },
    forwardedRef,
  ) {
    const { t } = useTranslation()
    const dialogRef = useRef<HTMLDivElement | null>(null)

    const unreadQuery = useUnreadNotifications({ limit: PREVIEW_LIMIT })
    const unreadState = useDataState(unreadQuery)
    const logs = unreadState.data ?? []
    const error = unreadState.fatalError
    const { data: rules = [] } = useAlertRules()
    const { data: vehicles = [] } = useVehicles()
    const bulkMarkRead = useBulkMarkRead()

    const ruleMap = useMemo(() => {
      const m: Record<number, AlertRule> = {}
      for (const r of rules ?? []) {
        if (r?.id != null) m[r.id] = r
      }
      return m
    }, [rules])

    // Filters and counts cover only the fetched preview; "Mark all read"
    // remains global even when a severity is selected.
    const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all')
    const severities = logs.map((log) =>
      severityOf(log.alert_id != null ? ruleMap[log.alert_id] : undefined),
    )
    const visibleLogs = severityFilter === 'all'
      ? logs
      : logs.filter((_, index) => severities[index] === severityFilter)
    const selectedSeverityLabel = severityFilter === 'critical'
      ? t('notifications.bellPopover.sentenceCritical', 'critical')
      : severityFilter === 'warn'
        ? t('notifications.bellPopover.sentenceWarning', 'warning')
        : t('notifications.bellPopover.sentenceInfo', 'info')

    const vehicleMap = useMemo(() => {
      const m: Record<number, Vehicle> = {}
      for (const v of vehicles ?? []) {
        if (v?.id != null) m[v.id] = v
      }
      return m
    }, [vehicles])

    // Compose internal + forwarded ref. We need our own ref for the
    // focus trap; the parent needs one for outside-click detection.
    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        dialogRef.current = node
        if (typeof forwardedRef === 'function') {
          forwardedRef(node)
        } else if (forwardedRef) {
          const mutable = forwardedRef as MutableRefObject<HTMLDivElement | null>
          mutable.current = node
        }
      },
      [forwardedRef],
    )

    // Auto-focus the first interactive element on mount. If the panel is
    // empty (no unread items and no actions yet rendered), focus the
    // dialog itself — the parent has set tabIndex={-1} for that case.
    useEffect(() => {
      const node = dialogRef.current
      if (!node) return
      const first = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      if (first) {
        first.focus()
      } else {
        node.focus()
      }
    }, [])

    // Tab cycle focus trap — keep keyboard focus within the dialog so
    // shift+tab from the first action wraps to the last and vice versa.
    const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Tab') return
      const node = dialogRef.current
      if (!node) return
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    const handleMarkAllRead = useCallback(() => {
      // Empty preview means there's nothing to mark — the badge can
      // still be > 0 transiently after a manual mark, but firing the
      // mutation in that window is a harmless no-op server-side.
      if (logs.length === 0) return
      bulkMarkRead.mutate({ all: true })
    }, [bulkMarkRead, logs.length])

    const positionStyle: CSSProperties = {
      position: 'fixed',
      top: coords.top,
      right: coords.right,
      width: POPOVER_WIDTH_PX,
      maxWidth: 'calc(100vw - 1rem)',
    }

    const hasLogs = logs.length > 0
    const showSpinner = unreadQuery.isLoading && !unreadState.hasData

    return (
      // role="dialog" with onKeyDown is the WAI-ARIA pattern for a
      // non-modal dialog: Tab is trapped inside, Escape closes (handled
      // by the parent's document-level keydown). The eslint rule treats
      // dialogs as non-interactive containers, but a focus-trapped panel
      // genuinely needs keyboard event handling — same justification as
      // DataTableResizer's slider-equivalent role.
      /* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
      <div
        ref={setRefs}
        role="dialog"
        aria-modal="false"
        aria-labelledby={headingId}
        id={`${headingId}-panel`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={positionStyle}
        className="z-shell-panel flex max-h-notification-panel flex-col overflow-hidden rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] shadow-e2 forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3">
          <div className="flex min-w-0 flex-col break-words">
            <h2 id={headingId} className={cn(typography.role.body, typography.weight.semibold)}>
              {t('notifications.bellPopover.title', 'Notifications')}
            </h2>
            <p className={typography.role.caption}>
              {unreadBadgeCount > 0
                ? t('notifications.bellPopover.unreadCount', '{{count}} unread', {
                    count: unreadBadgeCount,
                  })
                : t('notifications.bellPopover.allRead', 'All caught up')}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
            className="h-11 w-11 shrink-0 p-0 text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] md:h-9 md:w-9"
          >
            <Icons.close className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>

        {hasLogs && (
          <Suspense fallback={null}>
            <NotificationSeverityFilter
              value={severityFilter}
              onChange={setSeverityFilter}
              severities={severities}
              previewCount={logs.length}
              totalUnread={unreadBadgeCount}
              tones={SEVERITY_TONE}
            />
          </Suspense>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <StaleRefreshWarning state={unreadState} />
          {bulkMarkRead.error && (
            <ErrorDisplay
              compact
              error={bulkMarkRead.error}
              message={t('toast.notifications.markRead.error', 'Failed to mark as read')}
            />
          )}
          {showSpinner && (
            <div
              className={cn('flex items-center justify-center py-8', typography.role.caption)}
              role="status"
              aria-live="polite"
            >
              {t('notifications.bellPopover.loading', 'Loading…')}
            </div>
          )}

          {!showSpinner && error && (
            <div
              className={cn('flex flex-col items-center gap-1 py-8 px-4 text-center', typography.role.error)}
              role="alert"
            >
              <Icons.warning className="h-5 w-5" aria-hidden="true" />
              <span>
                {t('notifications.bellPopover.error', 'Could not load notifications')}
              </span>
            </div>
          )}

          {!showSpinner && !error && !hasLogs && (
            <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
              <Icons.notifications
                className="h-8 w-8 text-[var(--text-muted)]"
                aria-hidden="true"
              />
              <p className={cn(typography.role.body, typography.weight.medium)}>
                {t('notifications.bellPopover.emptyTitle', "You're all caught up")}
              </p>
              <p className={typography.role.caption}>
                {t(
                  'notifications.bellPopover.emptyMessage',
                  'No unread notifications right now.',
                )}
              </p>
            </div>
          )}

          {!showSpinner && !error && hasLogs && visibleLogs.length === 0 && (
            <div
              className={cn('flex flex-col items-center gap-1 px-4 py-8 text-center', typography.role.caption)}
              role="status"
            >
              {t('notifications.bellPopover.emptyFiltered', 'No matches in this preview. Open the inbox for older notifications.')}
            </div>
          )}

          {!showSpinner && !error && visibleLogs.length > 0 && (
            <ul className="divide-y divide-[var(--border-subtle)]" data-testid="bell-popover-list">
              {visibleLogs.map((log) => {
                const rule = log.alert_id != null ? ruleMap[log.alert_id] : undefined
                const vehicle =
                  rule?.vehicle_id != null ? vehicleMap[rule.vehicle_id] : undefined
                const sev = severityOf(rule)
                const tone = SEVERITY_TONE[sev]
                return (
                  <li key={log.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onNavigate('/notifications/inbox')}
                      className="group flex h-auto min-h-11 w-full items-start gap-3 px-4 py-3 text-start hover:bg-[var(--control-bg-hover)] focus-visible:bg-[var(--control-bg-hover)] focus-visible:-outline-offset-2"
                    >
                      <span
                        aria-label={tone.label}
                        className={cn(
                          'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ring-2',
                          tone.dot,
                          tone.ring,
                        )}
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-baseline gap-2">
                          <span className={cn('min-w-0 break-words', typography.role.body, typography.weight.medium)}>
                            {log.title || rule?.name || t('notifications.bellPopover.untitled', 'Notification')}
                          </span>
                        </span>
                        {log.message && (
                          <span className={cn('mt-0.5 break-words', typography.size.xs, typography.color.secondary)}>
                            {log.message}
                          </span>
                        )}
                        <span className={cn('mt-1 flex flex-wrap items-center gap-1.5', typography.role.caption)}>
                          <span>{formatRelative(log.created_at)}</span>
                          {vehicle && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="min-w-0 break-words">
                                {vehicle.display_name || `#${vehicle.id}`}
                              </span>
                            </>
                          )}
                        </span>
                      </span>
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] bg-[var(--surface-2)] px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={!hasLogs || bulkMarkRead.isPending}
            wrapLabel
            className={cn('min-h-11 gap-1.5 px-2 py-1 hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] md:min-h-9', typography.size.xs, typography.weight.medium, typography.color.secondary)}
          >
            <Icons.confirm className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {t('notifications.bellPopover.markAllRead', 'Mark all read')}
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onNavigate(
              severityFilter === 'all'
                ? '/notifications/inbox'
                : `/notifications/inbox?severity=${severityFilter}&read=unread`,
            )}
            wrapLabel
            className={cn('min-h-11 gap-1 px-2 py-1 hover:bg-[var(--control-bg-hover)] md:min-h-9', typography.size.xs, typography.weight.medium, typography.color.primary)}
          >
            <span>
              {severityFilter === 'all'
                ? t('notifications.bellPopover.viewAll', 'Open full inbox')
                : t('notifications.bellPopover.viewAllSeverity', 'See all {{severity}} unread', {
                    severity: selectedSeverityLabel,
                  })}
            </span>
            <Icons.next className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </footer>
      </div>
      /* eslint-enable jsx-a11y/no-noninteractive-element-interactions */
    )
  },
)

export default NotificationBellPanel
