import { useTranslation } from 'react-i18next'
import { BookOpen, Globe, ExternalLink, Radio } from 'lucide-react'
import { GlassPanel, Text } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { VisuallyHidden } from '@/components/a11y'
import { cn } from '@/lib/cn'
import { ICON_COLOR_MAP, REFERENCE_LINKS } from './constants'

const ICON_MAP: Record<string, React.ElementType> = {
  BookOpen,
  Globe,
  ExternalLink,
  Radio,
}

/**
 * ReferenceLinksSection — the "Reference" tab of the Developer Tools page.
 *
 * Renders the curated Tesla Fleet API documentation links as a responsive grid
 * of external-link cards. Each card:
 *   - opens in a new tab (`rel="noopener noreferrer"` for tab-nabbing safety),
 *   - exposes an accessible name of "<title> (opens in a new tab)" so screen
 *     readers announce the external navigation,
 *   - hides its decorative glyph from assistive tech, and
 *   - shows a visible focus ring for keyboard users.
 *
 * When the catalog is empty it degrades to an EmptyState rather than a blank
 * grid, and unknown icon keys fall back to the BookOpen glyph.
 */
export function ReferenceLinksSection() {
  const { t } = useTranslation()
  const links = REFERENCE_LINKS ?? []

  if (links.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen className="h-6 w-6" aria-hidden="true" />}
        message={t('devtools.ref.empty', 'No reference links available')}
      />
    )
  }

  const newTabHint = t('common.opensInNewTab', '(opens in a new tab)')

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {links.map((link) => {
        const Icon = ICON_MAP[link.icon] ?? BookOpen
        const label = t(link.title, link.label ?? link.title)
        return (
          <GlassPanel key={link.url ?? link.title} hover className="p-4">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
            >
              <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ICON_COLOR_MAP.cyan)}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <Text as="p" size="sm" weight="medium" color="primary">
                  {label}
                </Text>
                <Text as="p" size="xs" color="muted" className="mt-0.5 truncate">
                  {link.url ?? '—'}
                </Text>
                <VisuallyHidden>{newTabHint}</VisuallyHidden>
              </div>
            </a>
          </GlassPanel>
        )
      })}
    </div>
  )
}
