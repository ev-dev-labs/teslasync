import { type ReactNode, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../../lib/cn'
import { ChevronDown } from 'lucide-react'

interface AccordionProps {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  icon?: ReactNode
  badge?: ReactNode
  className?: string
}

/** Collapsible content section with animated reveal. */
export function Accordion({ title, children, defaultOpen = false, icon, badge, className }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cn('rounded-xl border border-white/[0.06] overflow-hidden', className)}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        {icon && <div className="text-[var(--text-muted)]">{icon}</div>}
        <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">{title}</span>
        {badge}
        <ChevronDown className={cn('h-4 w-4 text-[var(--text-muted)] transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.04] px-4 py-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
