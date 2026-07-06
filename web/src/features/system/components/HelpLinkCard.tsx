// A single curated Help destination card.
//
// Extracted from HelpPage so the page stays an orchestrator while the
// repeated card surface lives in one shared-component-only place. The
// card is a full-height, fully-clickable Link wrapping a GlassPanel —
// the whole surface is the touch target (>=44px) so it works on phones.
//
// The `data-testid="help-baseline-link-<id>"` on the Link is load-bearing:
// TestRagHelpAIOffHidesAssistantAndDocsLinksWork asserts every curated
// link renders with its exact href in BOTH ai-off and ai-on modes.

import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowRight, type LucideIcon } from 'lucide-react'

import { GlassPanel, IconBox, PanelTitle, Text } from '@/components/ui'
import type { NeonColor } from '@/lib/tokens'

export interface HelpLink {
  /** stable id used as React key + test marker */
  readonly id: string
  /** target SPA route (existing canonical destinations only) */
  readonly to: string
  /** Lucide icon component reference */
  readonly Icon: LucideIcon
  /** accent hue for the icon chip — chip-only, never body text */
  readonly accent: NeonColor
  /** i18n key for the link's display title */
  readonly titleKey: string
  /** fallback English display title (used if translation is missing) */
  readonly titleFallback: string
  /** i18n key for the one-line link description */
  readonly descKey: string
  /** fallback English description */
  readonly descFallback: string
}

export interface HelpLinkCardProps {
  readonly link: HelpLink
}

export function HelpLinkCard({ link }: HelpLinkCardProps) {
  const { t } = useTranslation()
  const { Icon } = link

  return (
    <Link
      to={link.to}
      data-testid={`help-baseline-link-${link.id}`}
      className="group block h-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
    >
      <GlassPanel
        hover
        glow="cyan"
        className="flex h-full min-h-28 flex-col gap-3 p-4 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <IconBox color={link.accent}>
            {/* Guard a missing icon reference: HelpLink data is config-driven,
                and one undefined `Icon` would otherwise throw "Element type is
                invalid" and blank the entire Help page rather than this one card. */}
            {Icon ? <Icon className="h-5 w-5" aria-hidden="true" /> : null}
          </IconBox>
          <ArrowRight
            className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--text-primary)]"
            aria-hidden="true"
          />
        </div>
        <div className="space-y-1">
          <PanelTitle>{t(link.titleKey, link.titleFallback)}</PanelTitle>
          <Text as="p" variant="bodySm">
            {t(link.descKey, link.descFallback)}
          </Text>
        </div>
      </GlassPanel>
    </Link>
  )
}

HelpLinkCard.displayName = 'HelpLinkCard'
