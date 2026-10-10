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
import { PageLayout, SourceContent } from '@/components/layout'
import { deriveDataState } from '@/api/dataState'
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
  usePageTitle(t('fleetSetup.title', 'Fleet setup'))

  const auth = useAuthStatus()
  const apiInfo = useFleetApiInfo()
  const publicKey = usePublicKeyStatus()
  const onboarding = useOnboardingStatus({ pollAfterSetup: true })
  const authState = deriveDataState(auth)
  const apiState = deriveDataState(apiInfo)
  const publicKeyState = deriveDataState(publicKey)
  const onboardingState = deriveDataState(onboarding)

  const kpiLoading =
    auth.isLoading || apiInfo.isLoading || publicKey.isLoading || onboarding.isLoading

  return (
    <PageLayout
      title={t('fleetSetup.title', 'Fleet setup')}
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
          retained={[authState, apiState, publicKeyState, onboardingState].some(state => state.status === 'stale')}
          sourceLoading={{
            account: !authState.hasData && !apiState.hasData && (authState.status === 'initial' || apiState.status === 'initial'),
            token: apiState.status === 'initial',
            domain: publicKeyState.status === 'initial',
            stream: onboardingState.status === 'initial',
          }}
        />
      </FadeIn>
      {(apiState.fatalError || apiState.status === 'stale') && (
        <SourceContent
          state={apiState.fatalError ? 'error' : 'retained'}
          label={t('fleetSetup.kpi.token', 'Access token')}
          emptyMessage={t('fleetSetup.tokenUnavailable', 'Fleet access-token status unavailable.')}
          errorMessage={t('fleetSetup.tokenUnavailable', 'Fleet access-token status unavailable.')}
          error={apiState.fatalError}
          errorRecovery={{ onRetry: () => void apiInfo.refetch() }}
        >
          {null}
        </SourceContent>
      )}

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
          <FleetSetupStreamingPanel
            onboarding={onboarding.data}
            state={onboardingState.fatalError ? 'error' : onboardingState.status === 'initial' ? 'loading' : onboardingState.status === 'stale' ? 'retained' : onboarding.data ? 'ready' : 'empty'}
            error={onboardingState.fatalError}
            onRetry={() => void onboarding.refetch()}
          />
          <FleetSetupReadiness
            publicKey={publicKey.data}
            state={publicKeyState.fatalError ? 'error' : publicKeyState.status === 'initial' ? 'loading' : publicKeyState.status === 'stale' ? 'retained' : publicKey.data ? 'ready' : 'empty'}
            error={publicKeyState.fatalError}
            onRetry={() => void publicKey.refetch()}
          />
        </section>
      </FadeIn>
    </PageLayout>
  )
}
