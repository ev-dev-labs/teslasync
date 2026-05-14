/**
 * Phase-46 / Prompt 28 — Notification bell popover.
 *
 * Replaces the bell-as-NavLink pattern with an in-place triage panel that
 * opens from the header bell. Industry pattern: latest 10 unread, plus a
 * "Mark all read" action and a "View all" escape hatch to the full
 * /notifications page for filtering, search, and bulk operations.
 *
 * Behaviour
 * ---------
 *   - Trigger:       bell icon button + unread-count badge (sourced from
 *                    `useUnreadCount`, polled every 30 s via TanStack
 *                    Query so the badge stays current without an SSE
 *                    push).
 *   - Open trigger:  desktop click → popover. Mobile (viewport ≤ 640 px,
 *                    detected via `useIsMobile`) → direct navigation to
 *                    `/notifications`. Per Blocked Path in the prompt:
 *                    popover positioning conflicts with narrow viewports,
 *                    so we fall back to the full-page route there.
 *   - Body:          `useUnreadNotifications({ limit: 10 })`. Hook is
 *                    only mounted while the popover is open — Layout is
 *                    rendered on every page so this avoids a background
 *                    fetch on every navigation.
 *   - Each row:      severity badge, title, vehicle name (joined via
 *                    `useAlertRules` + `useVehicles`), relative time.
 *                    Clicking a row navigates to `/notifications` and
 *                    closes the popover (there is no per-id detail
 *                    route; the inbox view is the canonical landing).
 *   - Footer:        "Mark all read" → `useBulkMarkRead({ all: true })`
 *                    plus a "View all" link to `/notifications`.
 *   - Dismissal:     Escape key, click-outside (mousedown anywhere
 *                    outside the trigger or panel), or focus loss after
 *                    bulk action.
 *   - Focus:         dialog auto-focuses its first focusable element on
 *                    open; Tab cycles within the dialog (focus trap);
 *                    focus returns to the trigger button on close.
 *   - Accessibility: trigger announces `aria-haspopup="dialog"` and
 *                    `aria-expanded`; dialog announces `role="dialog"`
 *                    with an aria-labelled-by header.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/dateFormat'
import {
  useBulkMarkRead,
  useUnreadCount,
  useUnreadNotifications,
  useAlertRules,
} from '@/api/hooks/useNotifications'
import { useVehicles } from '@/api/hooks/useVehicles'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { AlertRule } from '@/api/types'
import type { Vehicle } from '@/types/vehicle'

const PREVIEW_LIMIT = 10
const POPOVER_WIDTH_PX = 360

type Severity = 'info' | 'warn' | 'critical'

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

export interface NotificationBellPopoverProps {
  className?: string
}

export function NotificationBellPopover({ className }: NotificationBellPopoverProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { data: count = 0 } = useUnreadCount()

  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Track previous open state so we can return focus to the trigger only
  // when the popover transitions from open → closed (not on initial mount).
  const wasOpen = useRef(false)
  const headingId = useId()

  // Position the portaled popover relative to the trigger's bbox. Uses
  // fixed positioning so the panel stays anchored when the page scrolls;
  // capture-phase scroll listener catches nested scroll containers
  // (sidebar, main pane). Same approach as `ThemeQuickSwitcher`.
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    const update = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      // Anchor the popover's right edge to the trigger's right edge, but clamp
      // so the LEFT edge stays inside the viewport. Without this clamp, a
      // trigger placed away from the viewport's right edge (e.g. when a wide
      // overlay shifts layout, or in centered headers) lets a 360px popover
      // extend past x=0 and clip its content. Both bounds use an 8px margin.
      const margin = 8
      const desiredRight = Math.max(margin, window.innerWidth - rect.right)
      const maxRight = Math.max(margin, window.innerWidth - POPOVER_WIDTH_PX - margin)
      setCoords({
        top: rect.bottom + 8,
        right: Math.min(desiredRight, maxRight),
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  // Outside-click + Escape close. Mousedown (not click) so the dismissal
  // fires before any synthetic click that might reopen the popover via a
  // bubbled handler.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (containerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Return focus to the trigger when the popover closes — but only on a
  // genuine open→close transition. This keeps the keyboard user oriented
  // (their next Tab continues from the bell, not from <body>).
  useEffect(() => {
    if (wasOpen.current && !open) {
      triggerRef.current?.focus()
    }
    wasOpen.current = open
  }, [open])

  const handleTriggerClick = useCallback(() => {
    if (isMobile) {
      // Blocked Path fallback — the popover anchored at the right edge
      // would clip on viewports < 640 px. Treat the bell like the
      // pre-popover NavLink and navigate to the full page instead.
      navigate('/notifications/inbox')
      return
    }
    setOpen((v) => !v)
  }, [isMobile, navigate])

  const close = useCallback(() => setOpen(false), [])
  const navigateAndClose = useCallback(
    (to: string) => {
      setOpen(false)
      navigate(to)
    },
    [navigate],
  )

  const display = count > 99 ? '99+' : String(count)
  const triggerLabel =
    count > 0
      ? t('nav.notificationsUnread', '{{count}} unread notifications', { count })
      : t('nav.notifications', 'Notifications')

  return (
    <div
      ref={containerRef}
      className={cn('relative inline-block', className)}
      data-role="notification-bell-popover"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${headingId}-panel` : undefined}
        aria-label={triggerLabel}
        onClick={handleTriggerClick}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
      >
        <Icons.notifications className="h-5 w-5" aria-hidden="true" />
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow ring-1 ring-rose-300/60"
          >
            {display}
          </span>
        )}
      </button>

      {open &&
        coords &&
        createPortal(
          <NotificationBellPanel
            ref={popoverRef}
            headingId={headingId}
            coords={coords}
            unreadBadgeCount={count}
            onClose={close}
            onNavigate={navigateAndClose}
          />,
          document.body,
        )}
    </div>
  )
}

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
            <p className="text-[11px] text-[var(--text-muted)]">
              {unreadBadgeCount > 0
                ? t('notifications.bellPopover.unreadCount', '{{count}} unread', {
                    count: unreadBadgeCount,
                  })
                : t('notifications.bellPopover.allRead', 'All caught up')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
          >
            <Icons.close className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

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

          {!showSpinner && !error && hasLogs && (
            <ul className="divide-y divide-white/[0.04]" data-testid="bell-popover-list">
              {logs.map((log) => {
                const rule = log.alert_id != null ? ruleMap[log.alert_id] : undefined
                const vehicle =
                  rule?.vehicle_id != null ? vehicleMap[rule.vehicle_id] : undefined
                const sev = severityOf(rule)
                const tone = SEVERITY_TONE[sev]
                return (
                  <li key={log.id}>
                    <button
                      type="button"
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
                        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
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
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[var(--glass-border)] bg-[var(--surface-2)] px-3 py-2">
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={!hasLogs || bulkMarkRead.isPending}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icons.confirm className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {t('notifications.bellPopover.markAllRead', 'Mark all read')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/notifications/inbox')}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-cyan-300 hover:bg-white/[0.06] hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
          >
            <span>{t('notifications.bellPopover.viewAll', 'View all')}</span>
            <Icons.next className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </footer>
      </div>
      /* eslint-enable jsx-a11y/no-noninteractive-element-interactions */
    )
  },
)

export default NotificationBellPopover
