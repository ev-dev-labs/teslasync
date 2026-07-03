/**
 * StatusPageSkeleton — layout-shaped placeholder shown during the
 * initial fetch of the System Status page. Mirrors the real page's
 * vertical rhythm (hero → chips → 6 health rows → action items →
 * resources → 9 accordions → uptime) so there is no layout shift
 * once data loads.
 *
 * Uses the shared <Skeleton> primitive so the pulse animation
 * respects prefers-reduced-motion via Tailwind utilities.
 */

import { Skeleton } from '@/components/feedback/Skeleton'
import { GlassPanel } from '@/components/ui'

function SkeletonRow({ height = 44 }: { height?: number }) {
  return <Skeleton height={height} className="w-full" />
}

export function StatusPageSkeleton() {
  return (
    <div
      className="space-y-5 max-w-3xl mx-auto"
      role="status"
      aria-busy="true"
      aria-label="Loading system status"
      data-testid="status-page-skeleton"
    >
      {/* Hero */}
      <GlassPanel className="p-5">
        <div className="flex items-start gap-4">
          <Skeleton width="56px" height={56} rounded />
          <div className="flex-1 space-y-2">
            <Skeleton height={24} width="60%" />
            <Skeleton height={14} width="40%" />
          </div>
          <Skeleton width="120px" height={36} />
        </div>
      </GlassPanel>

      {/* Chip bar */}
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} width="92px" height={32} className="shrink-0 rounded-full" />
        ))}
      </div>

      {/* Health rows */}
      <GlassPanel className="p-3 space-y-1">
        <Skeleton height={18} width="80px" className="mb-2" />
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </GlassPanel>

      {/* Action items + Resources */}
      <GlassPanel className="p-4 space-y-2">
        <Skeleton height={18} width="180px" />
        <SkeletonRow height={32} />
        <SkeletonRow height={32} />
      </GlassPanel>

      <GlassPanel className="p-4 space-y-3">
        <Skeleton height={18} width="120px" />
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} height={28} />
        ))}
      </GlassPanel>

      {/* Accordion stubs */}
      {Array.from({ length: 4 }).map((_, i) => (
        <GlassPanel key={i} className="p-5">
          <div className="flex items-center gap-3">
            <Skeleton width="20px" height={20} />
            <div className="flex-1">
              <Skeleton height={16} width="40%" />
              <Skeleton height={12} width="60%" className="mt-1" />
            </div>
            <Skeleton width="60px" height={24} />
          </div>
        </GlassPanel>
      ))}
    </div>
  )
}
