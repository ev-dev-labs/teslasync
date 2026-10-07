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
import { Button } from '@/components/ui'
import { useBulkMarkRead, useUnreadNotifications, useAlertRules } from '@/api/hooks/useNotifications'
import { useVehicles } from '@/api/hooks/useVehicles'
import type { AlertRule } from '@/api/types'
import type { Vehicle } from '@/types/vehicle'

const PREVIEW_LIMIT = 10
const POPOVER_WIDTH_PX = 360

type Severity = 'info' | 'warn' | 'critical'

const NotificationSeverityFilter = lazy(() => import('./NotificationSeverityFilter'))

const SEVERITY_TONE: Record<Severity, { dot: string; ring: string; label: string }> = {
  info: { dot: 'bg-sky-400', ring: 'ring-sky-400/30', label: 'Info' },
  warn: { dot: 'bg-amber-400', ring: 'ring-amber-400/30', label: 'Warning' },
  critical: { dot: 'bg-rose-500', ring: 'ring-rose-400/40', label: 'Critical' },
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

    const {
      data: logs = [],
      isLoading,
      error,
    } = useUnreadNotifications({ limit: PREVIEW_LIMIT })
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
      ? t('notifications.bellPopover.filterCritical', 'Critical')
      : severityFilter === 'warn'
        ? t('notifications.bellPopover.filterWarning', 'Warning')
        : t('notifications.bellPopover.filterInfo', 'Info')

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
    const showSpinner = isLoading && !hasLogs

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
        className="z-[80] flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--surface-1)] shadow-2xl forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--glass-border)] px-4 py-3">
          <div className="flex flex-col">
            <h2 id={headingId} className="text-sm font-semibold text-[var(--text-primary)]">
              {t('notifications.bellPopover.title', 'Notifications')}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
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
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
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
          {showSpinner && (
            <div
              className="flex items-center justify-center py-8 text-xs text-[var(--text-muted)]"
              role="status"
              aria-live="polite"
            >
              {t('notifications.bellPopover.loading', 'Loading…')}
            </div>
          )}

          {!showSpinner && error && (
            <div
              className="flex flex-col items-center gap-1 py-8 px-4 text-center text-xs text-rose-300"
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
                className="h-8 w-8 text-[var(--text-muted)] opacity-60"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t('notifications.bellPopover.emptyTitle', "You're all caught up")}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {t(
                  'notifications.bellPopover.emptyMessage',
                  'No unread notifications right now.',
                )}
              </p>
            </div>
          )}

          {!showSpinner && !error && hasLogs && visibleLogs.length === 0 && (
            <div
              className="flex flex-col items-center gap-1 px-4 py-8 text-center text-xs text-[var(--text-muted)]"
              role="status"
            >
              {t('notifications.bellPopover.emptyFiltered', 'No matches in this preview. Open the inbox for older notifications.')}
            </div>
          )}

          {!showSpinner && !error && visibleLogs.length > 0 && (
            <ul className="divide-y divide-white/[0.04]" data-testid="bell-popover-list">
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
                      className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500"
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
                          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                            {log.title || rule?.name || t('notifications.bellPopover.untitled', 'Notification')}
                          </span>
                        </span>
                        {log.message && (
                          <span className="mt-0.5 line-clamp-1 text-xs text-[var(--text-secondary)]">
                            {log.message}
                          </span>
                        )}
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                          <span>{formatRelative(log.created_at)}</span>
                          {vehicle && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">
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

        <footer className="flex items-center justify-between gap-2 border-t border-[var(--glass-border)] bg-[var(--surface-2)] px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={!hasLogs || bulkMarkRead.isPending}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-cyan-300 hover:bg-white/[0.06] hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
          >
            <span>
              {severityFilter === 'all'
                ? t('notifications.bellPopover.viewAll', 'Open full inbox')
                : t('notifications.bellPopover.viewAllSeverity', 'See all {{severity}} unread', {
                    severity: selectedSeverityLabel.toLowerCase(),
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
