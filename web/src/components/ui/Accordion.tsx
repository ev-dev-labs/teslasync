import { type ReactNode, useState } from 'react'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { cn } from '../../lib/cn'
import { ChevronDown } from 'lucide-react'

interface AccordionProps {
  title: string
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

// Stable value for this Accordion's single Radix item. Each <Accordion>
// renders its own single-item Root, so the value namespace is isolated and
// a fixed key never collides with sibling accordions on the page.
const ITEM_VALUE = 'section'

/**
 * Collapsible content section with an animated reveal, built on Radix UI's
 * `Accordion` primitive (`@radix-ui/react-accordion`, a single collapsible
 * item in `type="single" collapsible` mode) instead of a hand-rolled
 * `<button>` + `aria-expanded`. Radix primitives render unstyled, so the
 * existing glassmorphism Tailwind classes and the Framer Motion
 * height/opacity reveal are ported verbatim onto the Radix parts — the
 * visual design and motion are unchanged.
 *
 * The external prop API is unchanged: controlled when both `open` and
 * `onOpenChange` are supplied, otherwise uncontrolled from `defaultOpen`.
 * The component keeps owning that state and drives Radix as a fully
 * controlled Root, so every existing call-site keeps working untouched.
 *
 * What Radix adds over the previous hand-rolled version:
 * - The trigger now lives inside an `<h3>` heading (Radix `Header`) — the
 *   WAI-ARIA Accordion pattern, so screen-reader users can jump between
 *   sections by heading. It renders a real `<button type="button">` with
 *   `aria-expanded` and `aria-controls` wired to the content region, and
 *   the content is a `role="region"` labelled by the trigger (`id` /
 *   `aria-labelledby`) — none of which the old bare button exposed.
 * - Keyboard: Enter/Space toggle (native button) plus Radix's own
 *   Home/End/Arrow header navigation, verified by Radix's test suite
 *   rather than ours.
 * - A visible `focus-visible` ring, drawn inset so the parent's
 *   `overflow-hidden` rounded clip can't crop it, replaces the previous
 *   no-focus-style button.
 *
 * Mobile: the trigger carries `min-h-11` (44px — WCAG 2.5.5 / Apple HIG
 * touch-target floor) independent of the overridable `headerClassName`
 * padding, so the tap target stays ≥44px even when a caller passes tighter
 * padding.
 *
 * Motion: Radix `Content` is `forceMount`ed so it stays mounted/unhidden
 * and Framer Motion fully owns the reveal — `AnimatePresence` mounts the
 * body only while `open`, preserving the previous behavior of unmounting
 * heavy children (e.g. the signal catalog tree) when collapsed instead of
 * keeping them mounted. `useReducedMotion` collapses the reveal to an
 * instant snap for users who ask for reduced motion.
 */
export function Accordion({
  title,
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
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }
  const prefersReducedMotion = useReducedMotion()

  return (
    <AccordionPrimitive.Root
      type="single"
      collapsible
      value={open ? ITEM_VALUE : ''}
      onValueChange={(value) => setOpen(value === ITEM_VALUE)}
      className={cn(
        'rounded-xl border border-white/[0.06] overflow-hidden forced-colors:border-[ButtonBorder]',
        className,
      )}
    >
      <AccordionPrimitive.Item value={ITEM_VALUE}>
        <AccordionPrimitive.Header className="flex">
          <AccordionPrimitive.Trigger
            className={cn(
              'flex w-full min-h-11 items-center gap-3 text-left transition-colors',
              'hover:bg-white/[0.02]',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500',
              headerClassName ?? 'px-4 py-3',
            )}
          >
            {icon && <div className="text-[var(--text-muted)]">{icon}</div>}
            <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">{title}</span>
            {badge}
            {headerExtra}
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-normal',
                open && 'rotate-180',
              )}
            />
          </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
        <AccordionPrimitive.Content forceMount>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                key="body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
                className="overflow-hidden"
              >
                <div className={cn('border-t border-white/[0.04]', bodyClassName ?? 'px-4 py-3')}>
                  {children}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </AccordionPrimitive.Content>
      </AccordionPrimitive.Item>
    </AccordionPrimitive.Root>
  )
}
