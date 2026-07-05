/**
 * Setup guide — the "how it works" companion to the enrollment hero.
 *
 * Static, i18n-driven four-step walkthrough so the page teaches the
 * flow without the user opening the modal first. Purely informational;
 * always visible so it reads as a stable part of the bento.
 */
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ListChecks } from 'lucide-react'
import { GlassPanel, IconBox, PanelTitle, Text, HelperText } from '@/components/ui'

export function TotpSetupGuide() {
  const { t } = useTranslation('settings')
  // Stable id so the step list is named by the panel heading — assistive tech
  // announces the ordered list as "How setup works" instead of an unlabeled
  // group of items.
  const titleId = useId()

  // Each step carries a stable `id` so the list key never collides — the
  // `|| '—'` guards below can otherwise degrade every title to the same
  // em-dash placeholder, which would duplicate a title-based React key.
  const steps = useMemo(
    () => [
      {
        id: 'step1',
        title: t('totp.guide.step1.title', 'Install an authenticator app') || '—',
        body:
          t(
            'totp.guide.step1.body',
            'Use any RFC 6238 client — Google Authenticator, 1Password, Bitwarden or Authy.',
          ) || '—',
      },
      {
        id: 'step2',
        title: t('totp.guide.step2.title', 'Scan the QR code') || '—',
        body:
          t(
            'totp.guide.step2.body',
            'Choose Enable TOTP, then scan the QR or paste the manual secret into your app.',
          ) || '—',
      },
      {
        id: 'step3',
        title: t('totp.guide.step3.title', 'Verify a 6-digit code') || '—',
        body:
          t(
            'totp.guide.step3.body',
            'Enter the rotating code your app shows to confirm both devices are in sync.',
          ) || '—',
      },
      {
        id: 'step4',
        title: t('totp.guide.step4.title', 'Store your backup codes') || '—',
        body:
          t(
            'totp.guide.step4.body',
            'Save the one-time codes somewhere safe — they recover access if you lose your app.',
          ) || '—',
      },
    ],
    [t],
  )

  // `|| '—'` keeps the heading + subtitle from collapsing to a blank line when
  // a locale resolves either key to an empty string (the list keeps its name).
  const title = t('totp.guide.title', 'How setup works') || '—'
  const subtitle = t('totp.guide.subtitle', 'Four steps, about a minute.') || '—'

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

export default TotpSetupGuide
