import { useEffect, useState } from 'react'
import { activeRateLimitNotices, type RateLimitNotice } from '@/lib/rateLimit'

export interface RateLimitBannerNotice extends RateLimitNotice {
  kind: 'rate-limited' | 'upstream-down'
}

export function useRateLimitNotices() {
  const [notices, setNotices] = useState<RateLimitBannerNotice[]>(() =>
    activeRateLimitNotices().map((notice) => ({ ...notice, kind: 'rate-limited' })),
  )
  const [now, setNow] = useState(Date.now)
  const current = notices.reduce<RateLimitBannerNotice | undefined>(
    (latest, notice) => !latest || notice.expiresAt > latest.expiresAt ? notice : latest, undefined,
  )
  const expiresAt = current?.expiresAt

  useEffect(() => {
    const add = (notice: RateLimitBannerNotice) => {
      if (!Number.isFinite(notice.expiresAt) || !notice.bucket) return
      setNotices((previous) => {
        const existing = previous.find((item) => item.bucket === notice.bucket)
        const next = { ...notice, expiresAt: Math.max(notice.expiresAt, existing?.expiresAt ?? 0) }
        return [...previous.filter((item) => item.bucket !== notice.bucket), next]
          .sort((a, b) => b.expiresAt - a.expiresAt).slice(0, 16)
      })
      setNow(Date.now())
    }
    const limited = (event: Event) => {
      const notice = (event as CustomEvent<RateLimitNotice>).detail
      if (notice && typeof notice.retryAfterSec === 'number' && Number.isFinite(notice.retryAfterSec)) {
        add({ ...notice, kind: 'rate-limited' })
      }
    }
    const upstream = (event: Event) => {
      const detail = (event as CustomEvent<{
        retryAfterSec: number; scope: string; requestMethod: string; expiresAt: number
      }>).detail
      if (detail && Number.isFinite(detail.retryAfterSec) && typeof detail.scope === 'string') {
        add({
          ...detail, bucket: `upstream:${detail.requestMethod}:${detail.scope}`,
          methods: detail.requestMethod, source: 'tesla', enforcement: 'upstream', kind: 'upstream-down',
        })
      }
    }
    const clear = (event: Event) => {
      const bucket = (event as CustomEvent<{ bucket: string }>).detail?.bucket
      setNotices((previous) => previous.filter((notice) => notice.bucket !== bucket))
    }
    const reset = () => setNotices([])
    document.addEventListener('teslasync:rate-limited', limited)
    document.addEventListener('teslasync:upstream-down', upstream)
    document.addEventListener('teslasync:rate-limit-cleared', clear)
    document.addEventListener('teslasync:rate-limits-reset', reset)
    for (const notice of activeRateLimitNotices()) add({ ...notice, kind: 'rate-limited' })
    return () => {
      document.removeEventListener('teslasync:rate-limited', limited)
      document.removeEventListener('teslasync:upstream-down', upstream)
      document.removeEventListener('teslasync:rate-limit-cleared', clear)
      document.removeEventListener('teslasync:rate-limits-reset', reset)
    }
  }, [])

  useEffect(() => {
    if (expiresAt == null || expiresAt <= Date.now()) return
    const timer = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= expiresAt) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  return {
    current, remaining: current ? Math.max(0, Math.ceil((current.expiresAt - now) / 1000)) : 0,
    dismiss: () => setNotices([]),
  }
}
