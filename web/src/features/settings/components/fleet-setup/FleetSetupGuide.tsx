/**
 * Static walkthrough of Tesla Fleet setup — companion to the live stepper.
 * Always visible so the page teaches the real Tesla order of operations.
 */
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ListChecks } from 'lucide-react'
import { GlassPanel, IconBox, PanelTitle, Text, HelperText } from '@/components/ui'

export function FleetSetupGuide() {
  const { t } = useTranslation('settings')
  const titleId = useId()

  const steps = useMemo(
    () => [
      {
        id: 'connect',
        title: t('fleetSetup.guide.step1.title', 'Connect Tesla') || '—',
        body:
          t(
            'fleetSetup.guide.step1.body',
            'Sign in with Tesla OAuth. TeslaSync stores a refresh token and renews the access token automatically — you should not paste tokens by hand.',
          ) || '—',
      },
      {
        id: 'domain',
        title: t('fleetSetup.guide.step2.title', 'Point Tesla at this host') || '—',
        body:
          t(
            'fleetSetup.guide.step2.body',
            'Fleet Telemetry needs a public hostname with a TLS certificate Tesla trusts (Let’s Encrypt is the default CA). Partner registration also publishes your EC public key at /.well-known/appspecific/com.tesla.3p.public-key.pem.',
          ) || '—',
      },
      {
        id: 'subscribe',
        title: t('fleetSetup.guide.step3.title', 'Subscribe the vehicle') || '—',
        body:
          t(
            'fleetSetup.guide.step3.body',
            'Call Tesla’s fleet_telemetry_config for the selected VIN. That tells the car (via Tesla) where to stream, which signals to send, and which CA to trust for your server.',
          ) || '—',
      },
      {
        id: 'stream',
        title: t('fleetSetup.guide.step4.title', 'Wait for the car to wake') || '—',
        body:
          t(
            'fleetSetup.guide.step4.body',
            'Streaming starts when the vehicle is awake — usually the next drive or charge. Parked and asleep cars will not push telemetry. Virtual key pairing is for commands, not this stream.',
          ) || '—',
      },
    ],
    [t],
  )

  const title = t('fleetSetup.guide.title', 'How Fleet Setup works') || '—'
  const subtitle =
    t('fleetSetup.guide.subtitle', 'Connect → domain TLS → subscribe VIN → stream on wake.') || '—'

  return (
    <GlassPanel className="h-full space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconBox color="cyan">
          <ListChecks className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div>
          <PanelTitle id={titleId}>{title}</PanelTitle>
          <HelperText>{subtitle}</HelperText>
        </div>
      </div>
      <ol aria-labelledby={titleId} className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-white/[0.08]"
            >
              <Text as="span" size="xs" weight="semibold" color="primary">
                {i + 1}
              </Text>
            </span>
            <div className="space-y-0.5">
              <Text as="p" size="sm" weight="medium" color="primary">
                {step.title}
              </Text>
              <Text variant="bodySm" as="p">
                {step.body}
              </Text>
            </div>
          </li>
        ))}
      </ol>
    </GlassPanel>
  )
}

export default FleetSetupGuide
