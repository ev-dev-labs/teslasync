import { type ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

export interface TabNavItem {
  key: string;
  label: string;
  icon?: ReactNode;
}

export interface TabNavProps {
  tabs: TabNavItem[];
  active: string;
  onChange: (key: string) => void;
  /** Accessible name for the tab list — provide when no visible heading already describes what the tabs switch/filter. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Horizontal tab navigation bar with icon support, built on Radix UI's Tabs
 * primitive used in "navigation" mode: `Tabs.Root` + `Tabs.List` +
 * `Tabs.Trigger` only. Every call-site owns and renders its panel content
 * itself, as a sibling of `<TabNav>` keyed off `active` (see
 * DevToolsPage/AnalyticsPage/etc.) rather than as children of this
 * component, so there is no matching `Tabs.Content` to mount here.
 *
 * Radix still supplies, for free, everything the previous hand-rolled
 * `<div>`/`<button>` markup lacked entirely:
 * - Full WAI-ARIA tablist/tab roles + `aria-selected` + `data-state`.
 * - Single-stop roving-tabindex keyboard nav: Tab/Shift+Tab move in and out
 *   of the whole tablist as one stop; ArrowLeft/ArrowRight move focus AND
 *   activate the tab (automatic activation, matching the sibling `Tabs`
 *   component's documented behavior); Home/End jump to the first/last tab;
 *   navigation loops at the ends; direction mirrors automatically in RTL.
 *   (Escape / focus-trap don't apply to the Tabs pattern — there's nothing
 *   to dismiss or trap focus within, per the WAI-ARIA APG.)
 * - A real `<button type="button">`, so a tab click can never submit an
 *   ancestor `<form>` the way the old plain `<button>` (no `type`) could.
 *
 * `aria-controls` is explicitly cleared below: Radix points it at an
 * auto-generated panel id (`{baseId}-content-{value}`) that only a real
 * `Tabs.Content` would satisfy, and none of today's call-sites render one —
 * left as-is it would be a dangling ID reference.
 */
export function TabNav({ tabs, active, onChange, ariaLabel, className }: TabNavProps) {
  return (
    <TabsPrimitive.Root value={active} onValueChange={onChange}>
      <TabsPrimitive.List
        aria-label={ariaLabel}
        className={cn(
          'flex items-center gap-1 rounded-xl bg-white/[0.02] p-1 border border-white/[0.06] overflow-x-auto scrollbar-thin',
          className,
        )}
      >
        {tabs.map(t => (
          <TabsPrimitive.Trigger
            key={t.key}
            value={t.key}
            aria-controls={undefined}
            className={cn(
              'flex min-h-11 min-w-11 items-center gap-1.5 sm:gap-2 rounded-lg px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-all duration-normal whitespace-nowrap shrink-0',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-500',
              'data-[state=active]:bg-white/[0.08] data-[state=active]:text-[var(--text-primary)] data-[state=active]:shadow-sm',
              'data-[state=inactive]:text-[var(--text-muted)] data-[state=inactive]:hover:text-[var(--text-secondary)]',
            )}
          >
            {t.icon}
            {t.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
