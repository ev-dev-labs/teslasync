import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui'
import { useUnreadCount } from '@/api/hooks/useNotifications'
import { useIsMobile } from '@/hooks/useMediaQuery'

const POPOVER_WIDTH_PX = 360
const NotificationBellPanel = lazy(() => import('./NotificationBellPanel'))

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
      : t('notifications.bellPopover.title', 'Notifications')

  return (
    <div
      ref={containerRef}
      className={cn('relative inline-block', className)}
      data-role="notification-bell-popover"
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
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
            className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-2xs font-bold text-[var(--text-primary)] shadow ring-1 ring-rose-300/60"
          >
            {display}
          </span>
        )}
      </Button>

      {open &&
        coords &&
        createPortal(
          <Suspense
            fallback={
              <div
                id={`${headingId}-panel`}
                role="status"
                aria-live="polite"
                style={{ position: 'fixed', top: coords.top, right: coords.right, width: POPOVER_WIDTH_PX }}
                className="z-[80] max-w-[calc(100vw-1rem)] rounded-xl border border-[var(--glass-border)] bg-[var(--surface-1)] px-4 py-8 text-center text-xs text-[var(--text-muted)] shadow-2xl"
              >
                {t('notifications.bellPopover.loading', 'Loading…')}
              </div>
            }
          >
            <NotificationBellPanel
              ref={popoverRef}
              headingId={headingId}
              coords={coords}
              unreadBadgeCount={count}
              onClose={close}
              onNavigate={navigateAndClose}
            />
          </Suspense>,
          document.body,
        )}
    </div>
  )
}

export default NotificationBellPopover
