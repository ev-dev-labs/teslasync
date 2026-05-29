import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/cn'
import { tableTokens } from '@/lib/tokens'

interface DataTableResizerProps {
  /** Column key for aria/labels. */
  columnKey: string
  /** Current width in px. */
  width: number
  /** Minimum allowed width when resizing. */
  minWidth?: number
  /** Maximum allowed width when resizing. */
  maxWidth?: number
  /** Called continuously while the user drags. */
  onResize: (next: number) => void
  /** Called once when the user releases the pointer (use for persistence). */
  onResizeEnd?: (final: number) => void
  /** Optional accessible label override. */
  label?: string
}

/**
 * Drag handle that resizes a `<th>`. Uses pointer events so it works on mouse,
 * pen, and touch. Captures the pointer for the duration of the drag so the
 * user can move outside the column boundary without losing the gesture.
 *
 * Keyboard support: Left/Right arrow shrinks/grows by 8px increments, Home
 * resets to 80px, End maxes out at maxWidth (or 800px fallback).
 */
export function DataTableResizer({
  columnKey,
  width,
  minWidth = 60,
  maxWidth = 800,
  onResize,
  onResizeEnd,
  label,
}: DataTableResizerProps) {
  const startX = useRef(0)
  const startWidth = useRef(0)
  const [dragging, setDragging] = useState(false)

  const clamp = useCallback(
    (n: number) => Math.max(minWidth, Math.min(maxWidth, Math.round(n))),
    [minWidth, maxWidth],
  )

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      startX.current = e.clientX
      startWidth.current = width
      setDragging(true)
      ;(e.target as HTMLDivElement).setPointerCapture(e.pointerId)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      const delta = e.clientX - startX.current
      onResize(clamp(startWidth.current + delta))
    },
    [dragging, clamp, onResize],
  )

  const finishDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      setDragging(false)
      ;(e.target as HTMLDivElement).releasePointerCapture(e.pointerId)
      onResizeEnd?.(width)
    },
    [dragging, onResizeEnd, width],
  )

  // Cleanup safety: if the component unmounts mid-drag, release capture flag.
  useEffect(() => () => setDragging(false), [])

  return (
    // This resizer follows WAI-ARIA Authoring Practices'
    // "Window Splitter Pattern" which uses
    // role="separator" with aria-valuenow/min/max + tabIndex={0} so
    // keyboard users can pick the splitter and arrow-key resize it. The
    // jsx-a11y rule treats `separator` as non-interactive by default, but
    // when it owns aria-valuenow + a keyboard handler it functions as a
    // slider-equivalent. The keyboard support is implemented below
    // (ArrowLeft/ArrowRight/Home/End) so the pattern is genuinely
    // accessible.
    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label ?? `Resize column ${columnKey}`}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      className={cn(tableTokens.resizer, dragging && 'opacity-100 bg-cyan-400/60')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          const next = clamp(width - 8)
          onResize(next)
          onResizeEnd?.(next)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          const next = clamp(width + 8)
          onResize(next)
          onResizeEnd?.(next)
        } else if (e.key === 'Home') {
          e.preventDefault()
          const next = clamp(80)
          onResize(next)
          onResizeEnd?.(next)
        } else if (e.key === 'End') {
          e.preventDefault()
          const next = clamp(maxWidth)
          onResize(next)
          onResizeEnd?.(next)
        }
      }}
      // The handle isn't a button so click-bubbling doesn't trigger sort.
      onClick={(e) => e.stopPropagation()}
    />
    /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  )
}
