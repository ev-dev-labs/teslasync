import { useState } from 'react'
import { Gift, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlassPanel } from '../ui/GlassPanel'
import { Badge } from '../ui/Badge'
import {
  CHANGELOG,
  type ChangelogBadge,
  type ChangelogChangeType,
  type ChangelogEntry,
} from '@/generated/changelog'
import { cn } from '@/lib/cn'

/**
 * Compact, collapsible release-notes accordion.
 *
 * Consumes the auto-generated
 * `@/generated/changelog` module so the data is identical to the in-app
 * and the "what's new" modal — no more drift between three hand-curated
 * lists.
 *
 * The previous implementation hard-coded a `releases` constant with inline
 * `style={{ background, color, border }}` values that violated the audit
 * rules. Section colors are now driven by the shared
 * Badge component + Tailwind utility classes.
 */

const BADGE_VARIANT: Record<ChangelogBadge, 'success' | 'info' | 'warning'> = {
  latest: 'success',
  stable: 'info',
  beta: 'warning',
}

const BADGE_KEY: Record<ChangelogBadge, string> = {
  latest: 'changelog.badges.latest',
  stable: 'changelog.badges.stable',
  beta: 'changelog.badges.beta',
}

const BADGE_FALLBACK: Record<ChangelogBadge, string> = {
  latest: 'Latest',
  stable: 'Stable',
  beta: 'Beta',
}

const ICON_TINT: Record<ChangelogBadge, string> = {
  latest: 'text-emerald-300',
  stable: 'text-cyan-300',
  beta: 'text-amber-300',
}

const DOT_TINT: Record<ChangelogChangeType, string> = {
  added: 'bg-emerald-400/60',
  changed: 'bg-cyan-400/60',
  fixed: 'bg-amber-400/60',
  removed: 'bg-rose-400/60',
  deprecated: 'bg-purple-400/60',
  security: 'bg-rose-400/60',
}

interface Props {
  /**
   * Cap the number of releases rendered (newest-first). Defaults to 3 to
   * preserve the previous component's compact footprint when embedded as a
   * sidebar/about-page card.
   */
  limit?: number
}

export default function ReleaseNotes({ limit = 3 }: Props) {
  const { t } = useTranslation()
  const releases: readonly ChangelogEntry[] = CHANGELOG.slice(0, limit)
  const [expanded, setExpanded] = useState<string | null>(releases[0]?.version ?? null)

  return (
    <div className="space-y-3">
      {releases.map((release) => {
        const isExpanded = expanded === release.version
        return (
          <GlassPanel key={release.version} className="overflow-hidden">
            <button
              onClick={() => setExpanded(isExpanded ? null : release.version)}
              className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-white/[0.02]"
              aria-expanded={isExpanded}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Gift className={cn('h-4 w-4', ICON_TINT[release.badge])} aria-hidden />
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  v{release.version}
                </span>
                <Badge variant={BADGE_VARIANT[release.badge]} size="sm">
                  {t(BADGE_KEY[release.badge], BADGE_FALLBACK[release.badge])}
                </Badge>
                <span className="text-xs text-[var(--text-muted)]">{release.date}</span>
              </div>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
              )}
            </button>
            {isExpanded && (
              <div className="border-t border-white/[0.06] px-4 pb-4 pt-3">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  {t('changelog.releaseNotes.heading', "What's New")}
                </p>
                <ul className="space-y-1.5">
                  {release.changes.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                      <span
                        className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', DOT_TINT[item.type])}
                      />
                      <span className="break-words">{item.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </GlassPanel>
        )
      })}
    </div>
  )
}
