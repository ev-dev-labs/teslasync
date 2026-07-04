import { type ComponentPropsWithoutRef, type ElementType } from 'react';
import { cn } from '@/lib/cn';

export interface MasonryProps extends ComponentPropsWithoutRef<'div'> {
  /** Element to render as. Defaults to a `div`; pass `section`/`ul` etc. */
  as?: ElementType;
}

/**
 * Masonry column layout for cards of varying heights.
 *
 * Uses CSS multi-column instead of a CSS grid so that a short card never
 * leaves a large vertical gap beneath it. With `grid ... items-start`, every
 * row is as tall as its tallest card, so shorter cards in that row are
 * followed by dead space until the next row — the "uneven gaps between cards"
 * problem on dense status/settings dashboards. Multi-column packs each card
 * directly beneath the previous one in its column instead.
 *
 * Pass the responsive column counts via `className` using full static
 * utilities (so Tailwind can detect them), e.g.
 * `columns-1 lg:columns-2 xl:columns-3`. The column gutter and the vertical
 * spacing between stacked cards are both baked in at `1rem` (matching the
 * former `gap-4`), and each direct child is kept whole (`break-inside-avoid`).
 *
 * Note: cards flow top-to-bottom within a column, then to the next column, so
 * reading order becomes column-major rather than the grid's row-major order.
 */
export function Masonry({ as: Tag = 'div', className, children, ...rest }: MasonryProps) {
  return (
    <Tag
      className={cn('gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
