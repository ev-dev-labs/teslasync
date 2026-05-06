import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from '@/components/ui'
import { Lock } from 'lucide-react'
import { useSessionMonitor } from '@/hooks/useSessionMonitor'

/**
 * Phase-46 / Prompt 05 — SessionExpiredModal.
 *
 * Hard-blocks the UI when the upstream ForwardAuth session has fully
 * expired. Two activation paths:
 *   1. {@link useSessionMonitor} reports `hasExpired === true` (the
 *      polling-based path — server reports authenticated:false or the
 *      expires_at timestamp has elapsed).
 *   2. Any API call returns 401 — `resilientFetch` dispatches
 *      `teslasync:session-expired` for that branch (the "sat idle long
 *      enough that the proxy invalidated us between polls" path).
 *
 * Distinct from {@link AuthExpiredOverlay}:
 *   • AuthExpiredOverlay → fired on PWA-mode session-middleware 401
 *     where window.location.reload() can't trigger the proxy redirect.
 *   • SessionExpiredModal → fired in normal browser sessions when the
 *     proxy cookie expires; preserves the current URL so post-login
 *     the user resumes where they were instead of being dumped on /.
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

const RETURN_URL_KEY = 'teslasync-return-url'
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
    try {
      window.sessionStorage.setItem(RETURN_URL_KEY, window.location.href)
    } catch {
      /* private mode — best-effort */
    }
    // window.location.assign with the current path triggers the
    // ForwardAuth proxy redirect to its login flow. After auth, the
    // proxy returns the user to the same URL; the saved return-url
    // is a defence-in-depth fallback for proxies that don't preserve
    // the original deep-link.
    const target = window.location.pathname + window.location.search + window.location.hash
    window.location.assign(target || '/')
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
