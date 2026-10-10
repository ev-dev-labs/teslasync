import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { VisuallyHidden } from '@/components/a11y/VisuallyHidden';
import { useA11ySummary } from '@/hooks/useA11ySummary';
import { Text } from '@/components/ui/Typography';

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
  /**
   * Chronology used only to infer accessible summary bounds from the endpoint
   * rows. Never reorders items or parses their caller-formatted timestamps.
   * Defaults to newest-first for existing feeds.
   */
  chronology?: 'newest-first' | 'oldest-first';
  /**
   * Authoritative, caller-formatted oldest/newest bounds for the accessible
   * summary, independent of row order (including causal, nonchronological
   * lists). When supplied, missing/null/empty bounds stay unknown; neither
   * bound is inferred from rows. The range is spoken only when both are known.
   */
  summaryBounds?: { start?: string | null; end?: string | null };
}

export function Timeline({
  items,
  className,
  emptyMessage,
  label,
  chronology = 'newest-first',
  summaryBounds,
}: TimelineProps) {
  const { t } = useTranslation();
  const { describeTimeline } = useA11ySummary();
  const list = items ?? [];

  if (list.length === 0) {
    return (
      <Text
        as="div"
        variant="bodySm"
        role="status"
        className={cn(
          'flex min-w-0 items-center justify-center break-words py-8 text-center',
          className,
        )}
      >
        {emptyMessage ?? t('timeline.empty', 'No timeline entries yet.')}
      </Text>
    );
  }

  const resolvedLabel = label ?? t('timeline.label', 'Timeline');
  // A11Y-10: the rail of dots and connectors is decorative, so without a
  // summary a screen-reader user gets an undifferentiated run of
  // fragments with no sense of how many entries there are or what span
  // they cover. Entries are pre-formatted by the caller, so the summary
  // uses their labels verbatim. Explicit bounds take precedence because causal
  // order need not be chronological; unknown bounds must not be fabricated.
  const bounds = summaryBounds ?? {
    start: chronology === 'oldest-first' ? list[0]?.time : list[list.length - 1]?.time,
    end: chronology === 'oldest-first' ? list[list.length - 1]?.time : list[0]?.time,
  };
  const summary = describeTimeline({
    label: resolvedLabel,
    count: list.length,
    start: bounds.start,
    end: bounds.end,
  });

  return (
    <div className={cn('relative min-w-0 space-y-4', className)}>
      <VisuallyHidden>{summary}</VisuallyHidden>
      <ol className="relative space-y-4" aria-label={resolvedLabel}>
        {list.map((item, i) => (
          <li key={i} className="relative flex min-w-0 gap-3 ps-8">
          {/* connector line — decorative */}
          {i < list.length - 1 && (
            <span
              aria-hidden="true"
              className="absolute start-3 top-6 h-full w-px bg-[var(--panel-border)]"
            />
          )}

          {/* dot / icon */}
          <span
            aria-hidden={item.icon ? undefined : true}
            className={cn(
              // The dot sits on top of the connector line, so it must be filled
              // with the surrounding panel surface to punch a clean hole in it.
              'absolute start-0 top-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 bg-[var(--panel-bg)]',
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
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
              <Text size="sm" weight="medium" color="primary" className="min-w-0 flex-1 basis-48 break-words">
                {item.title}
              </Text>
              <Text variant="caption" className="max-w-full break-words">
                {item.time}
              </Text>
            </div>
            {item.subtitle != null && item.subtitle !== false && item.subtitle !== '' && (
              <Text as="p" variant="caption" className="mt-0.5 whitespace-pre-wrap break-words">{item.subtitle}</Text>
            )}
          </div>
        </li>
      ))}
      </ol>
    </div>
  );
}
