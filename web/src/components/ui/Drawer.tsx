import { type ReactNode, useEffect, useId, useRef } from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  side?: 'left' | 'right'
  className?: string
  /**
   * Accessible label for the dialog when no visible `title` is rendered.
   * Required by ARIA when the dialog has no heading — defaults to a
   * translated "Panel" so the surface is never announced anonymously.
   */
  ariaLabel?: string
}

/** Slide-in side panel. */
export function Drawer({ open, onClose, title, children, footer, side = 'right', className, ariaLabel }: DrawerProps) {
  const { t } = useTranslation()
  const drawerRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
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
        className={cn(
          'absolute top-0 bottom-0 flex w-full max-w-md flex-col glass-panel rounded-none border-0',
          side === 'right' ? 'right-0 border-l border-white/[0.06]' : 'left-0 border-r border-white/[0.06]',
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
            <h3 id={titleId} className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close', 'Close')}
              className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] transition-colors"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-white/[0.06] bg-[var(--surface-overlay)] px-6 py-4 backdrop-blur-xl">
            {footer}
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  )
}
