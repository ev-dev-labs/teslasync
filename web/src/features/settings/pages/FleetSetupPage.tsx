/**
 * Fleet Setup — `/settings/fleet-setup`.
 *
 * Guided Tesla Fleet path: connect account → keep the token fresh →
 * subscribe telemetry for a VIN (domain TLS / CA) → wait for streaming.
 *
 * Existing `/tesla-account` and `/dev-tools` surfaces stay unchanged.
 * This page reuses TeslaAccountSection and the same `/dev-tools/*` APIs.
 */
import { useTranslation } from 'react-i18next'
import { PageContainer } from '@/components/layout'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAuthStatus } from '@/api/hooks/useSettings'
import { useOnboardingStatus } from '@/api/hooks/useOnboarding'
import { useFleetApiInfo, usePublicKeyStatus } from '@/api/hooks/useFleetSetup'
import { TeslaAccountSection } from '../components/TeslaAccountSection'
import {
  FleetSetupGuide,
  FleetSetupKpiBand,
  FleetSetupProgress,
  FleetSetupReadiness,
  FleetSetupStreamingPanel,
  FleetSetupSubscribePanel,
} from '../components/fleet-setup'

export default function FleetSetupPage() {
  const { t } = useTranslation('settings')
  usePageTitle(t('fleetSetup.title', 'Fleet Setup'))

  const auth = useAuthStatus()
  const apiInfo = useFleetApiInfo()
  const publicKey = usePublicKeyStatus()
  const onboarding = useOnboardingStatus({ pollAfterSetup: true })

  const kpiLoading =
    auth.isLoading || apiInfo.isLoading || publicKey.isLoading || onboarding.isLoading

  return (
    <PageContainer
      title={t('fleetSetup.title', 'Fleet Setup')}
      subtitle={t(
        'fleetSetup.subtitle',
        'Connect Tesla, keep the token fresh, subscribe a vehicle, then wait for telemetry.',
      )}
      copyLink
      query={[apiInfo, publicKey, onboarding]}
    >
      <FadeIn>
        <FleetSetupKpiBand
          authenticated={auth.data?.authenticated}
          apiInfo={apiInfo.data}
          publicKey={publicKey.data}
          onboarding={onboarding.data}
          isLoading={kpiLoading}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <section
          aria-label={t('fleetSetup.heroAria', 'Connect Tesla and follow setup')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div id="fleet-setup-account" className="xl:col-span-2">
            <TeslaAccountSection />
          </div>
          <div className="xl:col-span-1">
            <FleetSetupProgress
              authenticated={auth.data?.authenticated === true}
              apiInfo={apiInfo.data}
              onboarding={onboarding.data}
            />
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={0.2}>
        <section
          aria-label={t('fleetSetup.subscribeAria', 'Subscribe telemetry')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="xl:col-span-2">
            <FleetSetupSubscribePanel />
          </div>
          <div className="xl:col-span-1">
            <FleetSetupGuide />
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={0.3}>
        <section
          aria-label={t('fleetSetup.streamAria', 'Streaming and domain readiness')}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5"
        >
          <FleetSetupStreamingPanel onboarding={onboarding.data} />
          <FleetSetupReadiness publicKey={publicKey.data} />
        </section>
      </FadeIn>
    </PageContainer>
  )
}
