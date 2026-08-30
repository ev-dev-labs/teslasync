import { useTranslation } from 'react-i18next'

import { Caption, Text } from '@/components/ui'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'

import { POSTURE_CATEGORIES, type PostureCategory } from './helpers'

/**
 * Per-category presentation.
 *
 * Every entry pairs a colour with an ICON and an explicit LABEL: colour is
 * never the only carrier of meaning (WCAG 1.4.1), and the categories are
 * genuinely different facts rather than shades of "bad".
 */
const CATEGORY_PRESENTATION: Record<
  PostureCategory,
  { icon: typeof Icons.success; tone: string; dot: string }
> = {
  reporting: {
    icon: Icons.success,
    tone: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  offline: {
    icon: Icons.wifiOff,
    tone: 'text-slate-700 dark:text-slate-300',
    dot: 'bg-slate-400',
  },
  unverified: {
    icon: Icons.helpCircle,
    tone: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  stale: {
    icon: Icons.clock,
    tone: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  missing: {
    icon: Icons.info,
    tone: 'text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  failed: {
    icon: Icons.warning,
    tone: 'text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
}

interface PostureTaxonomyProps {
  counts: Record<PostureCategory, number>
  /** True until the first batch resolves; renders em dashes instead of zeros. */
  pending: boolean
}

/**
 * The six-way posture breakdown.
 *
 * Rendered as a definition list so a screen reader reads "Reporting: 2" rather
 * than two orphaned strings, and ALWAYS rendered in full — including zeros —
 * so the layout does not shift as vehicles move between categories and so
 * "nothing is failing" is stated rather than merely implied by absence.
 */
export function PostureTaxonomy({ counts, pending }: PostureTaxonomyProps) {
  const { t } = useTranslation()

  const labels: Record<PostureCategory, string> = {
    reporting: t('dashboard.fleetPosture.category.reporting', 'Reporting'),
    offline: t('dashboard.fleetPosture.category.offline', 'Offline'),
    unverified: t('dashboard.fleetPosture.category.unverified', 'Unverified'),
    stale: t('dashboard.fleetPosture.category.stale', 'Last known'),
    missing: t('dashboard.fleetPosture.category.missing', 'No state'),
    failed: t('dashboard.fleetPosture.category.failed', 'Unreachable'),
  }
  const hints: Record<PostureCategory, string> = {
    reporting: t('dashboard.fleetPosture.hint.reporting', 'Current, verified telemetry'),
    offline: t('dashboard.fleetPosture.hint.offline', 'The vehicle reported itself offline'),
    unverified: t('dashboard.fleetPosture.hint.unverified', 'State returned, but nothing current backs it'),
    stale: t('dashboard.fleetPosture.hint.stale', 'Showing a retained reading after a failed refresh'),
    missing: t('dashboard.fleetPosture.hint.missing', 'Answered with no state yet — not offline'),
    failed: t('dashboard.fleetPosture.hint.failed', 'The request failed; this is about us, not the car'),
  }

  return (
    <>
      <dl
        className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"
        data-testid="fleet-posture-taxonomy"
      >
        {POSTURE_CATEGORIES.map((category) => {
          const { icon: Icon, tone, dot } = CATEGORY_PRESENTATION[category]
          return (
            <div
              key={category}
              className="grid min-h-14 grid-cols-[1.75rem_minmax(0,1fr)] grid-rows-2 items-center gap-x-2 rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-2)] px-3 py-2"
              title={hints[category]}
            >
              <dt className="col-span-2 grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-2 truncate text-xs font-medium text-[var(--text-muted)]">
                <span className="relative row-span-2 flex h-7 w-7 shrink-0 items-center justify-center">
                <Icon className={cn('h-4 w-4', tone)} aria-hidden="true" />
                <span className={cn('absolute -bottom-0.5 -end-0.5 h-1.5 w-1.5 rounded-full', dot)} aria-hidden="true" />
                </span>
                {labels[category]}
              </dt>
              <dd className={cn('col-start-2 text-lg font-semibold tabular-nums leading-tight', tone)}>
                {pending ? '—' : counts[category]}
              </dd>
            </div>
          )
        })}
      </dl>
      <Caption className="mt-2 block">
        <Text as="span" variant="caption">
          {t(
            'dashboard.fleetPosture.taxonomyHelp',
            'Unverified, last-known, no-state and unreachable are statements about our evidence — only Offline is a statement about the vehicle.',
          )}
        </Text>
      </Caption>
    </>
  )
}
