import { type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { GlassPanel, IconBox, Heading, Text } from '@/components/ui'
import { type NeonColor } from '@/lib/tokens'
import { cn } from '@/lib/cn'

export interface SettingsActionCardProps {
  /** Leading glyph rendered inside a colored `IconBox`. */
  icon: ReactNode
  /** Tint of the `IconBox` (and the hover glow when the card is a link). */
  iconColor?: NeonColor
  title: string
  description: string
  /**
   * When set, the whole card becomes an anchor to this href and gains a
   * hover glow + trailing external-link affordance. Mutually exclusive
   * with `action`.
   */
  href?: string
  /** Trailing action node (e.g. a `<Button>`) shown when the card is not a link. */
  action?: ReactNode
  /** Forwarded to the panel so the product-tour engine can target this card. */
  dataTour?: string
  className?: string
}

/**
 * Compact "utility" card for the Settings page quick-actions band —
 * icon + title + description with either a link affordance or a trailing
 * action button. Shared so the three cards (Data Export, Onboarding Tour,
 * Setup Checklist) stay visually identical and equal-height in the grid.
 */
export function SettingsActionCard({
  icon,
  iconColor = 'cyan',
  title,
  description,
  href,
  action,
  dataTour,
  className,
}: SettingsActionCardProps) {
  const glow = iconColor === 'green' ? 'green' : iconColor === 'purple' ? 'purple' : 'cyan'

  const panel = (
    <GlassPanel
      data-tour={dataTour}
      hover={Boolean(href)}
      glow={href ? glow : 'none'}
      className={cn(
        'flex h-full items-center gap-4 p-4 sm:p-5',
        href && 'cursor-pointer',
        className,
      )}
    >
      <IconBox color={iconColor}>{icon}</IconBox>
      <div className="min-w-0 flex-1">
        <Heading level="panel" className="truncate" title={title}>
          {title}
        </Heading>
        <Text as="p" variant="caption" className="mt-0.5">
          {description}
        </Text>
      </div>
      {href ? (
        <ExternalLink
          className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-primary)]"
          aria-hidden="true"
        />
      ) : (
        action
      )}
    </GlassPanel>
  )

  if (href) {
    return (
      <a
        href={href}
        className="group block h-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
      >
        {panel}
      </a>
    )
  }

  return panel
}
