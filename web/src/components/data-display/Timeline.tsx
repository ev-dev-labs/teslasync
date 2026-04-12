import { cn } from '@/lib/cn';

interface TimelineItemData {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  time: string;
  color?: string;
}

interface TimelineProps {
  items: TimelineItemData[];
  className?: string;
}

export function Timeline({ items, className }: TimelineProps) {
  return (
    <div className={cn('relative space-y-4', className)}>
      {items.map((item, i) => (
        <div key={i} className="relative flex gap-3 pl-6">
          {/* connector line */}
          {i < items.length - 1 && (
            <span className="absolute left-[11px] top-6 h-full w-px bg-gray-200 dark:bg-gray-700" />
          )}

          {/* dot / icon */}
          <span
            className={cn(
              'absolute left-0 top-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 bg-white dark:bg-gray-900',
              item.color ? undefined : 'border-gray-300 text-gray-400 dark:border-gray-600',
            )}
            style={item.color ? { borderColor: item.color, color: item.color } : undefined}
          >
            {item.icon ?? (
              <span
                className="block h-2 w-2 rounded-full"
                style={{ backgroundColor: item.color ?? 'currentColor' }}
              />
            )}
          </span>

          {/* content */}
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {item.title}
              </span>
              <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                {item.time}
              </span>
            </div>
            {item.subtitle && (
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{item.subtitle}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
