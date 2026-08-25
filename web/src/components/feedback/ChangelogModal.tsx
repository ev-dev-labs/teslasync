import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button, Badge } from '@/components/ui/runtime'
import { EmptyState } from './EmptyState'
import {
  OPEN_CHANGELOG_MODAL_EVENT,
  useChangelog,
} from '@/hooks/useChangelog'
import type {
  ChangelogBadge,
  ChangelogChangeType,
  ChangelogEntry,
} from '@/generated/changelog'
import { cn } from '@/lib/cn'

/**
 * Changelog modal.
 *
 * Mounts at the app root and surfaces "what's new since last visit". Two
 * activation paths:
 *
 *   1. Auto-show — fires once per 24h when the user has unseen entries AND
 *      has finished the OnboardingWizard (so first-time users see the wizard
 *      first, not a modal stack) AND no tour is currently active. Stamps
 *      `lastShownAt` on display so the throttle takes effect even if the user
 *      dismisses without acknowledging.
 *
 *   2. Manual open — listens for the `OPEN_CHANGELOG_MODAL_EVENT` window
 *      event. Fired by the command palette ("What's new"), the footer status
 *      bar version segment, and any other surface that needs to pop the
 *      modal imperatively.
 *
 * Closing via "Got it" → marks the latest version as seen (so the unseen-dot
 * disappears across the app). Closing via Esc / backdrop → leaves the
 * seen-version untouched but stamps the throttle.
 *
 * Tour gating: the auto-show timer waits 2s after mount before evaluating
 * eligibility, then probes for the `[data-tour-active]` overlay marker
 * (added by TourOverlay). This keeps us from stacking modals when an
 * onboarding tour is mid-flight without needing a global tour-state store.
 */

const AUTO_SHOW_DELAY_MS = 2_000

