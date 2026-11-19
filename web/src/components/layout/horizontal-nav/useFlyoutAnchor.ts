import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

export function useFlyoutAnchor(anchor: HTMLElement | null, onDismiss: () => void) {
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<CSSProperties>({ insetInlineStart: 0, top: 0 })
  useLayoutEffect(() => {
    const element = panel.current
    if (!element || !anchor) return
    const update = () => {
      const bounds = anchor.getBoundingClientRect()
      const rail = anchor.closest('[data-horizontal-rail]')?.getBoundingClientRect()
      const viewport = document.documentElement.clientWidth
      const bottom = window.innerHeight
      if (!anchor.isConnected || bounds.right <= Math.max(0, rail?.left ?? 0) ||
        bounds.left >= Math.min(viewport, rail?.right ?? viewport) ||
        bounds.bottom <= 0 || bounds.top >= bottom) {
        onDismiss()
        return
      }
      const host = element.offsetParent?.getBoundingClientRect()
      if (!host) return
      let leftEdge = 0
      let rightEdge = viewport
      let topEdge = 0
      let bottomEdge = bottom
      // The Appearance sandbox lives inside a scrolling dialog. Keep the
      // flyout inside that focus boundary, but outside the rail's clipping.
      for (let parent = element.offsetParent?.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        const rect = parent.getBoundingClientRect()
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          leftEdge = Math.max(leftEdge, rect.left + parent.clientLeft)
          rightEdge = Math.min(rightEdge, rect.left + parent.clientLeft + parent.clientWidth)
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          topEdge = Math.max(topEdge, rect.top + parent.clientTop)
          bottomEdge = Math.min(bottomEdge, rect.top + parent.clientTop + parent.clientHeight)
        }
      }
      if (bounds.bottom <= topEdge || bounds.top >= bottomEdge || bounds.right <= leftEdge || bounds.left >= rightEdge) {
        onDismiss()
        return
      }
      const maxWidth = Math.max(0, rightEdge - leftEdge - 16)
      const width = Math.min(element.getBoundingClientRect().width, maxWidth)
      const rtl = getComputedStyle(element).direction === 'rtl'
      const ideal = rtl ? bounds.right - width : bounds.left
      const left = Math.max(leftEdge + 8, Math.min(ideal, rightEdge - width - 8))
      const top = Math.max(bounds.bottom, host.bottom) + 6
      const next = {
        insetInlineStart: rtl ? host.right - left - width : left - host.left,
        top: top - host.top,
        maxHeight: Math.max(0, bottomEdge - top - 8),
        maxWidth,
      }
      setPosition(previous => previous.insetInlineStart === next.insetInlineStart &&
        previous.top === next.top && previous.maxHeight === next.maxHeight &&
        previous.maxWidth === next.maxWidth ? previous : next)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)
    observer?.observe(anchor)
    const rail = anchor.closest('[data-horizontal-rail]')
    if (rail) observer?.observe(rail)
    if (element.offsetParent) observer?.observe(element.offsetParent)
    // Capture also observes rail, page and preview-dialog scrolling.
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchor, onDismiss])
  return { panel, position }
}
