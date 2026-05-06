import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserCheck } from 'lucide-react'
import {
  isImpersonationActive,
  useEndImpersonation,
  useImpersonationStatus,
} from '@/api/hooks/useImpersonation'

/**
 * Phase-46 / Prompt 46 — Admin impersonation banner.
 *
 * Persistent yellow sticky bar that surfaces whenever the calling
 * browser carries a valid impersonation cookie. The banner shows the
 * impersonated subject + remaining cookie lifetime + an "End
 * impersonation" button. NOT dismissible — security context must be
 * unmissable for the entire impersonation session.
 *
 * Mounted in <Layout> ABOVE all other operational banners so the
 * admin sees the impersonation context first when multiple banners
 * stack (the impersonation flag dominates every other UX state).
 *
 * In open-mode installs the underlying hook returns
 * `{ mode: 'open' }` and this component renders nothing — the feature
 * has no UI affordance when there is no per-user identity to bind a
 * cookie to.
 */

/** Renders "MMm SSs" or "HHh MMm" depending on remaining magnitude. */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  }
  return `${seconds}s`
}

export function ImpersonationBanner() {
  const { t } = useTranslation()
  const { data } = useImpersonationStatus()
  const endMut = useEndImpersonation()
  const [now, setNow] = useState(() => Date.now())
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const expiresAt = data?.mode === 'active' ? data.expires_at : ''
  const expiresMs = useMemo(() => {
    if (!expiresAt) return null
    const ts = Date.parse(expiresAt)
    return Number.isFinite(ts) ? ts : null
  }, [expiresAt])

  // Tick every second only while the banner is mounted; otherwise
  // we'd churn the entire app subtree once per second on every page.
  useEffect(() => {
    if (data?.mode !== 'active' || expiresMs === null) return
    tickRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
    }
  }, [data?.mode, expiresMs])

  if (!isImpersonationActive(data)) return null
  if (data?.mode !== 'active') return null

  const target = data.target
  const originalAdmin = data.original_admin

  let countdown: string | null = null
  if (expiresMs !== null) {
    const remaining = expiresMs - now
    if (remaining > 1000) {
      countdown = t('impersonation.banner.endsIn', 'Expires in {{time}}', {
        time: formatRemaining(remaining),
      })
    } else {
      countdown = t('impersonation.banner.expired', 'Session expired')
    }
  }

  const handleEnd = () => {
    endMut.mutate()
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="impersonation-banner"
      data-target={target}
      data-original-admin={originalAdmin}
      className="sticky top-0 z-[65] flex items-start gap-3 border-b border-amber-300/40 bg-amber-300/[0.12] px-4 py-2.5 backdrop-blur-md"
    >
      <div className="rounded-lg bg-amber-300/20 p-1.5 text-amber-300 shrink-0">
        <UserCheck className="h-4 w-4" aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {t('impersonation.banner.title', 'Impersonating {{target}}', { target })}
        </p>
        <p className="text-sm text-[var(--text-secondary)]">
          {t('impersonation.banner.body', 'You are viewing TeslaSync as another subject. End impersonation to restore your session.')}
        </p>
        {countdown && (
          <p
            className="text-xs text-[var(--text-muted)] mt-0.5"
            data-testid="impersonation-banner-countdown"
          >
            {countdown}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={handleEnd}
        disabled={endMut.isPending}
        data-testid="impersonation-banner-end"
        className="rounded-lg border border-amber-300/30 bg-amber-300/[0.08] px-3 py-1.5 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-300/[0.14] disabled:opacity-60 shrink-0"
      >
        {endMut.isPending
          ? t('impersonation.banner.ending', 'Ending…')
          : t('impersonation.banner.end', 'End impersonation')}
      </button>
    </div>
  )
}

export default ImpersonationBanner
