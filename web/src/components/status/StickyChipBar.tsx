/**
 * StickyChipBar — horizontal scrolling "jump to" navigation.
 *
 * Renders a row of pill-shaped chips that scroll to in-page anchors.
 * Sticks to the top of the viewport once scrolled into view. Mobile-
 * first: scrolls horizontally on narrow screens, fits in a row on
 * desktop. Active chip is highlighted via IntersectionObserver on the
 * referenced anchors.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'

export interface ChipItem {
  id: string
  label: string
}

export interface StickyChipBarProps {
  chips: ChipItem[]
  /** Pixel offset from the top of the viewport when stuck.  */
  topOffset?: number
  className?: string
}

export function StickyChipBar({ chips = [], topOffset = 0, className }: StickyChipBarProps) {
  const [activeId, setActiveId] = useState<string>(chips[0]?.id ?? '')
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (chips.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) {
          const top = visible.reduce((min, e) =>
            e.boundingClientRect.top < min.boundingClientRect.top ? e : min,
          )
          if (top.target.id) setActiveId(top.target.id)
        }
      },
      {
        rootMargin: `-${topOffset + 80}px 0px -60% 0px`,
        threshold: 0,
      },
    )

    chips.forEach((chip) => {
      const el = document.getElementById(chip.id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [chips, topOffset])

  const handleClick = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const navHeight = navRef.current?.offsetHeight ?? 0
    // The app's primary scroll container is the <main id="main-content">
    // element (Layout.tsx). window.scrollY is always 0. Detect the actual
    // scrollable ancestor and scroll that one; fall back to window.
    const scrollEl = document.getElementById('main-content')
    if (scrollEl) {
      const elTop = el.getBoundingClientRect().top
      const containerTop = scrollEl.getBoundingClientRect().top
      const target = scrollEl.scrollTop + (elTop - containerTop) - topOffset - navHeight - 12
      scrollEl.scrollTo({ top: target, behavior: 'smooth' })
    } else {
      const y = el.getBoundingClientRect().top + window.scrollY - topOffset - navHeight - 12
      window.scrollTo({ top: y, behavior: 'smooth' })
    }
    setActiveId(id)
  }, [topOffset])

  return (
    <nav
      ref={navRef}
      aria-label="Jump to section"
      className={cn(
        'sticky z-30 -mx-4 border-b border-white/[0.06] bg-[var(--bg-1)]/85 backdrop-blur',
        className,
      )}
      style={{ top: topOffset }}
    >
      <div
        className={cn(
          'flex gap-1.5 overflow-x-auto px-4 py-1.5',
          'scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent',
        )}
      >
        {chips.map((chip) => {
          const active = chip.id === activeId
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => handleClick(chip.id)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 transition-colors',
                typography.size.xs,
                typography.weight.medium,
                'min-h-[32px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
                active
                  ? 'bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-400/30'
                  : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
              )}
              aria-current={active ? 'true' : undefined}
            >
              {chip.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
