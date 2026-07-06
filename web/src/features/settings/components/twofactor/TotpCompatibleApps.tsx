/**
 * Compatible-apps panel.
 *
 * Reassurance that enrollment is client-agnostic — any RFC 6238 TOTP
 * app works. The names are proper nouns (brands), so they live in a
 * constant rather than the i18n catalog; the surrounding copy is
 * translated.
 */
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Smartphone } from 'lucide-react'
import { GlassPanel, IconBox, PanelTitle, Text, HelperText } from '@/components/ui'

// Brand names — intentionally not translated (proper nouns).
const COMPATIBLE_APPS = [
  'Google Authenticator',
  '1Password',
  'Bitwarden',
  'Authy',
  'Microsoft Authenticator',
  'Ente Auth',
] as const

export function TotpCompatibleApps() {
  const { t } = useTranslation('settings')
  // Stable id so the app list is named by the panel heading — assistive tech
  // announces it as "Compatible apps" rather than an unlabeled group of items.
  const titleId = useId()

  // `|| '—'` guards against an empty/missing translation so the heading and
  // subtitle never collapse to a blank line (and the list keeps its name).
  const title = t('totp.apps.title', 'Compatible apps') || '—'
  const subtitle = t('totp.apps.subtitle', 'Any RFC 6238 TOTP client works.') || '—'

  return (
    <GlassPanel className="h-full space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconBox color="purple">
          <Smartphone className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div>
          <PanelTitle id={titleId}>{title}</PanelTitle>
          <HelperText>{subtitle}</HelperText>
        </div>
      </div>
      <ul aria-labelledby={titleId} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {COMPATIBLE_APPS.map((name) => (
          <li
            key={name}
            className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-white/[0.06]"
          >
            <Smartphone className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
            <Text as="span" variant="body">
              {name}
            </Text>
          </li>
        ))}
      </ul>
    </GlassPanel>
  )
}

export default TotpCompatibleApps
