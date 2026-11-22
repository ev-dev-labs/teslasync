import { useCallback, useId, useMemo, useState } from 'react'
import { Gift, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlassPanel } from '../ui/GlassPanel'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Text } from '../ui/Typography'
import { EmptyState } from './EmptyState'
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
  stable: 'text-status-info',
  beta: 'text-amber-300',
}

const DOT_TINT: Record<ChangelogChangeType, string> = {
  added: 'bg-emerald-400/60',
  changed: 'bg-status-info/60',
  fixed: 'bg-amber-400/60',
  removed: 'bg-rose-400/60',
  deprecated: 'bg-purple-400/60',
  security: 'bg-rose-400/60',
}

// Screen-reader labels for the otherwise colour-only change-type dots, so the
// "Added / Fixed / Security …" categorisation is not lost to non-sighted
// users. Reuses the existing `changelog.sections.*` i18n bundle.
const CHANGE_TYPE_KEY: Record<ChangelogChangeType, string> = {
  added: 'changelog.sections.added',
  changed: 'changelog.sections.changed',
  fixed: 'changelog.sections.fixed',
  removed: 'changelog.sections.removed',
  deprecated: 'changelog.sections.deprecated',
  security: 'changelog.sections.security',
}

const CHANGE_TYPE_FALLBACK: Record<ChangelogChangeType, string> = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
  removed: 'Removed',
  deprecated: 'Deprecated',
  security: 'Security',
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
  // Clamp the cap. A raw `CHANGELOG.slice(0, limit)` mishandles non-positive
  // callers: `slice(0, -1)` returns "everything but the last release" and
  // `slice(0, 0)` yields a silently-blank panel. Floor + max(0, …) collapse
  // both into a deterministic empty result that the empty-state branch owns.
  const releases = useMemo<readonly ChangelogEntry[]>(
    () => CHANGELOG.slice(0, Math.max(0, Math.floor(limit))),
    [limit],
  )
  const baseId = useId()
  const [expanded, setExpanded] = useState<string | null>(
    () => releases[0]?.version ?? null,
  )

  const toggle = useCallback((version: string) => {
    setExpanded((prev) => (prev === version ? null : version))
  }, [])

  if (releases.length === 0) {
    return (
      <EmptyState
        icon={<Gift className="h-8 w-8" aria-hidden />}
        message={t('changelog.releaseNotes.empty', 'No release notes available yet.')}
      />
    )
  }

  return (
    <div data-app-part="list" className="min-w-0 space-y-3">
      {releases.map((release) => {
        const isExpanded = expanded === release.version
        const triggerId = `${baseId}-trigger-${release.version}`
        const panelId = `${baseId}-panel-${release.version}`
        return (
          <GlassPanel key={release.version} data-app-part="panel list-row" className="overflow-hidden">
            <Button
              id={triggerId}
              type="button"
              variant="ghost"
              onClick={() => toggle(release.version)}
              className="h-auto min-h-11 w-full justify-between rounded-none p-4 text-start hover:bg-[var(--surface-2)]"
              aria-expanded={isExpanded}
              aria-controls={panelId}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 whitespace-normal">
                <Gift className={cn('h-4 w-4 shrink-0', ICON_TINT[release.badge])} aria-hidden />
                <Text size="sm" weight="semibold" color="primary" className="min-w-0 [overflow-wrap:anywhere]">
                  v{release.version}
                </Text>
                <Badge variant={BADGE_VARIANT[release.badge]} size="sm">
                  {t(BADGE_KEY[release.badge], BADGE_FALLBACK[release.badge])}
                </Badge>
                <span className="text-xs text-[var(--text-muted)]">{release.date}</span>
              </span>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
              )}
            </Button>
            {isExpanded && (
              <div
                id={panelId}
                role="region"
                aria-labelledby={triggerId}
                className="border-t border-[var(--border-subtle)] px-4 pb-4 pt-3"
              >
                <p className="text-xs font-medium tracking-wider text-[var(--text-muted)] mb-2">
                  {t('changelog.releaseNotes.heading', "What's new")}
                </p>
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {(release.changes ?? []).map((item, i) => (
                    <li
                      key={`${release.version}-${i}`}
                      className="flex min-w-0 items-start gap-2 py-2 text-sm text-[var(--text-secondary)]"
                    >
                      <span
                        role="img"
                        aria-label={t(CHANGE_TYPE_KEY[item.type], CHANGE_TYPE_FALLBACK[item.type])}
                        className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', DOT_TINT[item.type])}
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{item.text}</span>
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
