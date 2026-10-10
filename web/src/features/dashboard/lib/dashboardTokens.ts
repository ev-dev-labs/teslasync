import { typography } from '@/lib/tokens';

/** Dashboard content is hosted by the canvas panel; these tokens add no card chrome. */
export const dashboardTokens = {
  shell: 'relative flex h-full min-w-0 flex-col',
  header: 'flex shrink-0 flex-wrap items-start justify-between gap-x-3 gap-y-2 pl-4 pr-[var(--dashboard-widget-chrome-inset,1rem)] pb-2 pt-3',
  title: `${typography.size.sm} ${typography.weight.semibold} ${typography.color.primary} leading-snug`,
  description: `${typography.role.bodySm} mt-1 break-words leading-snug`,
  body: '@container min-w-0 flex-1 min-h-0',
  footer: 'shrink-0 border-t border-[var(--border-subtle)] px-4 py-2',
  metric: `${typography.size['2xl']} ${typography.weight.semibold} ${typography.color.primary} tabular-nums leading-tight`,
  secondaryMetric: `${typography.size.lg} ${typography.weight.semibold} ${typography.color.primary} tabular-nums leading-tight`,
  metricLabel: `${typography.role.bodySm} break-words leading-snug`,
  unit: `${typography.role.caption} shrink-0`,
  stat: '!min-h-0 !rounded-none !border-0 !bg-transparent !p-0 !shadow-none [&_.text-2xl]:text-xl [&_.text-2xl]:font-semibold',
  columns: {
    1: 'grid-cols-1',
    2: 'grid-cols-1 @xs:grid-cols-2',
    3: 'grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3',
    4: 'grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-4',
  },
} as const;
