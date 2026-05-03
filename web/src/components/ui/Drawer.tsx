import { type ReactNode, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { X } from 'lucide-react'

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  side?: 'left' | 'right'
  className?: string
}

/** Slide-in side panel. */
export function Drawer({ open, onClose, title, children, footer, side = 'right', className }: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const drawer = drawerRef.current
    if (!drawer) return
    const previouslyFocused = document.activeElement as HTMLElement

    const focusable = drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusable.length) focusable[0].focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const currentFocusable = drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      const first = currentFocusable[0]
      const last = currentFocusable[currentFocusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }

    drawer.addEventListener('keydown', handleKeyDown)
    return () => {
      drawer.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div ref={drawerRef} className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title || 'Panel'}>
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
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
            <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] transition-colors">
              <X className="h-4 w-4" />
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
