/**
 * Live four-step progress for Fleet Setup. Uses the shared onboarding
 * Stepper so the current actionable step is obvious.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GlassPanel, PanelTitle, HelperText, IconBox } from '@/components/ui'
import { Stepper, type OnboardingStep } from '@/features/onboarding/components/Stepper'
import { ListChecks } from 'lucide-react'
import type { FleetApiInfo } from '@/api/hooks/useFleetSetup'
import type { OnboardingStatus } from '@/api/hooks/useOnboarding'

export interface FleetSetupProgressProps {
  authenticated: boolean
  apiInfo: FleetApiInfo | undefined
  onboarding: OnboardingStatus | undefined
}

function scrollTo(id: string) {
  if (typeof document === 'undefined') return
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function buildFleetSetupSteps(args: {
  authenticated: boolean
  tokenValid: boolean
  subscribed: boolean
  streaming: boolean
  t: (key: string, fallback: string) => string
}): OnboardingStep[] {
  return [
    {
      key: 'connect',
      title: args.t('fleetSetup.progress.connect.title', 'Connect Tesla account'),
      description: args.t(
        'fleetSetup.progress.connect.body',
        'Authorize TeslaSync. The refresh token stays on the server and is renewed automatically.',
      ),
      done: args.authenticated,
      cta: {
        label: args.t('fleetSetup.progress.connect.cta', 'Connect now'),
        onClick: () => scrollTo('fleet-setup-account'),
      },
    },
    {
      key: 'token',
      title: args.t('fleetSetup.progress.token.title', 'Keep the Fleet token fresh'),
      description: args.t(
        'fleetSetup.progress.token.body',
        'A valid access token is required for subscribe. TeslaSync refreshes it in the background.',
      ),
      done: args.tokenValid,
      cta: {
        label: args.t('fleetSetup.progress.token.cta', 'Refresh token'),
        onClick: () => scrollTo('fleet-setup-account'),
      },
    },
    {
      key: 'subscribe',
      title: args.t('fleetSetup.progress.subscribe.title', 'Subscribe telemetry'),
      description: args.t(
        'fleetSetup.progress.subscribe.body',
        'Tell Tesla which VIN should stream to this host. Empty host/CA uses FLEET_TELEMETRY_HOST and Let’s Encrypt.',
      ),
      done: args.subscribed,
      cta: {
        label: args.t('fleetSetup.progress.subscribe.cta', 'Choose a vehicle'),
        onClick: () => scrollTo('fleet-setup-subscribe'),
        disabled: !args.tokenValid,
      },
    },
    {
      key: 'stream',
      title: args.t('fleetSetup.progress.stream.title', 'Confirm streaming'),
      description: args.t(
        'fleetSetup.progress.stream.body',
        'The car must be awake. First packets usually arrive on the next drive or charge session.',
      ),
      done: args.streaming,
      cta: {
        label: args.t('fleetSetup.progress.stream.cta', 'Check stream'),
        onClick: () => scrollTo('fleet-setup-stream'),
      },
    },
  ]
}

export function FleetSetupProgress({
  authenticated,
  apiInfo,
  onboarding,
}: FleetSetupProgressProps) {
  const { t } = useTranslation('settings')
  const tokenValid = apiInfo?.has_valid_token === true
  const subscribed =
    Boolean(onboarding?.last_telemetry_at) || onboarding?.data_flowing === true
  const streaming = onboarding?.telemetry_health === 'healthy'

  const steps = useMemo(
    () =>
      buildFleetSetupSteps({
        authenticated,
        tokenValid,
        subscribed,
        streaming,
        t: (key, fallback) => t(key, fallback),
      }),
    [authenticated, tokenValid, subscribed, streaming, t],
  )

  const doneCount = steps.filter((s) => s.done).length

  return (
    <GlassPanel className="h-full space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconBox color="green">
          <ListChecks className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div>
          <PanelTitle>{t('fleetSetup.progress.title', 'Setup progress')}</PanelTitle>
          <HelperText>
            {t('fleetSetup.progress.subtitle', '{{done}} / {{total}} complete', {
              done: doneCount,
              total: steps.length,
            })}
          </HelperText>
        </div>
      </div>
      <Stepper steps={steps} />
    </GlassPanel>
  )
}

export default FleetSetupProgress
