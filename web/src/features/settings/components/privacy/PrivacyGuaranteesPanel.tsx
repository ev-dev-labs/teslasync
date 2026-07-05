import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { HardDrive, MonitorSmartphone, SlidersHorizontal } from 'lucide-react'

import { GlassPanel, IconBox, SectionTitle, Subhead, Text } from '@/components/ui'
import type { NeonColor } from '@/lib/tokens'

interface InfoCardProps {
  icon: ReactNode
  color: NeonColor
  title: string
  body: string
}

interface Guarantee extends InfoCardProps {
  /** Stable React reconciliation key for the mapped tile list. */
  id: string
}

/** One "how we handle this data" guarantee tile. Local — not a shared export. */
function InfoCard({ icon, color, title, body }: InfoCardProps) {
  return (
    <GlassPanel className="h-full p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <IconBox color={color}>{icon}</IconBox>
        <div className="min-w-0 space-y-1">
          {/* `|| '—'` guards against an empty/missing translation so a tile
              never collapses to a blank line. */}
          <Subhead>{title || '—'}</Subhead>
          <Text as="p" variant="caption" className="max-w-prose">
            {body || '—'}
          </Text>
        </div>
      </div>
    </GlassPanel>
  )
}

/**
 * Full-width informational band that explains how TeslaSync treats the
 * browser-local privacy surfaces above. Static, honest context drawn from the
 * storage helpers' own contracts (recent pages + consent never leave this
 * browser). Reflows 1 → 2 → 3 columns so wide screens stay filled.
 */
export function PrivacyGuaranteesPanel() {
  const { t } = useTranslation()

  // Data-driven tiles. Memoised so the copy is only re-derived when the
  // active language (and therefore `t`) changes, keeping each mapped tile's
  // reconciliation key stable across unrelated re-renders.
  const guarantees = useMemo<Guarantee[]>(
    () => [
      {
        id: 'local',
        icon: <HardDrive className="h-5 w-5" aria-hidden="true" />,
        color: 'cyan',
        title: t('account.privacy.about.localTitle', 'Stored on this device'),
        body: t(
          'account.privacy.about.localBody',
          'Recently viewed pages and your cookie choice live in this browser’s local storage — they are never uploaded to the server.',
        ),
      },
      {
        id: 'sync',
        icon: <MonitorSmartphone className="h-5 w-5" aria-hidden="true" />,
        color: 'blue',
        title: t('account.privacy.about.syncTitle', 'No cross-device sync'),
        body: t(
          'account.privacy.about.syncBody',
          'Each browser keeps its own list and consent state. Clearing them here has no effect on your other devices or sessions.',
        ),
      },
      {
        id: 'control',
        icon: <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />,
        color: 'green',
        title: t('account.privacy.about.controlTitle', 'You stay in control'),
        body: t(
          'account.privacy.about.controlBody',
          'Wipe your history or change your consent at any time. Changes take effect immediately and update every open tab.',
        ),
      },
    ],
    [t],
  )

  return (
    <section aria-labelledby="privacy-about-heading" className="space-y-3">
      <SectionTitle id="privacy-about-heading">
        {t('account.privacy.about.title', 'How TeslaSync handles this data')}
      </SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        {guarantees.map(({ id, ...card }) => (
          <InfoCard key={id} {...card} />
        ))}
      </div>
    </section>
  )
}

export default PrivacyGuaranteesPanel
