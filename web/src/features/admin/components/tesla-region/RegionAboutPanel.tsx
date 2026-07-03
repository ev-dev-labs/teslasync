import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { GlassPanel, Badge, IconBox, PanelTitle, Text, Label } from '@/components/ui'
import { REGION_ZONE_FALLBACK } from './helpers'

/**
 * Always-visible reference panel explaining what the account region controls
 * and listing the Tesla Fleet API zones. Static, i18n'd helper content — the
 * inner prose is constrained to a reading column while the panel spans its grid
 * cell full-width.
 */
export function RegionAboutPanel() {
  const { t } = useTranslation('settings')

  const zones = [
    { key: 'na', label: t('region.zones.na', REGION_ZONE_FALLBACK.na) },
    { key: 'eu', label: t('region.zones.eu', REGION_ZONE_FALLBACK.eu) },
    { key: 'cn', label: t('region.zones.cn', REGION_ZONE_FALLBACK.cn) },
  ]

  return (
    <GlassPanel className="h-full space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconBox color="cyan" size="sm">
          <Info className="h-4 w-4" aria-hidden="true" />
        </IconBox>
        <PanelTitle>{t('region.about.title', 'About your region')}</PanelTitle>
      </div>

      <Text as="p" variant="bodySm" className="max-w-prose">
        {t(
          'region.about.body',
          'Tesla homes every account to a regional Fleet API host. TeslaSync sends commands and reads vehicle data through this base URL, so it must match the region where your account was created.',
        )}
      </Text>

      <div className="space-y-2">
        <Label>{t('region.about.zonesTitle', 'Fleet API zones')}</Label>
        <ul className="space-y-2">
          {zones.map((zone) => (
            <li key={zone.key} className="flex items-center gap-2">
              <Badge variant="neutral" size="sm">
                {zone.key.toUpperCase()}
              </Badge>
              <Text variant="bodySm">{zone.label}</Text>
            </li>
          ))}
        </ul>
      </div>
    </GlassPanel>
  )
}
