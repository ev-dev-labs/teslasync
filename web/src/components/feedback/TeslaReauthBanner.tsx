import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/runtime'
import { drainQueuedTeslaMutations } from '@/lib/teslaAuthRecovery'

/**
 * Tesla third-party OAuth grant recovery banner.
 *
 * The Tesla refresh token has a hard 8-week TTL. When it expires, every
 * Tesla-backed call starts returning 401 with `code: TESLA_TOKEN_EXPIRED`,
 * and `resilientFetch` dispatches a `teslasync:tesla-auth-expired`
 * document event. This banner picks up the event and renders a sticky
 * top-of-page row with a single-click CTA that deep-links the user to
 * `/tesla-account` to complete the OAuth flow again.
 *
 * Distinct from {@link SessionExpiredModal} — that's a hard blocker
 * for Authentik session expiry. Tesla token expiry is a *partial*
 * failure: non-Tesla data (settings, dashboards, drives history)
 * keeps loading normally, so a non-modal banner is the right fit.
 * We sit at the top with `sticky` rather than `fixed` so we don't
 * obscure the Authentik blocker if both happen at once.
 *
 * Mounting note — the banner is mounted in <Layout> alongside the other
 * status banners (NewVersionBanner, OfflineBanner). It listens to
 * document-level events that survive route transitions, so the banner
 * persists across navigation until the user reconnects or dismisses.
 *
 * Recovery — when the user finishes re-authorizing,
 * <TeslaAccountSection> emits `teslasync:tesla-auth-recovered`; this
 * banner consumes the event, hides itself, and triggers
 * {@link drainQueuedTeslaMutations} to replay any commands the user
 * tried during the disconnected window.
 */
export function TeslaReauthBanner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onExpired = () => setVisible(true)
    const onRecovered = () => {
      setVisible(false)
      // Best-effort replay; errors surface via each mutation's normal
      // onError path.
      void drainQueuedTeslaMutations()
    }
    document.addEventListener('teslasync:tesla-auth-expired', onExpired)
    document.addEventListener('teslasync:tesla-auth-recovered', onRecovered)
    return () => {
      document.removeEventListener('teslasync:tesla-auth-expired', onExpired)
      document.removeEventListener('teslasync:tesla-auth-recovered', onRecovered)
    }
  }, [])

  if (!visible) return null

  const handleReconnect = () => {
    navigate('/tesla-account')
  }

  const handleDismiss = () => {
    setVisible(false)
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="tesla-reauth-banner"
      className="sticky top-0 z-40 flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/[0.08] px-4 py-2.5 backdrop-blur-md"
    >
      <div className="rounded-lg bg-amber-500/15 p-1.5 shrink-0">
        <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {t('tesla.reauth.title', 'Tesla account disconnected')}
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          {t('tesla.reauth.body', 'Reconnect to resume live data and commands.')}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="primary" onClick={handleReconnect}>
          {t('tesla.reauth.cta', 'Reconnect')}
        </Button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t('common.dismiss', 'Dismiss')}
          className="rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

export default TeslaReauthBanner
