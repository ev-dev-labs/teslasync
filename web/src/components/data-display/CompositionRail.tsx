import type { ReactNode } from 'react';
import { Text } from '@/components/ui/Typography';
import { cn } from '@/lib/cn';

export type CompositionRailSegment = Readonly<{
  id: string;
  /** Caller-localized category name, rendered without recasing or truncation. */
  label: string;
  /** Prepared finite percentage in [0, 100]; never calculated or normalized here. */
  widthPercent: number;
  /** Caller-formatted counts, percentages or other category evidence. */
  detail?: ReactNode;
  /** Omit only the decorative fill, never the readable legend entry. */
  hideFromTrack?: boolean;
}> & (
  | { readonly fillClassName: string; readonly color?: string }
  | { readonly fillClassName?: string; readonly color: string }
);

export type CompositionRailSize = 'sm' | 'md' | 'lg';

export interface CompositionRailProps {
  readonly segments: readonly CompositionRailSegment[];
  /** Caller-localized accessible description of the categorical composition. */
  readonly summary: string;
  readonly className?: string;
  /** Track heights: sm = 2.5, md = 3, lg = 8 on the Tailwind spacing scale. */
  readonly size?: CompositionRailSize;
}

const trackHeights: Record<CompositionRailSize, string> = {
  sm: 'h-2.5',
  md: 'h-3',
  lg: 'h-8',
};

/** Presentation only: the host owns denominator, thresholds, formatting and source state. */
export function CompositionRail({
  segments,
  summary,
  className,
  size = 'sm',
}: CompositionRailProps) {
  const ids = new Set<string>();
  for (const segment of segments) {
    if (ids.has(segment.id)) {
      throw new Error(`CompositionRail: duplicate segment id "${segment.id}".`);
    }
    ids.add(segment.id);
    if (!Number.isFinite(segment.widthPercent) || segment.widthPercent < 0 || segment.widthPercent > 100) {
      throw new RangeError(
        `CompositionRail: segment "${segment.id}" widthPercent must be a finite number between 0 and 100.`,
      );
    }
  }

  return (
    <div className={cn('min-w-0 w-full space-y-3', className)}>
      <div
        role="img"
        aria-label={summary}
        className={cn(
          'flex w-full overflow-hidden rounded-pill bg-[var(--surface-2)]',
          'forced-colors:[outline-style:solid] forced-colors:outline-1 forced-colors:outline-[CanvasText]',
          trackHeights[size],
        )}
      >
        {segments.map((segment) => segment.hideFromTrack ? null : (
          <span
            key={segment.id}
            aria-hidden="true"
            className={cn(
              'h-full shrink-0 motion-reduce:transition-none motion-reduce:animate-none',
              'forced-colors:[outline-style:solid] forced-colors:outline-1 forced-colors:outline-[CanvasText] forced-colors:-outline-offset-1',
              segment.fillClassName,
            )}
            style={{ width: `${segment.widthPercent}%`, backgroundColor: segment.color }}
          />
        ))}
      </div>
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari needs an explicit role to preserve unstyled list semantics. */}
      <ul role="list" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
        {segments.map((segment) => (
          <li key={segment.id} className="flex min-w-0 max-w-full items-start gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                'forced-colors:[outline-style:solid] forced-colors:outline-1 forced-colors:outline-[CanvasText]',
                segment.fillClassName,
              )}
              style={{ backgroundColor: segment.color }}
            />
            <div className="min-w-0 break-words [overflow-wrap:anywhere]">
              <Text as="span" variant="bodySm" className="block">{segment.label}</Text>
              {segment.detail != null && (
                <Text as="span" variant="caption" className="block tabular-nums">{segment.detail}</Text>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
