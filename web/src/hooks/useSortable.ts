import { useState, useMemo } from 'react'

export function useSortable<T>(data: T[], defaultKey: keyof T, defaultDir: 'asc' | 'desc' = 'asc') {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir)

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const aVal = a[sortKey], bVal = b[sortKey]
      if (aVal == null) return 1
      if (bVal == null) return -1
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [data, sortKey, sortDir])

  const toggle = (key: keyof T) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  return { sorted, sortKey, sortDir, toggle }
}
