import { type ReactNode, useCallback, useId, useState } from 'react'
import { motion, AnimatePresence } from '@/components/motion'
import { cn } from '../../lib/cn'
import { ChevronDown } from 'lucide-react'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { Button } from './Button'
import { Text } from './Typography'

interface AccordionProps {
  title: string
  /** Caller-localized, non-interactive rich text stacked below the title, not in headerExtra. */
  description?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  /**
   * Optional controlled open state. When both `open` and `onOpenChange`
   * are provided the component switches to controlled mode and ignores
   * `defaultOpen` (parent owns the source of truth — useful for URL
   * state, persisting across remount, or programmatic toggling).
   */
  open?: boolean
  onOpenChange?: (next: boolean) => void
  icon?: ReactNode
  badge?: ReactNode
  /** Optional content rendered to the right of the badge inside the header (e.g. inline search). */
  headerExtra?: ReactNode
  /** Override default header padding (default `px-4 py-3`). */
  headerClassName?: string
  /** Override default body padding (default `px-4 py-3`). */
  bodyClassName?: string
  className?: string
}

/** Collapsible content section with animated reveal. Controlled when `open`+`onOpenChange` provided. */
export function Accordion({
  title,
  description,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  icon,
  badge,
  headerExtra,
  headerClassName,
  bodyClassName,
  className,
}: AccordionProps) {
  const isControlled = openProp !== undefined && onOpenChange !== undefined
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = isControlled ? openProp : internalOpen
  const { reduce } = useMotionPreference()

  // Stable, unique ids wire the trigger to its panel for assistive tech
  // (WAI-ARIA disclosure pattern) and survive remounts / SSR hydration.
  const reactId = useId()
  const titleId = `${reactId}-title`
  const panelId = `${reactId}-panel`
  const descriptionId = `${reactId}-description`
  const hasDescription = description != null && description !== false && description !== ''

  const handleToggle = useCallback(() => {
    // Controlled: hand the next value to the parent (source of truth).
    // Uncontrolled: use a functional update so rapid toggles can't race a
    // stale `open` captured in this closure.
    if (isControlled) onOpenChange?.(!openProp)
    else setInternalOpen((prev) => !prev)
  }, [isControlled, onOpenChange, openProp])

  return (
    <div className={cn('rounded-xl border border-white/[0.06] overflow-hidden forced-colors:border-[CanvasText]', className)}>
      <Button
        variant="ghost"
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-labelledby={hasDescription ? titleId : undefined}
        aria-describedby={hasDescription ? descriptionId : undefined}
        className={cn(
          'flex h-auto w-full flex-wrap items-center justify-start gap-3 rounded-none text-start text-[length:inherit] font-normal hover:bg-white/[0.02] transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-inset focus-visible:ring-offset-0',
          'forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[Highlight] forced-colors:focus-visible:-outline-offset-2',
          headerClassName ?? 'px-4 py-3',
        )}
      >
        {icon && (
          <div className="text-[var(--text-muted)] shrink-0" aria-hidden="true">
            {icon}
          </div>
        )}
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <Text id={titleId} size="sm" weight="medium" color="primary" className="block forced-colors:text-[ButtonText]">
            {title}
          </Text>
          {hasDescription && (
            <Text
              id={descriptionId}
              variant="bodySm"
              className="mt-0.5 block whitespace-normal font-normal forced-colors:text-[ButtonText]"
            >
              {description}
            </Text>
          )}
        </span>
        {badge}
        {headerExtra}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-normal',
            open && 'rotate-180',
          )}
        />
      </Button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={titleId}
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            className="overflow-hidden"
          >
            <div className={cn('border-t border-white/[0.04] forced-colors:border-[CanvasText]', bodyClassName ?? 'px-4 py-3')}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
