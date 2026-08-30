import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CalendarDays } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui'
import { formatDate } from '@/lib/dateFormat'
import {
  buildReleaseNotes,
  summarizeReleaseNote,
  type ReleaseAudience,
  type ReleaseNote,
} from '@/lib/releaseNotes'

/**
 * First-class release notes (HELP-07).
 *
 * Derived from the canonical `CHANGELOG.md` via the generated changelog, so
 * there is exactly one place to edit and no second document to forget.
 *
 * Each release answers the four questions a release note exists to answer:
 * what changed, who it affects, whether anything is required of the reader,
 * and when it shipped. Action items are hoisted above features — an operator
 * scanning a release must not have to scroll past twenty bullets to find the
 * migration.
 */

const AUDIENCE_LABEL: Record<ReleaseAudience, { key: string; fallback: string }> = {
  all_users: { key: 'releaseNotes.audience.allUsers', fallback: 'All users' },
  fleet_operators: { key: 'releaseNotes.audience.fleetOperators', fallback: 'Fleet operators' },
  administrators: { key: 'releaseNotes.audience.administrators', fallback: 'Administrators' },
  developers: { key: 'releaseNotes.audience.developers', fallback: 'API consumers' },
}

export interface ReleaseNotesPanelProps {
  /** How many releases to show. */
  limit?: number
  className?: string
}

export function ReleaseNotesPanel({ limit = 3, className }: ReleaseNotesPanelProps) {
  const { t } = useTranslation()
  const notes = useMemo(() => buildReleaseNotes().slice(0, Math.max(0, limit)), [limit])

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)} data-testid="release-notes-panel">
      <PanelTitle>{t('releaseNotes.title', "What's changed")}</PanelTitle>
      <Text as="p" variant="bodySm" className="mt-1 max-w-2xl">
        {t(
          'releaseNotes.subtitle',
          'Generated from the project changelog. "Action needed" is flagged conservatively — a false alarm costs a minute, a missed migration costs an outage.',
        )}
      </Text>

      <div className="mt-4 space-y-4">
        {notes.length === 0 ? (
          <Text as="p" variant="bodySm" color="muted" data-testid="release-notes-empty">
            {t('releaseNotes.empty', 'No releases have been published yet.')}
          </Text>
        ) : (
          notes.map((note) => <ReleaseNoteCard key={note.version} note={note} />)
        )}
      </div>
    </GlassPanel>
  )
}

function ReleaseNoteCard({ note }: { note: ReleaseNote }) {
  const { t } = useTranslation()
  const items = summarizeReleaseNote(note)

  return (
    <article
      data-testid="release-note"
      data-release-version={note.version}
      className="rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] p-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Text as="span" size="sm" weight="medium" color="primary">
          {note.version}
        </Text>
        <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <CalendarDays className="h-3 w-3" aria-hidden />
          {formatDate(note.date)}
        </span>
        {note.badge === 'latest' && (
          <Badge variant="success">{t('releaseNotes.badge.latest', 'Latest')}</Badge>
        )}
        {note.actionRequired && (
          <Badge variant="warning" data-testid="release-action-badge">
            <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />
            {t('releaseNotes.actionNeeded', 'Action needed')}
          </Badge>
        )}
        {note.hasMigration && (
          <Badge variant="danger" data-testid="release-migration-badge">
            {t('releaseNotes.migration', 'Migration')}
          </Badge>
        )}
      </header>

      <div className="mt-2">
        <Text as="p" variant="caption">
          {t('releaseNotes.affects', 'Affects')}
        </Text>
        <div className="mt-1 flex flex-wrap gap-1.5" data-testid="release-audiences">
          {note.audiences.map((audience) => (
            <span
              key={audience}
              data-release-audience={audience}
              className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-2xs uppercase tracking-wide text-[var(--text-muted)]"
            >
              {t(AUDIENCE_LABEL[audience].key, AUDIENCE_LABEL[audience].fallback)}
            </span>
          ))}
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {items.map((item, index) => (
          <li key={`${note.version}-${index}`} className="flex items-start gap-2">
            <span
              className={cn(
                'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                item.actionRequired ? 'bg-amber-300' : 'bg-[var(--text-muted)]',
              )}
              aria-hidden
            />
            <Text as="span" variant="bodySm" color="muted">
              {item.actionRequired && (
                <span className="mr-1 font-medium text-amber-300">
                  {t('releaseNotes.itemActionPrefix', 'Action:')}
                </span>
              )}
              {item.text}
            </Text>
          </li>
        ))}
      </ul>
    </article>
  )
}
