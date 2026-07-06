import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { tableTokens } from '@/lib/tokens'

/**
 * Pointer capture lets a drag continue when the pointer leaves the ~1.5px
 * handle, but it is a best-effort convenience: it is unavailable in some
 * environments (jsdom, older engines) and `set`/`releasePointerCapture` can
 * throw (`NotFoundError` / `InvalidStateError`) when the pointer is no longer
 * active. A resize gesture must never break because of it, so both calls are
 * feature-detected and their throw paths swallowed.
 */
function capturePointer(el: Element, pointerId: number) {
  try {
    el.setPointerCapture?.(pointerId)
  } catch {
    /* capture is optional — the gesture still works via bubbled events */
  }
}

function releasePointer(el: Element, pointerId: number) {
  try {
    el.releasePointerCapture?.(pointerId)
  } catch {
    /* nothing was captured (or unsupported) — safe to ignore */
  }
}

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
  const { t } = useTranslation()
  const startX = useRef(0)
  const startWidth = useRef(0)
  // Tracks the most recent width emitted during the gesture so `onResizeEnd`
  // reports the value the user actually dragged/keyed to — even when the
  // parent is uncontrolled or updates `width` asynchronously. The keyboard
  // path already forwards its computed `next`; this keeps the pointer path
  // consistent instead of echoing a potentially-stale `width` prop.
  const lastWidth = useRef(width)
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
      lastWidth.current = width
      setDragging(true)
      capturePointer(e.currentTarget, e.pointerId)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      const delta = e.clientX - startX.current
      const next = clamp(startWidth.current + delta)
      lastWidth.current = next
      onResize(next)
    },
    [dragging, clamp, onResize],
  )

  const finishDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      setDragging(false)
      releasePointer(e.currentTarget, e.pointerId)
      onResizeEnd?.(lastWidth.current)
    },
    [dragging, onResizeEnd],
  )

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null
      if (e.key === 'ArrowLeft') next = clamp(width - 8)
      else if (e.key === 'ArrowRight') next = clamp(width + 8)
      else if (e.key === 'Home') next = clamp(80)
      else if (e.key === 'End') next = clamp(maxWidth)
      if (next === null) return
      e.preventDefault()
      lastWidth.current = next
      onResize(next)
      onResizeEnd?.(next)
    },
    [clamp, width, maxWidth, onResize, onResizeEnd],
  )

  // The handle isn't a button, so swallow clicks to keep header-cell sort
  // handlers from firing when the user finishes a resize on the boundary.
  const stopClickPropagation = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => e.stopPropagation(),
    [],
  )

  // If the component unmounts mid-drag, drop the dragging flag. The browser
  // auto-releases any active pointer capture when the element leaves the DOM.
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
      aria-label={label ?? t('table.columns.resizeLabel', 'Resize column {{col}}', { col: columnKey })}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      className={cn(tableTokens.resizer, dragging && 'opacity-100 bg-cyan-400/60')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={onKeyDown}
      onClick={stopClickPropagation}
    />
    /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  )
}
