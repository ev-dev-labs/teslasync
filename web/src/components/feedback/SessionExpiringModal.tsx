import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from '@/components/ui/runtime'
import { Clock, AlertTriangle } from 'lucide-react'
import { useSessionMonitor } from '@/hooks/useSessionMonitor'
import { navigateToReauth } from '@/lib/resilience'

/**
 * SessionExpiringModal.
 *
 * Pops up ~60 seconds before the upstream ForwardAuth cookie expires
 * with a live countdown and two affordances:
 * • "Stay signed in" → calls the session-monitor's refresh(), which
 * simply re-polls /auth/session. Sliding-session proxies (the
 * common case for oauth2-proxy / authentik / authelia) renew the
 * cookie on every authenticated request, so the GET of
 * /auth/session is itself the renewal — no separate /refresh
 * round-trip is needed and we avoid the Tesla-token-only
 * POST /auth/refresh path.
 * • "Sign out now" → reloads to / so the proxy redirects to its
 * login page; saves the current URL so post-login we can resume.
 *
 * If the user has unsaved drafts (registered by useFormDraft into
 * `localStorage` under `teslasync:draft:v*:*`), the modal lists them
 * so the user knows what would be lost on a forced sign-out. This
 * cross-cuts with (form-draft persistence).
 *
 * **Open mode**: when there is no auth provider configured the hook
 * reports `mode === 'open'` and this component renders nothing.
 *
 * **Modal source-of-truth**: uses the shared <Modal> component. To
 * make the modal "soft-blocking" we still allow Esc / backdrop close
 * (a session-expiring warning is informational, not catastrophic).
 * The hard-block companion {@link SessionExpiredModal} disables both.
 */

const DRAFT_KEY_PREFIX = 'teslasync:draft:v'

interface DraftSummary {
  /** Display label derived from the draft's storage key. */
  label: string
  /** Last-saved timestamp when known; null when the envelope is unparseable. */
  savedAt: Date | null
}

/** Reads the localStorage draft registry without throwing in private mode. */
function readDraftSummaries(): DraftSummary[] {
  if (typeof window === 'undefined') return []
  let storage: Storage
  try {
    storage = window.localStorage
  } catch {
    return []
  }
  const out: DraftSummary[] = []
  const total = (() => {
    try {
      return storage.length
    } catch {
      return 0
    }
  })()
  for (let i = 0; i < total; i += 1) {
    let key: string | null = null
    try {
      key = storage.key(i)
    } catch {
      break
    }
    if (key === null) continue
    if (!key.startsWith(DRAFT_KEY_PREFIX)) continue

    let savedAt: Date | null = null
    try {
      const raw = storage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw) as { savedAt?: unknown }
        if (typeof parsed?.savedAt === 'number' && Number.isFinite(parsed.savedAt)) {
          savedAt = new Date(parsed.savedAt)
        }
      }
    } catch {
      /* corrupt envelope — still surface the key so the user knows it exists */
    }

    // Strip the `teslasync:draft:vN:` prefix → readable form-key tail
    // e.g. "alertstudio:rule:42".
    const tail = key.replace(/^teslasync:draft:v\d+:/, '')
    out.push({ label: tail, savedAt })
  }
  // Most-recent first when possible.
  out.sort((a, b) => {
    const aMs = a.savedAt ? a.savedAt.getTime() : 0
    const bMs = b.savedAt ? b.savedAt.getTime() : 0
    return bMs - aMs
  })
  return out
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function SessionExpiringModal() {
  const { t } = useTranslation()
  const { mode, expiresInSeconds, isExpiringSoon, hasExpired, refresh } = useSessionMonitor()
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [refreshing, setRefreshing] = useState(false)

  // The hard-expired modal owns the hasExpired branch — bail out here
  // so two modals don't race for the screen.
  const open = mode === 'session' && isExpiringSoon && !hasExpired

  // Refresh the draft inventory each time the modal mounts so a draft
  // added since the last open isn't omitted.
  useEffect(() => {
    if (!open) return
    setDrafts(readDraftSummaries())
  }, [open])

  const countdown = useMemo(
    () => formatCountdown(expiresInSeconds ?? 0),
    [expiresInSeconds],
  )

  const handleStay = async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const handleSignOut = () => {
    // Explicit IdP handoff via the shared helper — preserves the
    // current URL as `rd=` so Authentik deep-links the user back to
    // where they were, and writes the same value to sessionStorage as
    // a fallback for proxies that strip the redirect param.
    navigateToReauth()
  }

  // The shared Modal handles Esc + backdrop close. We map that to the
  // "stay signed in" intent so dismissing the dialog implicitly does
  // the renewal poll — quietly swallowing it would feel hostile.
  const handleClose = () => {
    void handleStay()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="sm"
      ariaLabel={t('session.expiring.title', 'Your session is about to expire')}
      data-testid="session-expiring-modal"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-amber-300/15 p-2 shrink-0">
            <Clock className="h-5 w-5 text-amber-300" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t('session.expiring.title', 'Your session is about to expire')}
            </h2>
            <p
              className="mt-1 text-sm text-[var(--text-secondary)]"
              data-testid="session-expiring-countdown"
            >
              {t('session.expiring.body', 'You will be signed out in {{countdown}}.', { countdown })}
            </p>
          </div>
        </div>

        {drafts.length > 0 && (
          <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              {t('session.expiring.unsavedTitle', 'Unsaved drafts')}
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {t(
                'session.expiring.unsavedBody',
                'Sign out will keep these drafts in your browser, but you must sign in again to finish them.',
              )}
            </p>
            <ul
              className="mt-2 space-y-1 text-xs text-[var(--text-primary)]"
              data-testid="session-expiring-drafts"
            >
              {drafts.slice(0, 5).map((d) => (
                <li key={d.label} className="truncate">
                  • {d.label}
                </li>
              ))}
              {drafts.length > 5 && (
                <li className="text-[var(--text-secondary)]">
                  {t('session.expiring.moreDrafts', '+{{count}} more', { count: drafts.length - 5 })}
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={handleSignOut}
            data-testid="session-expiring-signout"
          >
            {t('session.expiring.signOut', 'Sign out now')}
          </Button>
          <Button
            variant="primary"
            onClick={handleStay}
            disabled={refreshing}
            data-testid="session-expiring-stay"
          >
            {refreshing
              ? t('session.expiring.staying', 'Refreshing…')
              : t('session.expiring.stay', 'Stay signed in')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default SessionExpiringModal
