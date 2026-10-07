/**
 * PrivacyPage — `/account/privacy`.
 *
 * First-class page under the "Account" side-nav category alongside Two-factor
 * Auth and Active Sessions. Surfaces the browser-local privacy controls that
 * used to live buried in the dense Settings page.
 *
 * Modern-UI layout (matches the analytics / sessions gold standard):
 *   1. KPI band       — recent-page count, consent status, deployment policy,
 *                       data scope.
 *   2. Controls bento — "Recently viewed pages" + "Cookies & analytics consent"
 *                       side-by-side on wide screens, stacked on mobile.
 *   3. Guarantees band — full-width, reflowing explainer of how the data is kept
 *                        local to this browser.
 *
 * The page owns the browser-local state (recent-pages LRU counter, consent
 * decision), the version/policy query, and the destructive-clear confirmation
 * dialog + toast feedback; the presentational panels under
 * `../components/privacy` render it. All subscriptions live here once so the KPI
 * band and the control panels never drift out of sync across tabs.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PageContainer } from '@/components/layout'
import { ConfirmDialog } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useVersionInfo } from '@/api/hooks/useSettings'
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

import {
  PrivacyKpiCards,
  RecentPagesPanel,
  ConsentControlPanel,
  PrivacyGuaranteesPanel,
} from '../components/privacy'

/** Stable id for the "Don't ask again" opt-out on the clear-history dialog. */
const CONFIRM_SILENCE_KEY = 'clear-recent-pages'

export default function PrivacyPage() {
  const { t } = useTranslation('settings')
  const { t: tt } = useTranslation()
  usePageTitle(t('account.privacy.title', 'Privacy'))

  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [count, setCount] = useState<number>(() => getRecentPages().length)
  const [consent, setConsentLocal] = useState<ConsentState>(() => getConsent())

  const versionQuery = useVersionInfo()
  const { refetch: refetchVersion } = versionQuery
  const requireConsent = Boolean(versionQuery.data?.require_cookie_consent)

  // Single stable retry shared by the KPI band and the consent panel — both
  // surface the same `/system/version` failure, so they must recover through
  // one identical, referentially-stable callback rather than two inline
  // closures re-created every render.
  const handleRetry = useCallback(() => {
    void refetchVersion()
  }, [refetchVersion])

  // Live-update the row counter so users on the same page in two tabs see the
  // count drop after a clear in either tab.
  useEffect(() => {
    setCount(getRecentPages().length)
    return subscribeRecentPages(() => setCount(getRecentPages().length))
  }, [])

  // Keep consent in sync with banner-driven mutations and cross-tab `storage`
  // events so a user who accepts in one tab sees the state update here.
  useEffect(() => {
    setConsentLocal(getConsent())
    return subscribeConsent((next) => setConsentLocal(next))
  }, [])

  const handleClearConfirm = () => {
    clearRecentPages()
    setConfirmOpen(false)
    toast.success(tt('recentPages.cleared', 'Recent pages cleared'))
  }

  const handleAcceptConsent = () => {
    setConsent('accepted')
    setConsentLocal('accepted')
    toast.success(tt('consent.toast.accepted', 'Consent granted'))
  }
  const handleDeclineConsent = () => {
    setConsent('declined')
    setConsentLocal('declined')
    toast.success(tt('consent.toast.declined', 'Consent withdrawn'))
  }
  const handleResetConsent = () => {
    clearConsent()
    setConsentLocal('unknown')
    toast.success(tt('consent.toast.reset', 'Consent reset — banner will reappear'))
  }

  return (
    <PageContainer
      title={t('account.privacy.title', 'Privacy')}
      subtitle={t(
        'account.privacy.subtitle',
        'Manage browser-local data: recently viewed pages and cookies / analytics consent.',
      )}
      query={versionQuery}
      copyLink
    >
      <div className="space-y-6" data-testid="privacy-section">
        <FadeIn>
          <PrivacyKpiCards
            recentCount={count}
            consent={consent}
            requireConsent={requireConsent}
            isLoading={versionQuery.isLoading}
            isError={versionQuery.isError}
            error={versionQuery.error}
            onRetry={handleRetry}
          />
        </FadeIn>

        <FadeIn delay={0.1}>
          <section
            aria-label={t('account.privacy.controlsAria', 'Privacy controls')}
            className="grid grid-cols-1 gap-4 xl:grid-cols-2"
          >
            <RecentPagesPanel count={count} onClear={() => setConfirmOpen(true)} />
            <ConsentControlPanel
              consent={consent}
              requireConsent={requireConsent}
              isLoading={versionQuery.isLoading}
              isError={versionQuery.isError}
              onRetry={handleRetry}
              onAccept={handleAcceptConsent}
              onDecline={handleDeclineConsent}
              onReset={handleResetConsent}
            />
          </section>
        </FadeIn>

        <FadeIn delay={0.2}>
          <PrivacyGuaranteesPanel />
        </FadeIn>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        variant="warning"
        title={tt('recentPages.clearConfirmTitle', 'Clear recent pages?')}
        message={tt(
          'recentPages.clearConfirmBody',
          'This will wipe the list immediately. The status bar and palette Recent section will be empty until you visit new pages.',
        )}
        confirmLabel={tt('recentPages.clearConfirmCta', 'Clear pages')}
        cancelLabel={tt('common.cancel', 'Cancel')}
        silenceKey={CONFIRM_SILENCE_KEY}
        onConfirm={handleClearConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </PageContainer>
  )
}
