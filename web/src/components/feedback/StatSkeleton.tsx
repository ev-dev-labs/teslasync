import { useTranslation } from 'react-i18next'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { cn } from '@/lib/cn'
import { Skeleton } from './Skeleton'

interface StatSkeletonProps {
  /**
   * How many stat-card skeletons to render. Non-integer, negative and
   * non-finite values are normalised to a safe count. Defaults to 4.
   */
  count?: number
  /** Extra classes merged onto the grid container. */
  className?: string
}

// Complete, static `sm:grid-cols-N` class strings, indexed by column count.
// Tailwind's JIT compiler only emits utilities it can see as *literal* source
// text, so an interpolated `sm:grid-cols-${count}` yields a class the generated
// stylesheet never contains — the responsive column count then silently never
// applies (and inputs like 0 / -1 / NaN produce invalid utilities such as
// `sm:grid-cols-0`). Listing the finished strings keeps every utility
// statically discoverable, and therefore actually generated.
const SM_GRID_COLS = [
  '',
  'sm:grid-cols-1',
  'sm:grid-cols-2',
  'sm:grid-cols-3',
  'sm:grid-cols-4',
  'sm:grid-cols-5',
  'sm:grid-cols-6',
  'sm:grid-cols-7',
  'sm:grid-cols-8',
  'sm:grid-cols-9',
  'sm:grid-cols-10',
  'sm:grid-cols-11',
  'sm:grid-cols-12',
] as const

/**
 * Skeleton shaped like a row of stat cards, each with a label + value block.
 * Announces itself as a busy `status` region so assistive tech identifies the
 * loading state (mirrors the other shaped skeletons in this directory).
 */
export function StatSkeleton({ count = 4, className }: StatSkeletonProps) {
  const { t } = useTranslation()

  // `Array.from({ length })` and the grid-cols lookup both misbehave on
  // fractional / negative / NaN inputs. Normalise once: truncate toward zero
  // and floor at 0 (matching `Array.from`'s own ToLength semantics) so the
  // rendered card count stays stable, then clamp the responsive column class to
  // the 1–12 utilities Tailwind actually ships.
  const cards = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 4
  const colClass = SM_GRID_COLS[Math.min(12, Math.max(1, cards || 1))]

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('feedback.statSkeleton.loading', 'Loading statistics')}
      data-testid="stat-skeleton"
      className={cn('grid grid-cols-2 gap-3', colClass, className)}
    >
      {Array.from({ length: cards }).map((_, i) => (
        <GlassPanel key={i} className="p-4 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-24" />
        </GlassPanel>
      ))}
    </div>
  )
}
