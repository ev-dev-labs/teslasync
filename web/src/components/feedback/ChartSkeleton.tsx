import { cn } from '@/lib/cn'

/** Skeleton shaped like a chart area — shows animated bars growing. */
export function ChartSkeleton({ className = '', bars = 7 }: { className?: string; bars?: number }) {
  return (
    <div className={cn('rounded-xl bg-white/[0.02] p-4 flex items-end gap-2', className)}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded-t bg-white/[0.04] animate-skeleton-wave"
          style={{
            height: `${25 + Math.sin(i * 0.9) * 20 + Math.random() * 30}%`,
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  )
}
