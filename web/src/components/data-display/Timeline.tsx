import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { VisuallyHidden } from '@/components/a11y/VisuallyHidden';
import { useA11ySummary } from '@/hooks/useA11ySummary';

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
  /**
   * What the timeline covers, already translated ("Drive events",
   * "Charging history"). Used for the screen-reader summary and as the
   * list's accessible name.
   */
  label?: string;
}

export function Timeline({ items, className, emptyMessage, label }: TimelineProps) {
  const { t } = useTranslation();
  const { describeTimeline } = useA11ySummary();
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

  const resolvedLabel = label ?? t('timeline.label', 'Timeline');
  // A11Y-10: the rail of dots and connectors is decorative, so without a
  // summary a screen-reader user gets an undifferentiated run of
  // fragments with no sense of how many entries there are or what span
  // they cover. Entries are pre-formatted by the caller, so the summary
  // always agrees with the visible timestamps.
  const summary = describeTimeline({
    label: resolvedLabel,
    count: list.length,
    start: list.length > 0 ? list[list.length - 1]?.time : null,
    end: list.length > 0 ? list[0]?.time : null,
  });

  return (
    <div className={cn('relative space-y-4', className)}>
      <VisuallyHidden>{summary}</VisuallyHidden>
      <ol className="relative space-y-4" aria-label={resolvedLabel}>
        {list.map((item, i) => (
          <li key={i} className="relative flex gap-3 pl-6">
          {/* connector line — decorative */}
          {i < list.length - 1 && (
            <span
              aria-hidden="true"
              className="absolute left-[11px] top-6 h-full w-px bg-[var(--panel-border)]"
            />
          )}

          {/* dot / icon */}
          <span
            aria-hidden={item.icon ? undefined : true}
            className={cn(
              // The dot sits on top of the connector line, so it must be filled
              // with the surrounding panel surface to punch a clean hole in it.
              'absolute left-0 top-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 bg-[var(--panel-bg)]',
              item.color ? undefined : 'border-[var(--control-border)] text-[var(--text-muted)]',
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
        </li>
      ))}
      </ol>
    </div>
  );
}
