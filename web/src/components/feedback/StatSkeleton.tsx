import { GlassPanel } from '../ui/GlassPanel'
import { Skeleton } from './Skeleton'

/** Skeleton shaped like a stat card with a number and label. */
export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-${count} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <GlassPanel key={i} className="p-4 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-24" />
        </GlassPanel>
      ))}
    </div>
  )
}
