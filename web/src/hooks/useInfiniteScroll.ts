import { useCallback, useEffect, useRef, type RefObject } from 'react'

/**
 * useInfiniteScroll — invoke `onLoadMore` whenever a sentinel element scrolls
 * into view and there is still more data to fetch.
 *
 * Attach the returned ref to a sentinel node rendered at the tail of a list.
 * An IntersectionObserver watches that node; each time it enters the viewport
 * while `hasMore` is `true`, `onLoadMore` fires. The observer is torn down and
 * recreated whenever `onLoadMore` or `hasMore` changes, so the callback never
 * closes over stale values and loading halts cleanly once `hasMore` is `false`.
 *
 * SSR-safe: when `IntersectionObserver` is unavailable (server render, or jsdom
 * without the polyfill) the effect is a no-op; the ref is still returned so
 * callers can always render their sentinel.
 */
export function useInfiniteScroll(
  onLoadMore: () => void,
  hasMore: boolean,
): RefObject<HTMLDivElement> {
  const sentinelRef = useRef<HTMLDivElement>(null)

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasMore) onLoadMore()
    },
    [onLoadMore, hasMore],
  )

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(handleObserver, { threshold: 0.1 })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [handleObserver])

  return sentinelRef
}
