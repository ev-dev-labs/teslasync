import { useTranslation } from 'react-i18next'
import { BookOpen, Globe, ExternalLink, Radio } from 'lucide-react'
import { GlassPanel } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ICON_COLOR_MAP, REFERENCE_LINKS } from './constants'

const ICON_MAP: Record<string, React.ElementType> = {
  BookOpen,
  Globe,
  ExternalLink,
  Radio,
}

export function ReferenceLinksSection() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {REFERENCE_LINKS.map((link) => {
        const Icon = ICON_MAP[link.icon] ?? BookOpen
        return (
          <GlassPanel key={link.url} hover className="p-4">
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3">
              <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ICON_COLOR_MAP.cyan)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{t(link.title)}</p>
                <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{link.url}</p>
              </div>
            </a>
          </GlassPanel>
        )
      })}
    </div>
  )
}
