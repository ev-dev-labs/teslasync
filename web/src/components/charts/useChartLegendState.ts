import { useCallback, useEffect, useState } from 'react'

const STORAGE_PREFIX = 'teslasync.chart.'
const STORAGE_SUFFIX = '.hidden'

function storageKey(chartId: string): string {
  return `${STORAGE_PREFIX}${chartId}${STORAGE_SUFFIX}`
}

function readHidden(chartId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(storageKey(chartId))
    if (!raw) return new Set()
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function writeHidden(chartId: string, hidden: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      storageKey(chartId),
      JSON.stringify(Array.from(hidden)),
    )
  } catch {
    // Ignore quota / privacy-mode failures — legend state is a UX nicety, not
    // a correctness invariant.
  }
}

export interface ChartLegendState {
  /** Set of dataKeys the user has hidden via the legend. */
  hidden: Set<string>
  /** Returns true if the given dataKey is currently hidden. */
  isHidden: (dataKey: string) => boolean
  /** Toggle visibility of a dataKey (writes to localStorage). */
  toggle: (dataKey: string) => void
  /** Set visibility explicitly. */
  setHidden: (dataKey: string, hidden: boolean) => void
  /** Reset all to visible. */
  reset: () => void
}

/**
 * Persistent legend visibility for a chart. Each chart passes a stable
 * namespaced `chartId` (use the constants in `chartTokens.ids` to avoid
 * collisions). Hidden series persist across reloads via localStorage.
 *
 * Usage:
 * ```tsx
 * const legend = useChartLegendState(chartTokens.ids.driveOverview)
 * return (
 *   <LineChart>
 *     <ChartLegend state={legend} />
 *     <Line dataKey="speed" hide={legend.isHidden('speed')} />
 *     <Line dataKey="power" hide={legend.isHidden('power')} />
 *   </LineChart>
 * )
 * ```
 */
export function useChartLegendState(chartId: string): ChartLegendState {
  const [hidden, setHiddenState] = useState<Set<string>>(() => readHidden(chartId))

  // If the chartId changes (rare but possible in dynamic UIs) re-read.
  useEffect(() => {
    setHiddenState(readHidden(chartId))
  }, [chartId])

  const isHidden = useCallback(
    (dataKey: string) => hidden.has(dataKey),
    [hidden],
  )

  const persist = useCallback(
    (next: Set<string>) => {
      setHiddenState(next)
      writeHidden(chartId, next)
    },
    [chartId],
  )

  const toggle = useCallback(
    (dataKey: string) => {
      const next = new Set(hidden)
      if (next.has(dataKey)) next.delete(dataKey)
      else next.add(dataKey)
      persist(next)
    },
    [hidden, persist],
  )

  const setHidden = useCallback(
    (dataKey: string, h: boolean) => {
      const next = new Set(hidden)
      if (h) next.add(dataKey)
      else next.delete(dataKey)
      persist(next)
    },
    [hidden, persist],
  )

  const reset = useCallback(() => {
    persist(new Set())
  }, [persist])

  return { hidden, isHidden, toggle, setHidden, reset }
}
