import { useRef, useState, useEffect, useMemo } from 'react'

export function useVirtualList<T>(items: T[], itemHeight: number, containerHeight: number) {
  const [scrollTop, setScrollTop] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [])

  const { visibleItems, startIndex, totalHeight } = useMemo(() => {
    const startIndex = Math.floor(scrollTop / itemHeight)
    const endIndex = Math.min(startIndex + Math.ceil(containerHeight / itemHeight) + 2, items.length)
    return {
      visibleItems: items.slice(startIndex, endIndex),
      startIndex,
      totalHeight: items.length * itemHeight,
    }
  }, [items, scrollTop, itemHeight, containerHeight])

  return { containerRef, visibleItems, startIndex, totalHeight, offsetY: startIndex * itemHeight }
}
