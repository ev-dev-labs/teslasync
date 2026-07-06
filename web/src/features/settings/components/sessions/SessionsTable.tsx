import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LogOut } from 'lucide-react'

import {
  GlassPanel,
  PanelTitle,
  Badge,
  Button,
  DataTable,
  Text,
  type Column,
} from '@/components/ui'
import { Skeleton, QueryError } from '@/components/feedback'
import { useDateFormat } from '@/hooks/useDateFormat'
import type { ActiveSession } from '@/api/types'

import { describeDevice } from './deviceLabel'

interface SessionsTableProps {
  sessions: ActiveSession[]
  /** Opens the per-row revoke confirmation for the given session. */
  onRevoke: (session: ActiveSession) => void
  /** Id of the session whose revoke mutation is in flight (disables its row). */
  revokingId?: string | null
  isLoading: boolean
  isError: boolean
  error?: unknown
  onRetry?: () => void
}

/**
 * Detail band: the full list of active devices with a per-row "Sign out"
 * action. The current device is flagged and never gets a revoke button (you
 * can't sign yourself out here — that's what "sign out all others" is for).
 * Owns its own loading + error states; the empty state is handled by
 * `DataTable`'s `emptyMessage`.
 */
export function SessionsTable({
  sessions,
  onRevoke,
  revokingId,
  isLoading,
  isError,
  error,
  onRetry,
}: SessionsTableProps) {
  const { t } = useTranslation('settings')
  const { formatDateTime } = useDateFormat()

  const columns = useMemo<Column<ActiveSession>[]>(
    () => [
      {
        key: 'device',
        header: t('account.sessions.columns.device', 'Device'),
        render: (row) => (
          <div className="flex items-center gap-2">
            <Text color="primary">{describeDevice(row.user_agent)}</Text>
            {row.current ? (
              <Badge
                variant="success"
                size="sm"
                data-testid={`active-sessions-current-pill-${row.id}`}
              >
                {t('account.sessions.current', 'This device')}
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        key: 'ip',
        header: t('account.sessions.columns.ip', 'IP address'),
        render: (row) => (
          <Text color="secondary" className="tabular-nums">{row.ip || '—'}</Text>
        ),
      },
      {
        key: 'created_at',
        header: t('account.sessions.columns.createdAt', 'Signed in'),
        render: (row) => (
          <Text color="secondary">{formatDateTime(row.created_at)}</Text>
        ),
      },
      {
        key: 'last_seen_at',
        header: t('account.sessions.columns.lastSeenAt', 'Last seen'),
        render: (row) => (
          <Text color="secondary">{formatDateTime(row.last_seen_at)}</Text>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (row) =>
          row.current ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRevoke(row)}
              disabled={revokingId === row.id}
              icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
              data-testid={`active-sessions-revoke-${row.id}`}
              aria-label={t('account.sessions.row.revokeAria', 'Sign out {{device}}', {
                device: describeDevice(row.user_agent),
              })}
            >
              {t('account.sessions.row.revoke', 'Sign out')}
            </Button>
          ),
      },
    ],
    [t, formatDateTime, onRevoke, revokingId],
  )

  // Stable identity so `DataTable`'s internal row-key/selection memos don't
  // recompute on every parent render.
  const keyExtractor = useCallback((row: ActiveSession) => row.id, [])

  return (
    <section aria-label={t('account.sessions.tableAria', 'Active devices')}>
      <GlassPanel className="p-4 sm:p-5" data-testid="active-sessions-section">
        <PanelTitle className="mb-3">
          {t('account.sessions.tableTitle', 'Active devices')}
        </PanelTitle>
        {isLoading ? (
          <Skeleton height={240} />
        ) : isError ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : (
          <DataTable<ActiveSession>
            tableId="settings:active-sessions"
            columns={columns}
            data={sessions ?? []}
            keyExtractor={keyExtractor}
            emptyMessage={t('account.sessions.empty', 'No active sessions for this account.')}
          />
        )}
      </GlassPanel>
    </section>
  )
}

export default SessionsTable