export function ChangelogModal() {
  const { t } = useTranslation()
  const { entries, newEntries, seenVersion, hasUnseen, canAutoShow, hasCompletedOnboarding, markSeen, stampShown } =
    useChangelog()

  const [open, setOpen] = useState(false)
  // Track whether the user explicitly acknowledged the modal so the close
  // handler knows whether to write the seen-version stamp.
  const [acknowledged, setAcknowledged] = useState(false)

  // Auto-show on app boot once the gating predicate flips true. The 2s
  // settle delay lets the tour overlay (auto-started 1.5s after route load
  // by Layout) render its DOM marker so the probe below can detect it.
  useEffect(() => {
    if (open) return
    if (!hasUnseen) return
    if (!hasCompletedOnboarding) return
    if (!canAutoShow) return
    const timer = window.setTimeout(() => {
      // Re-check at fire time — anything could have changed since schedule.
      if (document.querySelector('[data-tour-active]')) return
      setOpen(true)
      setAcknowledged(false)
      stampShown()
    }, AUTO_SHOW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [open, hasUnseen, hasCompletedOnboarding, canAutoShow, stampShown])

  // Imperative-open via the global custom event.
  useEffect(() => {
    const handler = () => {
      setOpen(true)
      setAcknowledged(false)
      stampShown()
    }
    window.addEventListener(OPEN_CHANGELOG_MODAL_EVENT, handler)
    return () => window.removeEventListener(OPEN_CHANGELOG_MODAL_EVENT, handler)
  }, [stampShown])

  const handleClose = () => {
    if (acknowledged) {
      markSeen()
    }
    setOpen(false)
    setAcknowledged(false)
  }

  const handleGotIt = () => {
    setAcknowledged(true)
    // Mark seen synchronously so the unseen-dot clears even if state batching
    // delays the close-effect by a frame.
    markSeen()
    setOpen(false)
  }

  const handleViewFull = () => {
    setAcknowledged(true)
    markSeen()
    setOpen(false)
    window.open(
      'https://github.com/ev-dev-labs/teslasync/releases',
      '_blank',
      'noopener,noreferrer',
    )
  }

  // The list shown inside the modal is the unseen subset when there is one;
  // first-time visitors (and anyone who manually opens while caught up) see
  // the entire history, which is also the right onboarding behaviour.
  const hasNewEntries = newEntries.length > 0
  const visibleEntries: readonly ChangelogEntry[] = hasNewEntries ? newEntries : entries
  // First visit == the user has never acknowledged any version. Deriving this
  // from `seenVersion` (rather than comparing list lengths) keeps the copy
  // correct for a returning, caught-up user who opens the modal manually —
  // they must NOT be told "N new release(s)" when nothing is actually new.
  const isFirstVisit = seenVersion === null

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('changelog.modal.title', "What's new in TeslaSync")}
      size="lg"
    >
      <div className="space-y-4 text-sm text-[var(--text-secondary)]">
        {isFirstVisit ? (
          <p className="text-[var(--text-muted)]">
            {t(
              'changelog.modal.subtitleFirstVisit',
              "Welcome! Here's a quick tour of what TeslaSync ships with right now.",
            )}
          </p>
        ) : hasNewEntries ? (
          <p className="text-[var(--text-muted)]">
            {t(
              'changelog.modal.subtitleSinceLastVisit',
              '{{count}} new release(s) since your last visit.',
              { count: newEntries.length },
            )}
          </p>
        ) : (
          <p className="text-[var(--text-muted)]">
            {t(
              'changelog.modal.subtitleCaughtUp',
              "You're all caught up — here's the full release history.",
            )}
          </p>
        )}

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {visibleEntries.length > 0 ? (
            visibleEntries.map((entry, idx) => (
              <ChangelogModalEntry key={entry.version} entry={entry} defaultOpen={idx < 2} />
            ))
          ) : (
            <EmptyState message={t('changelog.modal.empty', 'No release notes are available yet.')} />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--glass-border)] pt-3">
          <Button variant="ghost" onClick={handleViewFull}>
            {t('changelog.modal.viewFull', 'View full changelog')}
          </Button>
          <Button onClick={handleGotIt}>
            {t('changelog.modal.gotIt', 'Got it')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Internal: collapsible entry ──────────────────────────────────────────────

const SECTION_ORDER: readonly ChangelogChangeType[] = [
  'added',
  'changed',
  'fixed',
  'removed',
  'deprecated',
  'security',
]

const SECTION_KEY: Record<ChangelogChangeType, string> = {
  added: 'changelog.sections.added',
  changed: 'changelog.sections.changed',
  fixed: 'changelog.sections.fixed',
  removed: 'changelog.sections.removed',
  deprecated: 'changelog.sections.deprecated',
  security: 'changelog.sections.security',
}

const SECTION_FALLBACK: Record<ChangelogChangeType, string> = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
  removed: 'Removed',
  deprecated: 'Deprecated',
  security: 'Security',
}

const SECTION_DOT: Record<ChangelogChangeType, string> = {
  added: 'bg-emerald-400/70',
  changed: 'bg-cyan-400/70',
  fixed: 'bg-amber-400/70',
  removed: 'bg-rose-400/70',
  deprecated: 'bg-purple-400/70',
  security: 'bg-rose-400/70',
}

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

interface EntryProps {
  entry: ChangelogEntry
  defaultOpen: boolean
}

function ChangelogModalEntry({ entry, defaultOpen }: EntryProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultOpen)
  const panelId = useId()

  // Group changes by canonical type. The generator already emits them in
  // section order, but we re-group here so empty sections don't render.
  // Memoised so toggling `expanded` doesn't re-run the six filter passes,
  // and null-guarded so a malformed generated entry can never throw.
  const grouped = useMemo(
    () =>
      SECTION_ORDER.map((type) => ({
        type,
        items: (entry.changes ?? []).filter((c) => c.type === type),
      })).filter((g) => g.items.length > 0),
    [entry.changes],
  )

  return (
    <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          'flex w-full items-center justify-between gap-3 px-4 py-3 text-left',
          'rounded-lg transition-colors hover:bg-white/[0.02]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">v{entry.version}</span>
          <Badge variant={BADGE_VARIANT[entry.badge]} size="sm">
            {t(BADGE_KEY[entry.badge], BADGE_FALLBACK[entry.badge])}
          </Badge>
          <span className="truncate text-xs text-[var(--text-muted)]">{entry.date}</span>
        </div>
        <span aria-hidden className="shrink-0 text-xs text-[var(--text-muted)]">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div id={panelId} className="space-y-3 border-t border-[var(--glass-border)] px-4 py-3">
          {grouped.map((group) => (
            <div key={group.type}>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {t(SECTION_KEY[group.type], SECTION_FALLBACK[group.type])}
              </p>
              <ul className="space-y-1.5">
                {group.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                    <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', SECTION_DOT[group.type])} />
                    <span className="break-words">{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
