import * as TabsPrimitive from '@radix-ui/react-tabs';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { getLangDir } from '@/lib/i18nDir';

export interface TabItem {
  key: string;
  label: string;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (key: string) => void;
  className?: string;
  /** Optional accessible label for the tablist (overrides `aria-labelledby`). */
  ariaLabel?: string;
}

/**
 * Accessible tabs (WAI-ARIA Tabs pattern), built on Radix UI's `Tabs`
 * primitive (`@radix-ui/react-tabs`). Radix's `RovingFocusGroup` supplies:
 * - `role="tablist"` on the container, `role="tab"` + `aria-selected` +
 *   roving `tabindex` on each tab so the tab strip is one stop in the
 *   document tab order.
 * - Left/Right arrows (Up/Down if ever used at `orientation="vertical"`)
 *   move focus AND activate immediately — `activationMode="automatic"` is
 *   Radix's default and matches this component's prior hand-rolled
 *   behavior. Home/End (and Page Up/Down) jump to first/last. Disabled
 *   tabs are skipped during arrow navigation, matching before.
 * - Direction-aware arrow keys for free: ArrowLeft/ArrowRight are reversed
 *   under `dir="rtl"` so Arabic/Hebrew/Persian/Urdu users get the correct
 *   "next/previous" mapping — the old hand-rolled version always treated
 *   ArrowRight as "next" regardless of document direction.
 *
 * The component does not own the tab panels; consumers render their own
 * panel content keyed off `activeTab`, exactly as before — no call site in
 * this app renders a matching `role="tabpanel"`, so none is added here.
 *
 * `min-h-11` on each trigger is a WCAG 2.5.5 / Apple HIG touch-target floor
 * (44px) that the original px-4/py-2 padding alone didn't guarantee.
 */
export function Tabs({ tabs, activeTab, onChange, className, ariaLabel }: TabsProps) {
  // Optional chaining: many existing tests mock `react-i18next`'s
  // `useTranslation()` down to just `{ t }` (no `i18n`) — `getLangDir`
  // already treats a nullish language as `'ltr'`, so this stays safe
  // under those narrow mocks instead of throwing.
  const { i18n } = useTranslation();
  const dir = getLangDir(i18n?.language);

  return (
    <TabsPrimitive.Root value={activeTab} onValueChange={onChange} dir={dir}>
      <TabsPrimitive.List
        className={cn('flex gap-1 border-b border-gray-200 dark:border-gray-700', className)}
        aria-label={ariaLabel}
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <TabsPrimitive.Trigger
              key={tab.key}
              value={tab.key}
              disabled={tab.disabled}
              // Radix activates on `mousedown` (+ Enter/Space), not `click`,
              // so a real click still works (mousedown fires first), but a
              // bare synthetic `click` event (no preceding mousedown — the
              // pattern several existing RTL tests use) would otherwise be a
              // no-op. This redundant handler restores that path; a native
              // `disabled` button never dispatches `click` at all, so no
              // extra guard is needed here (matches the pre-Radix version).
              onClick={() => onChange(tab.key)}
              className={cn(
                'inline-flex min-h-11 items-center justify-center px-4 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500',
                selected
                  ? 'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'text-[var(--text-muted)] hover:text-gray-700 dark:text-[var(--text-muted)] dark:hover:text-gray-200',
                tab.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {tab.label}
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
