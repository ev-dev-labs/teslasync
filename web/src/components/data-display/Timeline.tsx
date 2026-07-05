import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export interface TimelineItemData {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  time: string;
  color?: string;
}

export interface TimelineProps {
  items: TimelineItemData[];
  className?: string;
  /**
   * Message shown in place of the list when there are no items. Callers that
   * already guard the empty case upstream never reach this; it exists so an
   * unguarded `<Timeline items={[]} />` (or a nullish `items`) degrades to a
   * labelled placeholder instead of a silent blank panel.
   */
  emptyMessage?: string;
}

export function Timeline({ items, className, emptyMessage }: TimelineProps) {
  const { t } = useTranslation();
  const list = items ?? [];

  if (list.length === 0) {
    return (
      <div
        role="status"
        className={cn(
          'flex items-center justify-center py-8 text-center text-sm text-[var(--text-muted)]',
          className,
        )}
      >
        {emptyMessage ?? t('timeline.empty', 'No timeline entries yet.')}
      </div>
    );
  }

  return (
    <div className={cn('relative space-y-4', className)}>
      {list.map((item, i) => (
        <div key={i} className="relative flex gap-3 pl-6">
          {/* connector line — decorative */}
          {i < list.length - 1 && (
            <span
              aria-hidden="true"
              className="absolute left-[11px] top-6 h-full w-px bg-gray-200 dark:bg-gray-700"
            />
          )}

          {/* dot / icon */}
          <span
            aria-hidden={item.icon ? undefined : true}
            className={cn(
              'absolute left-0 top-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 bg-white dark:bg-gray-900',
              item.color ? undefined : 'border-gray-300 text-[var(--text-muted)] dark:border-gray-600',
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
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {item.title}
              </span>
              <span className="shrink-0 text-xs text-[var(--text-muted)]">
                {item.time}
              </span>
            </div>
            {item.subtitle && (
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{item.subtitle}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
