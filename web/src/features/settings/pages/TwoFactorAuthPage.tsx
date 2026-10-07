/**
 * TwoFactorAuthPage — `/account/2fa`.
 *
 * Full-width modern-ui bento for user-level two-factor security. Lives
 * under the "Account" side-nav category so TOTP enrollment, backup
 * codes, and disable get a dedicated cockpit surface instead of
 * competing with the dense Settings page.
 *
 * Anatomy (mobile 1-col → reflows to more columns on wide screens):
 *   1. KPI band          — protection / last-verified / backup / method.
 *   2. Hero + guide       — `TOTPEnrollmentSection` (the whole enroll →
 *      verify → backup-codes + disable flow, spanning two columns) beside
 *      the static `TotpSetupGuide`.
 *   3. Context band       — compatible apps + recovery guidance.
 *
 * All enrollment state, dialog flow, and step-up gating stay inside
 * `TOTPEnrollmentSection`, so this page is a pure orchestrator with no
 * behavior drift. Every section owns its own loading / empty state and
 * is null-safe; the shared status query drives the header freshness chip.
 */
import { useTranslation } from 'react-i18next'
import { PageContainer } from '@/components/layout'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTOTPStatus } from '@/api/hooks/useTOTP'
import { TOTPEnrollmentSection } from '../components/TOTPEnrollmentSection'
import {
  TotpKpiBand,
  TotpSetupGuide,
  TotpCompatibleApps,
  TotpRecoveryPanel,
} from '../components/twofactor'

export default function TwoFactorAuthPage() {
  const { t } = useTranslation('settings')
  usePageTitle(t('account.twoFactor.title', 'Two-factor authentication'))

  const status = useTOTPStatus()

  return (
    <PageContainer
      title={t('account.twoFactor.title', 'Two-factor authentication')}
      subtitle={t(
        'account.twoFactor.subtitle',
        'Add a second factor to your sign-in. Required for sensitive admin actions.',
      )}
      copyLink
      query={status}
    >
      {/* 1 — KPI band: at-a-glance credential summary. */}
      <FadeIn>
        <TotpKpiBand data={status.data} isLoading={status.isLoading} />
      </FadeIn>

      {/* 2 — Hero enrollment flow (spans two columns) + setup guide. */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('account.twoFactor.manageAria', 'Manage two-factor authentication')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="xl:col-span-2">
            <TOTPEnrollmentSection />
          </div>
          <div className="xl:col-span-1">
            <TotpSetupGuide />
          </div>
        </section>
      </FadeIn>

      {/* 3 — Context band: compatible apps + recovery guidance. */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('account.twoFactor.contextAria', 'Two-factor apps and recovery')}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5"
        >
          <TotpCompatibleApps />
          <TotpRecoveryPanel />
        </section>
      </FadeIn>
    </PageContainer>
  )
}
