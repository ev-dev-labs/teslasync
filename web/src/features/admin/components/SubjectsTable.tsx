import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, Search, ShieldOff } from 'lucide-react'

import {
  GlassPanel,
  Badge,
  Input,
  DataTable,
  PanelTitle,
  Caption,
  Code,
  type Column,
} from '@/components/ui'
import { Avatar } from '@/components/data-display'
import { EmptyState, QueryError, TableSkeleton, InlineCallout } from '@/components/feedback'
import { fmtInt } from '@/lib/numberFormat'
import type { ImpersonationCandidate } from '@/api/hooks/useImpersonation'
import { UserImpersonateButton } from './UserImpersonateButton'

interface SubjectsTableProps {
  /** Distinct subjects the admin may impersonate (already excludes self). */
  subjects: ImpersonationCandidate[]
  /** Install is in open (non-forward-auth) mode — impersonation unavailable. */
  open: boolean
  /** An impersonation session is already active — all start buttons disabled. */
  active: boolean
  /** Subject currently being impersonated (when active) — flags its row. */
  targetSubject: string | null
  isLoading: boolean
  isError: boolean
  error: unknown
  onRetry: () => void
}

/**
 * Hero panel: the searchable, paginated table of impersonation subjects.
 * Each section owns its own open / loading / error / empty state so the
 * surrounding page never gates the whole surface behind one flag.
 */
export function SubjectsTable({
  subjects,
  open,
  active,
  targetSubject,
  isLoading,
  isError,
  error,
  onRetry,
}: SubjectsTableProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (term.length === 0) return subjects
    return subjects.filter((s) => (s.subject ?? '').toLowerCase().includes(term))
  }, [subjects, search])

  const hasSubjects = subjects.length > 0
  // The header count must describe the same surface the body renders. Only the
  // list branch shows the table, so gate the count on exactly that condition —
  // otherwise a stale "Showing 3 of 3" can sit above a QueryError or skeleton
  // with no table beneath it (candidates.data survives a failed refetch).
  const showSubjectList = !open && !isLoading && !isError && hasSubjects

  const columns = useMemo<Column<ImpersonationCandidate>[]>(
    () => [
      {
        key: 'subject',
        header: t('impersonation.users.subjectColumn', 'Subject'),
        sortable: true,
        visibleOnMobile: true,
        render: (row) => (
          <div className="flex min-w-0 items-center gap-2">
            <Avatar name={row.subject} userId={row.subject} size="sm" />
            <Code className="block max-w-[16rem] truncate" title={row.subject}>
              {row.subject}
            </Code>
          </div>
        ),
      },
      {
        key: 'status',
        header: t('impersonation.users.statusColumn', 'Status'),
        render: (row) =>
          targetSubject && row.subject === targetSubject ? (
            <Badge variant="info" size="sm" dot>
              {t('impersonation.users.currentTarget', 'Current target')}
            </Badge>
          ) : (
            <Badge variant="success" size="sm" dot>
              {t('impersonation.users.available', 'Available')}
            </Badge>
          ),
      },
      {
        key: 'action',
        header: t('impersonation.users.actionColumn', 'Action'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <div className="flex justify-end">
            <UserImpersonateButton subject={row.subject} disabled={active} />
          </div>
        ),
      },
    ],
    [t, active, targetSubject],
  )

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('impersonation.users.tableTitle', 'Active Subjects')}
        </PanelTitle>
        {showSubjectList && (
          <Caption>
            {t('impersonation.users.showing', 'Showing {{shown}} of {{total}}', {
              shown: fmtInt(filtered.length),
              total: fmtInt(subjects.length),
            })}
          </Caption>
        )}
      </div>

      {open ? (
        <InlineCallout variant="warning" icon={<ShieldOff />} testId="users-page-open-mode">
          {t(
            'impersonation.users.openMode',
            'Impersonation requires forward-auth mode. This install is in open mode, so per-user identity is not available.',
          )}
        </InlineCallout>
      ) : isLoading ? (
        <div data-testid="users-page-loading">
          <TableSkeleton rows={6} cols={3} />
        </div>
      ) : isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : !hasSubjects ? (
        <EmptyState
          /* no-action: there is no admin remediation for "no other subjects active" — the user must wait for someone else to sign in */
          icon={<Users className="h-10 w-10" aria-hidden="true" />}
          title={t('impersonation.users.emptyTitle', 'No other subjects')}
          message={t(
            'impersonation.users.emptyMessage',
            'No other subjects have an active session right now. Sign someone else in to enable impersonation.',
          )}
        />
      ) : (
        <div className="space-y-4" data-testid="users-page-list">
          <Input
            type="search"
            icon={<Search className="h-4 w-4" aria-hidden="true" />}
            placeholder={t('impersonation.users.searchPlaceholder', 'Search subjects…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('impersonation.users.searchLabel', 'Search subjects')}
          />
          <DataTable
            tableId="admin:impersonation-subjects"
            columns={columns}
            data={filtered}
            keyExtractor={(row) => row.subject}
            mobileColumns={['subject', 'action']}
            emptyMessage={t('impersonation.users.noMatch', 'No subjects match your search.')}
            pagination
          />
        </div>
      )}
    </GlassPanel>
  )
}
