/**
 * Open-mode placeholder for the two-factor page.
 *
 * Rendered when the backend reports `AUTH_MODE_OPEN` — per-user TOTP
 * needs forward-auth so no enroll/disable controls are offered here.
 * Mirrors the future `<RequiresAuth capability="totp_enrollment">` gate.
 */
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { GlassPanel, IconBox, Heading, HelperText } from '@/components/ui'

export function TotpOpenModeNotice() {
  const { t } = useTranslation('settings')
  return (
    <GlassPanel
      // Polite live region: the parent swaps a loading spinner for this notice
      // once the auth-mode query resolves. Without role="status" that switch is
      // silent for screen-reader users; with it the guidance is announced.
      role="status"
      className="space-y-3 p-4 sm:p-5"
      data-testid="totp-section-open-mode"
    >
      <div className="flex items-center gap-3">
        <IconBox color="amber">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <Heading level="panel">{t('totp.title', 'Two-factor authentication')}</Heading>
      </div>
      <HelperText>
        {t(
          'totp.openMode.message',
          'Per-user TOTP requires forward-auth mode. Configure your reverse proxy to inject X-Forwarded-User then reload.',
        )}
      </HelperText>
    </GlassPanel>
  )
}

export default TotpOpenModeNotice
