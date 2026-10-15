/**
 * Fleet-level four-step progress for Fleet Setup. Uses the shared onboarding
 * Stepper so the current actionable step is obvious.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GlassPanel, PanelTitle, HelperText, IconBox } from '@/components/ui'
import { Stepper, type OnboardingStep } from '@/features/onboarding/components/Stepper'
import { ListChecks } from 'lucide-react'
import type { FleetApiInfo } from '@/api/hooks/useFleetSetup'
import type { OnboardingStatus } from '@/api/hooks/useOnboarding'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { isInsideModalSurface, isTextEntryElement } from '@/lib/routeFocus'
import { deriveDataState, type DataState } from '@/api/dataState'

type ProgressSource = Pick<DataState<unknown>,
  'hasData' | 'fatalError' | 'status' | 'isRefreshBlocked'> & { isLoading?: boolean }

export interface FleetSetupProgressProps {
  authenticated: boolean | undefined
  apiInfo: FleetApiInfo | undefined
  onboarding: OnboardingStatus | undefined
  sources?: { account: ProgressSource; token: ProgressSource; telemetry: ProgressSource }
}

function scrollTo(id: string, reduce: boolean) {
  if (typeof document === 'undefined') return
  const target = document.getElementById(id)
  if (!target) return
  target.scrollIntoView({ behavior: reduce ? 'instant' : 'smooth', block: 'start' })
  if (
    !document.hasFocus() ||
    isInsideModalSurface(document.activeElement) ||
    isTextEntryElement(document.activeElement)
  ) return
  const heading = target.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6')
  const focusTarget = heading ?? target
  if (!focusTarget.hasAttribute('tabindex')) focusTarget.tabIndex = -1
  focusTarget.focus({ preventScroll: true })
}

export function buildFleetSetupSteps(args: {
  authenticated: boolean | null
  tokenValid: boolean | null
  subscribed: boolean | null
  streaming: boolean | null
  reduce?: boolean
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
        onClick: () => scrollTo('fleet-setup-account', args.reduce ?? false),
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
        onClick: () => scrollTo('fleet-setup-account', args.reduce ?? false),
      },
    },
    {
      key: 'subscribe',
      title: args.t('fleetSetup.progress.fleetHistory.title', 'Fleet telemetry observed'),
      description: args.t(
        'fleetSetup.progress.fleetHistory.body',
        'Telemetry has been received from the fleet. This historical check does not confirm the selected VIN has a telemetry configuration.',
      ),
      done: args.subscribed,
      cta: {
        label: args.t('fleetSetup.progress.subscribe.cta', 'Choose a vehicle'),
        onClick: () => scrollTo('fleet-setup-subscribe', args.reduce ?? false),
        disabled: args.tokenValid !== true,
      },
    },
    {
      key: 'stream',
      title: args.t('fleetSetup.progress.fleetHealth.title', 'Confirm fleet telemetry health'),
      description: args.t(
        'fleetSetup.progress.fleetHealth.body',
        'Healthy means fleet telemetry arrived in the last 24 hours, not that the selected VIN is streaming now.',
      ),
      done: args.streaming,
      cta: {
        label: args.t('fleetSetup.progress.stream.cta', 'Check stream'),
        onClick: () => scrollTo('fleet-setup-stream', args.reduce ?? false),
      },
    },
  ]
}

export function FleetSetupProgress({
  authenticated,
  apiInfo,
  onboarding,
  sources,
}: FleetSetupProgressProps) {
  const { t } = useTranslation('settings')
  const { t: sourceT } = useTranslation()
  const { reduce } = useMotionPreference()
  const accountSource = sources?.account ?? deriveDataState({ data: authenticated })
  const tokenSource = sources?.token ?? deriveDataState({ data: apiInfo })
  const telemetrySource = sources?.telemetry ?? deriveDataState({ data: onboarding })
  const connection = accountSource.hasData ? authenticated ?? null : null
  const tokenValid = tokenSource.hasData ? apiInfo?.has_valid_token ?? null : null
  const subscribed = telemetrySource.hasData && onboarding
    ? Boolean(onboarding.last_telemetry_at) || onboarding.data_flowing
    : null
  const streaming = telemetrySource.hasData && onboarding
    ? onboarding.telemetry_health === 'unknown' ? null : onboarding.telemetry_health === 'healthy'
    : null

  const baseSteps = useMemo(
    () =>
      buildFleetSetupSteps({
        authenticated: connection,
        tokenValid,
        subscribed,
        streaming,
        reduce,
        t: (key, fallback) => t(key, fallback),
      }),
    [connection, tokenValid, subscribed, streaming, reduce, t],
  )
  const stepSources = [accountSource, tokenSource, telemetrySource, telemetrySource]
  const steps = baseSteps.map((step, index) => {
    const source = stepSources[index]!
    const annotation = source.isRefreshBlocked
      ? sourceT('dataSources.status.paused', 'Refresh paused')
      : source.fatalError
        ? sourceT('dataSources.status.failed', 'Failed')
        : source.status === 'stale'
          ? sourceT('dataState.stale.title', 'Data may be stale')
          : source.isLoading
            ? source.hasData
              ? sourceT('dataSources.status.refreshing', 'Refreshing')
              : sourceT('dataSources.status.loading', 'Loading')
            : !source.hasData ? sourceT('common.unknown', 'Unknown') : null
    return {
      ...step,
      busy: source.isLoading === true && !source.isRefreshBlocked,
      description: annotation ? `${step.description} ${annotation}` : step.description,
    }
  })

  const doneCount = steps.filter((s) => s.done).length
  const hasUnknown = steps.some(step => step.done === null)

  return (
    <GlassPanel
      className="h-full min-w-0 space-y-4 p-4 sm:p-5"
      aria-busy={stepSources.some(source => source.isLoading && !source.isRefreshBlocked)}
    >
      <div className="flex min-w-0 items-center gap-3">
        <IconBox color="green">
          <ListChecks className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div className="min-w-0 break-words [overflow-wrap:anywhere]">
          <PanelTitle>{t('fleetSetup.progress.title', 'Setup progress')}</PanelTitle>
          <HelperText>
            {hasUnknown ? sourceT('common.unknown', 'Unknown') : t('fleetSetup.progress.subtitle', '{{done}} / {{total}} complete', {
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
