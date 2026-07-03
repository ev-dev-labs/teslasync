/**
 * Recovery & good-habits panel.
 *
 * Companion guidance for backup codes and day-to-day TOTP use. Static
 * and always visible so the safety advice is a stable part of the
 * bento rather than a transient toast.
 */
import { useTranslation } from 'react-i18next'
import { LifeBuoy, KeyRound, ShieldCheck, Clock } from 'lucide-react'
import { GlassPanel, IconBox, PanelTitle, Text, HelperText } from '@/components/ui'

export function TotpRecoveryPanel() {
  const { t } = useTranslation('settings')

  const tips = [
    {
      Icon: KeyRound,
      text: t('totp.recovery.tip1', 'Each backup code works once — regenerate when you are running low.'),
    },
    {
      Icon: ShieldCheck,
      text: t(
        'totp.recovery.tip2',
        'Store codes in your password manager, not next to your authenticator app.',
      ),
    },
    {
      Icon: Clock,
      text: t('totp.recovery.tip3', 'Codes rotate every 30 seconds; if one is rejected, wait for the next.'),
    },
  ]

  return (
    <GlassPanel className="h-full space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconBox color="amber">
          <LifeBuoy className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div>
          <PanelTitle>{t('totp.recovery.title', 'Recovery & good habits')}</PanelTitle>
          <HelperText>{t('totp.recovery.subtitle', 'Keep a way back in if you lose your phone.')}</HelperText>
        </div>
      </div>
      <ul className="space-y-3">
        {tips.map(({ Icon, text }) => (
          <li key={text} className="flex items-start gap-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
            <Text variant="bodySm" as="p">
              {text}
            </Text>
          </li>
        ))}
      </ul>
    </GlassPanel>
  )
}

export default TotpRecoveryPanel
