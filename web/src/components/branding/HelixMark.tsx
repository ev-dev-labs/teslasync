// Helix brand mark — the canonical icon for TeslaSync's AI assistant.
//
// Rendered everywhere "Helix" is referenced as a brand surface (sidebar
// nav entry, chatbot avatar, AI feature badges, thinking indicator, AI
// settings header). Per `web/src/lib/icons.ts` (the canonical
// concept-to-icon registry), brand assets live under
// `components/branding/`, NOT in the lucide-backed icon registry — this
// file is the Helix-specific exception.
//
// Visual: a stylised vertical double helix. Two intertwined sinusoidal
// strands meet at the centre and flare apart at top/bottom; two
// horizontal "rungs" connect them at y=7 and y=17 — the points where
// the strands run roughly parallel. The strands use `currentColor` so
// the caller picks the brand tint via Tailwind text-* classes (cyan
// for AI surfaces, purple for chatbot, etc.).
//
// API surface: deliberately matches Lucide's `LucideIcon` so the mark
// is a drop-in replacement anywhere a Lucide icon is consumed (the
// sidebar navSections.icon field, the Avatar primitive's generic
// glyph slot, etc.). Accepts `size`, `color`, `strokeWidth`,
// `className`, plus any SVG attribute (notably `data-testid` and
// `aria-hidden` are forwarded to the SVG root via prop spread, which
// the Avatar primitive relies on to set `data-testid="avatar-glyph"`).

import { forwardRef } from 'react'
import type { LucideIcon, LucideProps } from 'lucide-react'

const HELIX_VIEWBOX = '0 0 24 24'

/**
 * HelixMark — the static Helix brand icon.
 *
 * Default props mirror Lucide conventions (`size=24`, `color='currentColor'`,
 * `strokeWidth=1.75`, `fill='none'`). The slightly thinner stroke vs Lucide's
 * default 2 keeps the two crossing strands legible at small sizes (16-24px
 * sidebar/badge usages).
 */
export const HelixMark: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(
  function HelixMark(
    {
      size = 24,
      color = 'currentColor',
      strokeWidth = 1.75,
      absoluteStrokeWidth,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    // Match Lucide's absoluteStrokeWidth semantics: when set, strokes are
    // rendered at a constant pixel width regardless of `size` by scaling
    // relative to the 24px viewBox. Guard the divisor: a non-positive or
    // non-numeric `size` (e.g. `0` or `'2em'`) would otherwise divide by
    // zero/NaN and leak `Infinity`/`NaN` into the DOM `stroke-width`. Fall
    // back to the raw `strokeWidth` in that case — behaviour is identical
    // for every valid (size > 0) input.
    const numericSize = Number(size)
    const effectiveStroke =
      absoluteStrokeWidth && Number.isFinite(numericSize) && numericSize > 0
        ? (Number(strokeWidth) * 24) / numericSize
        : strokeWidth

    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox={HELIX_VIEWBOX}
        fill="none"
        stroke={color}
        strokeWidth={effectiveStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...rest}
      >
        {/* Strand A: top-left → centre → bottom-right via two quadratic
            bulges. Control points (18,7) and (6,17) push the curve out
            to the right at y≈7 and to the left at y≈17 respectively. */}
        <path d="M 8 2 Q 18 7 12 12 Q 6 17 16 22" />
        {/* Strand B: mirrored about x=12, so the two strands cross at the
            centre and form the X-shape at top-quarter / bottom-quarter
            of the helix. */}
        <path d="M 16 2 Q 6 7 12 12 Q 18 17 8 22" />
        {/* Two horizontal "rungs" connecting the strands at the points
            where they run nearly parallel. The strand midpoints at
            t=0.5 of each quadratic land at (10|14, 7) and (10|14, 17). */}
        <line x1="10" y1="7" x2="14" y2="7" />
        <line x1="10" y1="17" x2="14" y2="17" />
        {children}
      </svg>
    )
  },
) as LucideIcon

HelixMark.displayName = 'HelixMark'
