import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from '@/components/ui/runtime'
import { Lock } from 'lucide-react'
import { useSessionMonitor } from '@/hooks/useSessionMonitor'
import { navigateToReauth } from '@/lib/resilience'

/**
 * Hard-blocks the UI when the upstream ForwardAuth session has fully
 * expired. Two activation paths:
 *   1. {@link useSessionMonitor} reports `hasExpired === true` (the
 *      polling-based path — server reports authenticated:false or the
 *      expires_at timestamp has elapsed).
 *   2. Any API call returns 401 — `resilientFetch` dispatches
 *      `teslasync:session-expired` for that branch (the "sat idle long
 *      enough that the proxy invalidated us between polls" path).
 *
 * Recovery action: clicking "Sign in again" hands off to
 * {@link navigateToReauth} which navigates the top-level window to the
 * IdP's documented entry point (Authentik's /outpost.goauthentik.io
 * /start?rd=… by default). The previous reload-current-path approach
 * relied on the browser's nav request reaching Authentik through the
 * SW — fragile behind a Service Worker that may match navigations
 * from cache.
 *
 * **Open mode**: when there is no auth provider this modal renders
 * nothing — `useSessionMonitor` reports `mode === 'open'` and we also
 * filter out the `teslasync:session-expired` event (it would only
 * fire in open mode if a non-auth handler returned 401, which the
 * SPA doesn't expect).
 *
 * **Non-dismissible**: Esc and backdrop clicks are absorbed by an
 * onClose no-op. The only way out is the "Sign in again" button.
 */

const SESSION_EXPIRED_EVENT = 'teslasync:session-expired'

export function SessionExpiredModal() {
  const { t } = useTranslation()
  const { mode, hasExpired } = useSessionMonitor()
  const [eventTriggered, setEventTriggered] = useState(false)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const handler = () => setEventTriggered(true)
    document.addEventListener(SESSION_EXPIRED_EVENT, handler)
    return () => document.removeEventListener(SESSION_EXPIRED_EVENT, handler)
  }, [])

  // Suppress entirely in open mode — there is no session to expire.
  if (mode === 'open') return null

  const open = hasExpired || eventTriggered

  const handleSignIn = () => {
    // Explicit IdP handoff. navigateToReauth() writes the current URL
    // to sessionStorage AND embeds it in the `rd=` param so Authentik
    // can deep-link the user back to where they were after sign-in.
    // Previous behaviour (reload current path) was fragile behind a
    // Service Worker that may match navigations from cache, and lost
    // the deep-link in PWA standalone where the address bar is hidden.
    navigateToReauth()
  }

  return (
    <Modal
      open={open}
      // Non-dismissible: Esc + backdrop close call onClose; we no-op
      // it so the user MUST take the explicit "Sign in again" action.
      onClose={() => {
        /* intentional no-op — hard block until re-auth */
      }}
      size="sm"
      ariaLabel={t('session.expired.title', 'Session expired')}
      data-testid="session-expired-modal"
    >
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-300/15">
          <Lock className="h-6 w-6 text-rose-300" aria-hidden />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {t('session.expired.title', 'Session expired')}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {t(
              'session.expired.body',
              'For your security, your session has timed out. Sign in again to pick up where you left off.',
            )}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={handleSignIn}
          className="w-full"
          data-testid="session-expired-signin"
        >
          {t('session.expired.signIn', 'Sign in again')}
        </Button>
      </div>
    </Modal>
  )
}

export default SessionExpiredModal
