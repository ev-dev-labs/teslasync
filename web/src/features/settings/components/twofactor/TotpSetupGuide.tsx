/**
 * Setup guide — the "how it works" companion to the enrollment hero.
 *
 * Static, i18n-driven four-step walkthrough so the page teaches the
 * flow without the user opening the modal first. Purely informational;
 * always visible so it reads as a stable part of the bento.
 */
import { useTranslation } from 'react-i18next'
import { ListChecks } from 'lucide-react'
import { GlassPanel, IconBox, PanelTitle, Text, HelperText } from '@/components/ui'

export function TotpSetupGuide() {
  const { t } = useTranslation('settings')

  const steps = [
    {
      title: t('totp.guide.step1.title', 'Install an authenticator app'),
      body: t(
        'totp.guide.step1.body',
        'Use any RFC 6238 client — Google Authenticator, 1Password, Bitwarden or Authy.',
      ),
    },
    {
      title: t('totp.guide.step2.title', 'Scan the QR code'),
      body: t(
        'totp.guide.step2.body',
        'Choose Enable TOTP, then scan the QR or paste the manual secret into your app.',
      ),
    },
    {
      title: t('totp.guide.step3.title', 'Verify a 6-digit code'),
      body: t(
        'totp.guide.step3.body',
        'Enter the rotating code your app shows to confirm both devices are in sync.',
      ),
    },
    {
      title: t('totp.guide.step4.title', 'Store your backup codes'),
      body: t(
        'totp.guide.step4.body',
        'Save the one-time codes somewhere safe — they recover access if you lose your app.',
      ),
    },
  ]

  return (
    <GlassPanel className="h-full space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconBox color="cyan">
          <ListChecks className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div>
          <PanelTitle>{t('totp.guide.title', 'How setup works')}</PanelTitle>
          <HelperText>{t('totp.guide.subtitle', 'Four steps, about a minute.')}</HelperText>
        </div>
      </div>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3">
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

export default TotpSetupGuide
