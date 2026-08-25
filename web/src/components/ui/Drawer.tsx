import { type ReactNode, useEffect, useId, useRef } from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { Heading, Text } from './Typography'

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export type DrawerSize = 'sm' | 'md' | 'lg'

const DRAWER_WIDTHS: Record<DrawerSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
}

let openDrawerCount = 0
let preservedBodyOverflow = ''

function lockBodyScroll() {
  if (openDrawerCount === 0) {
    preservedBodyOverflow = document.body.style.overflow
  }
  openDrawerCount += 1
  document.body.style.overflow = 'hidden'
}

function unlockBodyScroll() {
  openDrawerCount = Math.max(0, openDrawerCount - 1)
  if (openDrawerCount === 0) {
    document.body.style.overflow = preservedBodyOverflow
  }
}

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  headerMeta?: ReactNode
  tabs?: ReactNode
  footer?: ReactNode
  side?: 'left' | 'right'
  size?: DrawerSize
  className?: string
  /**
   * Accessible label for the dialog when no visible `title` is rendered.
   * Required by ARIA when the dialog has no heading — defaults to a
   * translated "Panel" so the surface is never announced anonymously.
   */
  ariaLabel?: string
}

/** Slide-in side panel. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  eyebrow,
  description,
  headerMeta,
  tabs,
  footer,
  side = 'right',
  size = 'md',
  className,
  ariaLabel,
}: DrawerProps) {
  const { t } = useTranslation()
  const drawerRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  // Keep the latest onClose without re-subscribing the focus-trap effect on
  // every parent render. Depending on `onClose` here would re-run the effect
  // whenever a caller passes an inline handler, stealing focus back to the
  // first control mid-interaction.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const drawer = drawerRef.current
    if (!drawer) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    lockBodyScroll()

    // Move focus into the dialog: the first interactive control, or the
    // dialog container itself (tabIndex={-1}) when the panel has none, so
    // keyboard focus never lingers behind the scrim.
    const focusables = drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusables.length > 0) focusables[0].focus()
    else drawer.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return }
      if (e.key !== 'Tab') return
      const current = drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (current.length === 0) { e.preventDefault(); drawer.focus(); return }
      const first = current[0]
      const last = current[current.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    drawer.addEventListener('keydown', handleKeyDown)
    return () => {
      drawer.removeEventListener('keydown', handleKeyDown)
      // Restore focus to whatever opened the drawer so keyboard users keep
      // their place in the page.
      unlockBodyScroll()
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={drawerRef}
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      aria-label={title ? undefined : (ariaLabel ?? t('common.panel', 'Panel'))}
      tabIndex={-1}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[var(--surface-overlay)] backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        initial={{ x: side === 'right' ? '100%' : '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: side === 'right' ? '100%' : '-100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        data-drawer-panel
        data-drawer-size={size}
        className={cn(
          'absolute top-0 bottom-0 flex w-full max-w-none flex-col glass-panel rounded-none border-0',
          DRAWER_WIDTHS[size],
          side === 'right' ? 'right-0 border-l border-white/[0.06]' : 'left-0 border-r border-white/[0.06]',
          className,
        )}
      >
        <div
          className="shrink-0 border-b border-white/[0.06] px-4 py-4 sm:px-6"
          data-drawer-header
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {eyebrow && (
                <Text
                  as="div"
                  size="2xs"
                  weight="semibold"
                  color="muted"
                  className="mb-1 uppercase tracking-[0.12em]"
                >
                  {eyebrow}
                </Text>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {title && (
                  <Heading id={titleId} level="panel" className="min-w-0 break-words">
                    {title}
                  </Heading>
                )}
                {headerMeta}
              </div>
              {description && (
                <Text
                  id={descriptionId}
                  as="p"
                  variant="bodySm"
                  className="mt-1.5"
                >
                  {description}
                </Text>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label={t('common.close', 'Close')}
              icon={<X className="h-4 w-4" aria-hidden="true" />}
              className="h-8 w-8 shrink-0 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            />
          </div>
        </div>
        {tabs && (
          <div
            className="shrink-0 border-b border-white/[0.06] px-4 pt-1 sm:px-6"
            data-drawer-tabs
          >
            {tabs}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6" data-drawer-body>
          {children}
        </div>
        {footer !== null && (
          <div
            className="shrink-0 border-t border-white/[0.06] bg-[var(--surface-overlay)] px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4"
            data-drawer-footer
          >
            {footer === undefined ? (
              <div className="flex justify-end">
                <Button type="button" variant="secondary" onClick={onClose}>
                  {t('common.close', 'Close')}
                </Button>
              </div>
            ) : (
              footer
            )}
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  )
}
