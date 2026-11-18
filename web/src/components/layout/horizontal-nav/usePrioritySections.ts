import { useLayoutEffect, useRef, useState } from 'react'

export function countFittingSections(budget: number, widths: readonly number[], more: number, gap: number) {
  if (widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1) <= budget) return widths.length
  let used = more
  let count = 0
  for (const width of widths) {
    used += width + gap
    if (used > budget) break
    count++
  }
  return count
}

export function usePrioritySections(enabled: boolean, labels: readonly string[], moreLabel: string) {
  const lane = useRef<HTMLDivElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(0)
  const labelKey = JSON.stringify([labels, moreLabel])
  useLayoutEffect(() => {
    const row = lane.current
    const measure = ruler.current
    if (!enabled || !row || !measure) return
    const update = () => {
      const widths = Array.from(measure.children, element => element.getBoundingClientRect().width)
      const more = widths.pop() ?? 0
      const gap = parseFloat(getComputedStyle(measure).columnGap) || 0
      setCount(countFittingSections(row.getBoundingClientRect().width, widths, more, gap))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(row)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [enabled, labelKey])
  return { lane, ruler, count }
}
