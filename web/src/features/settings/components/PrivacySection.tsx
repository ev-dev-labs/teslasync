/**
 * Phase-46 / Prompt 51 — Privacy section.
 *
 * Surfaces user-controllable client-side privacy switches:
 *
 *   1. "Clear recently viewed pages" — wipes the LRU maintained by
 *      `lib/recentPages` for the current browser.
 *   2. (Phase-46 / Prompt 70) Cookie / GDPR consent management —
 *      shows the user's current consent state and lets them
 *      withdraw, re-grant, or fully reset to "unknown" so the banner
 *      appears again on the next reload. Always rendered (even when
 *      the deployment-wide `require_cookie_consent` flag is off) so
 *      operators can preview the user-facing flow before flipping
 *      the env var.
 *
 * The "Clear" action is gated behind a `<ConfirmDialog>` because it is
 * irreversible and can erase weeks of accumulated convenience without
 * an undo path. The dialog reuses the existing `silenceKey` machinery
 * so users on shared workstations who want a one-click flow can opt in
 * after the first confirmation.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, Trash2 } from 'lucide-react'
import { GlassPanel, IconBox, Button, ConfirmDialog } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import {
  clearRecentPages,
  getRecentPages,
  subscribeRecentPages,
} from '@/lib/recentPages'
import {
  type ConsentState,
  clearConsent,
  getConsent,
  setConsent,
  subscribeConsent,
} from '@/lib/cookieConsent'
import { useVersionInfo } from '@/api/hooks/useSettings'

const CONFIRM_SILENCE_KEY = 'clear-recent-pages'

function consentLabel(state: ConsentState, t: (k: string, d: string) => string): string {
  switch (state) {
    case 'accepted':
      return t('consent.state.accepted', 'Accepted — performance & error reporting on')
    case 'declined':
      return t('consent.state.declined', 'Declined — only essential storage in use')
    case 'unknown':
    default:
      return t('consent.state.unknown', 'Not decided — banner will appear on next visit')
  }
}

export function PrivacySection() {
  const { t } = useTranslation()
  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [count, setCount] = useState<number>(() => getRecentPages().length)
  const [consent, setConsentLocal] = useState<ConsentState>(() => getConsent())
  const versionQuery = useVersionInfo()
  const requireConsent = Boolean(versionQuery.data?.require_cookie_consent)

  // Live-update the row counter so users on the same page in two tabs
  // see the count drop after a clear in either tab.
  useEffect(() => {
    setCount(getRecentPages().length)
    return subscribeRecentPages(() => setCount(getRecentPages().length))
  }, [])

  // Keep the consent control in sync with banner-driven mutations and
  // cross-tab `storage` events so a user who accepts in one tab sees
  // the row update here without a refresh.
  useEffect(() => {
    setConsentLocal(getConsent())
    return subscribeConsent((next) => setConsentLocal(next))
  }, [])

  const handleConfirm = () => {
    clearRecentPages()
    setConfirmOpen(false)
    toast.success(
      t('recentPages.cleared', 'Recent pages cleared'),
    )
  }

  const handleAcceptConsent = () => {
    setConsent('accepted')
    setConsentLocal('accepted')
    toast.success(t('consent.toast.accepted', 'Consent granted'))
  }
  const handleDeclineConsent = () => {
    setConsent('declined')
    setConsentLocal('declined')
    toast.success(t('consent.toast.declined', 'Consent withdrawn'))
  }
  const handleResetConsent = () => {
    clearConsent()
    setConsentLocal('unknown')
    toast.success(t('consent.toast.reset', 'Consent reset — banner will reappear'))
  }

  return (
    <FadeIn>
      <GlassPanel
        className="p-5"
        data-testid="privacy-section"
      >
        <div className="flex items-start gap-4">
          <IconBox color="cyan">
            <ShieldCheck className="h-5 w-5" />
          </IconBox>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t('privacy.title', 'Privacy')}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {t(
                'privacy.subtitle',
                'Manage local browsing history surfaces. These settings only affect this browser.',
              )}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[14rem]">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t('recentPages.clearTitle', 'Recently viewed pages')}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {t(
                  'recentPages.clearBody',
                  'Wipe the list of pages used by the dashboard widget and the Recent section in the command palette.',
                )}
              </p>
              <p
                className="text-[11px] text-[var(--text-muted)] mt-2 tabular-nums"
                data-testid="privacy-recent-count"
              >
                {t('recentPages.storedCount', { count, defaultValue: `${count} entries stored` })}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => setConfirmOpen(true)}
              disabled={count === 0}
              data-testid="privacy-clear-recent-pages"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('recentPages.clearButton', 'Clear recent pages')}
            </Button>
          </div>
        </div>

        {/* Phase-46 / Prompt 70 — Cookie / GDPR consent management.
            Always rendered so operators can preview the user-facing
            flow even on installs where the consent banner is gated
            off via TESLASYNC_REQUIRE_COOKIE_CONSENT=false. */}
        <div
          className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4"
          data-testid="privacy-consent-section"
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[14rem]">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t('consent.section.title', 'Cookies & analytics consent')}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {requireConsent
                  ? t(
                      'consent.section.bodyOn',
                      'This deployment collects anonymous performance and error reports with your consent. Strictly necessary storage (auth, settings) is always on.',
                    )
                  : t(
                      'consent.section.bodyOff',
                      'This deployment does not require consent collection — these controls let you preview the user-facing flow.',
                    )}
              </p>
              <p
                className="text-[11px] text-[var(--text-muted)] mt-2"
                data-testid="privacy-consent-state"
                data-consent-state={consent}
              >
                {consentLabel(consent, t)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={handleAcceptConsent}
                disabled={consent === 'accepted'}
                data-testid="privacy-consent-accept"
              >
                {t('consent.action.accept', 'Re-grant consent')}
              </Button>
              <Button
                variant="secondary"
                onClick={handleDeclineConsent}
                disabled={consent === 'declined'}
                data-testid="privacy-consent-decline"
              >
                {t('consent.action.decline', 'Withdraw consent')}
              </Button>
              <Button
                variant="ghost"
                onClick={handleResetConsent}
                disabled={consent === 'unknown'}
                data-testid="privacy-consent-reset"
              >
                {t('consent.action.reset', 'Reset')}
              </Button>
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={confirmOpen}
          variant="warning"
          title={t('recentPages.clearConfirmTitle', 'Clear recent pages?')}
          message={t(
            'recentPages.clearConfirmBody',
            'This will wipe the list immediately. The dashboard widget and palette Recent section will be empty until you visit new pages.',
          )}
          confirmLabel={t('recentPages.clearConfirmCta', 'Clear pages')}
          cancelLabel={t('common.cancel', 'Cancel')}
          silenceKey={CONFIRM_SILENCE_KEY}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmOpen(false)}
        />
      </GlassPanel>
    </FadeIn>
  )
}

export default PrivacySection
