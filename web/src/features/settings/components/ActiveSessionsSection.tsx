/**
 * Phase-46 / Prompt 42 — Active sessions / device management.
 *
 * Renders a single GlassPanel under <section id="security"> on the
 * Settings page (mounted right after TOTPEnrollmentSection — both are
 * security primitives so they share the same anchor).
 *
 * Three render branches:
 *
 *   1. **Loading**   — spinner placeholder while the list query is in
 *      flight on first mount. We deliberately render the placeholder
 *      INSIDE the panel chrome (rather than hiding it) so the layout
 *      doesn't reflow when data arrives.
 *
 *   2. **Open mode** — backend returned 501 AUTH_MODE_OPEN. Mirrors
 *      what <RequiresAuth capability="session_list"> will render once
 *      prompt 57 ships; for now we inline the placeholder so the
 *      Settings page works without it.
 *
 *   3. **Forward-auth** — DataTable of sessions plus per-row
 *      "Sign out" + a footer "Sign out all other devices" button.
 *      Both destructive actions go through ConfirmDialog with NO
 *      `silenceKey` — security prompts must never be silenceable.
 *
 * The DELETE routes are RequireSudo-gated upstream, so the SPA's
 * request() interceptor pops the reauth dialog before the mutation
 * actually fires. Errors are surfaced via the shared toast helper
 * inside the hook; this component doesn't render its own error
 * banner for revoke failures (the toast is the single source of
 * truth) but does render an inline error for the LIST query so the
 * panel doesn't render an empty table with no explanation.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Laptop, AlertTriangle, LogOut, ShieldAlert } from 'lucide-react'

import {
  GlassPanel,
  IconBox,
  Button,
  Badge,
  ConfirmDialog,
  DataTable,
  Heading,
  HelperText,
  ErrorText,
  Text,
  type Column,
} from '@/components/ui'
import { Spinner } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import {
  useSessions,
  useRevokeSession,
  useRevokeAllOtherSessions,
} from '@/api/hooks/useSessions'
import { useDateFormat } from '@/hooks/useDateFormat'
import type { ActiveSession } from '@/api/types'

/**
 * Heuristic device label derived from the User-Agent string. We
 * intentionally keep this dependency-free: a tiny `match` ladder
 * covers the major browsers + OSes correctly enough to populate a
 * "Firefox on Windows" pill, and falls back to the raw UA on misses
 * so the user can still identify the row. A real ua-parser library
 * would be ~30 KB of bundle for marginal accuracy on this surface.
 */
function describeDevice(userAgent: string): string {
  const ua = userAgent.trim()
  if (!ua) return 'Unknown device'

  let browser = 'Browser'
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'
  else if (/Chromium/.test(ua)) browser = 'Chromium'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari'

  let os = 'Unknown OS'
  if (/Windows NT/.test(ua)) os = 'Windows'
  else if (/Mac OS X/.test(ua) || /Macintosh/.test(ua)) os = 'macOS'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Linux/.test(ua)) os = 'Linux'

  return `${browser} on ${os}`
}

export function ActiveSessionsSection() {
  const { t } = useTranslation('settings')
  const { formatDateTime: formatTimestamp } = useDateFormat()

  const sessions = useSessions()
  const revokeMut = useRevokeSession()
  const revokeAllOthersMut = useRevokeAllOtherSessions()

  // Local UI state for the two confirm dialogs. We keep them as
  // discrete bits rather than a single discriminated union because
  // the per-row confirm carries a session reference while the
  // all-others confirm doesn't, and the noise of a tagged union
  // outweighs the typing benefit at this scale.
  const [revokeTarget, setRevokeTarget] = useState<ActiveSession | null>(null)
  const [showAllOthersConfirm, setShowAllOthersConfirm] = useState(false)

  // ── Loading / first paint ───────────────────────────────────────
  if (sessions.isLoading) {
    return (
      <FadeIn delay={0.05}>
        <GlassPanel
          className="p-6 flex items-center gap-4"
          data-testid="active-sessions-loading"
        >
          <Spinner />
          <Text variant="bodySm">
            {t('sessions.loading', 'Loading sessions…')}
          </Text>
        </GlassPanel>
      </FadeIn>
    )
  }

  // ── Open mode placeholder ───────────────────────────────────────
  // Mirrors the inline placeholder TOTPEnrollmentSection renders;
  // both will collapse to <RequiresAuth capability="..."> once
  // prompt 57 ships.
  if (!sessions.data || sessions.data.mode === 'open') {
    return (
      <FadeIn delay={0.05}>
        <GlassPanel
          className="p-6 space-y-3"
          data-testid="active-sessions-open-mode"
        >
          <div className="flex items-center gap-3">
            <IconBox color="amber">
              <AlertTriangle className="h-5 w-5" />
            </IconBox>
            <Heading level="panel">
              {t('sessions.openMode.title', 'Active sessions')}
            </Heading>
          </div>
          <HelperText>
            {t(
              'sessions.openMode.message',
              'Active session tracking requires forward-auth mode. Configure your reverse proxy to inject X-Forwarded-User then reload.',
            )}
          </HelperText>
        </GlassPanel>
      </FadeIn>
    )
  }

  // ── Forward-auth: list + actions ───────────────────────────────
  const rows = sessions.data.sessions
  const hasOthers = rows.some((r) => !r.current)

  const columns: Column<ActiveSession>[] = [
    {
      key: 'device',
      header: t('sessions.columns.device', 'Device'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-primary)]">{describeDevice(row.user_agent)}</span>
          {row.current ? (
            <Badge variant="success" data-testid={`active-sessions-current-pill-${row.id}`}>
              {t('sessions.current', 'This device')}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'ip',
      header: t('sessions.columns.ip', 'IP address'),
      render: (row) => row.ip || '—',
    },
    {
      key: 'createdAt',
      header: t('sessions.columns.createdAt', 'Signed in'),
      render: (row) => formatTimestamp(row.created_at),
    },
    {
      key: 'lastSeenAt',
      header: t('sessions.columns.lastSeenAt', 'Last seen'),
      render: (row) => formatTimestamp(row.last_seen_at),
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
            onClick={() => setRevokeTarget(row)}
            disabled={revokeMut.isPending && revokeMut.variables === row.id}
            data-testid={`active-sessions-revoke-${row.id}`}
            aria-label={t('sessions.row.revokeAria', 'Sign out {{device}}', {
              device: describeDevice(row.user_agent),
            })}
          >
            <LogOut className="h-4 w-4 mr-2" />
            {t('sessions.row.revoke', 'Sign out')}
          </Button>
        ),
    },
  ]

  return (
    <>
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6 space-y-4" data-testid="active-sessions-section">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <IconBox color="cyan">
                <Laptop className="h-5 w-5" />
              </IconBox>
              <div>
                <Heading level="panel">
                  {t('sessions.title', 'Active sessions')}
                </Heading>
                <HelperText>
                  {t(
                    'sessions.subtitle',
                    "Devices currently signed in to TeslaSync. Revoking a session signs that browser out on its next request — your upstream identity provider's session is unaffected.",
                  )}
                </HelperText>
              </div>
            </div>
            {hasOthers ? (
              <Button
                variant="secondary"
                onClick={() => setShowAllOthersConfirm(true)}
                disabled={revokeAllOthersMut.isPending}
                data-testid="active-sessions-revoke-all-others"
              >
                <ShieldAlert className="h-4 w-4 mr-2" />
                {revokeAllOthersMut.isPending
                  ? t('sessions.revokeAllOthersBusy', 'Signing out…')
                  : t('sessions.revokeAllOthers', 'Sign out all other devices')}
              </Button>
            ) : null}
          </div>

          {sessions.isError ? (
            <ErrorText data-testid="active-sessions-error">
              {t('sessions.errors.load', 'Failed to load active sessions.')}
            </ErrorText>
          ) : null}

          <DataTable<ActiveSession>
            tableId="settings:active-sessions"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.id}
            emptyMessage={t('sessions.empty', 'No active sessions for this account.')}
          />
        </GlassPanel>
      </FadeIn>

      {/*
       * Per-row revoke confirm. NO silenceKey — security primitives
       * must always confirm. The upstream RequireSudo gate triggers
       * the reauth dialog automatically once the mutation fires.
       */}
      <ConfirmDialog
        open={revokeTarget != null}
        title={t('sessions.confirm.revokeTitle', 'Sign out this device?')}
        message={t(
          'sessions.confirm.revokeMessage',
          '{{device}} will be signed out on its next request. Your other devices will stay signed in.',
          {
            device: revokeTarget ? describeDevice(revokeTarget.user_agent) : '',
          },
        )}
        confirmLabel={t('sessions.confirm.revokeConfirm', 'Sign out')}
        cancelLabel={t('sessions.confirm.revokeCancel', 'Keep signed in')}
        variant="danger"
        loading={revokeMut.isPending}
        onConfirm={() => {
          if (!revokeTarget) return
          const id = revokeTarget.id
          revokeMut.mutate(id, {
            onSettled: () => setRevokeTarget(null),
          })
        }}
        onCancel={() => setRevokeTarget(null)}
      />

      {/*
       * "Sign out all other devices" confirm. Same NO-silenceKey
       * rule. The all-others mutation excludes the current session
       * automatically based on the inbound cookie, so the user
       * doesn't accidentally lock themselves out of this tab.
       */}
      <ConfirmDialog
        open={showAllOthersConfirm}
        title={t('sessions.confirm.allOthersTitle', 'Sign out all other devices?')}
        message={t(
          'sessions.confirm.allOthersMessage',
          'Every browser other than this one will be signed out on its next request. You can sign back in immediately.',
        )}
        confirmLabel={t('sessions.confirm.allOthersConfirm', 'Sign out all others')}
        cancelLabel={t('sessions.confirm.allOthersCancel', 'Cancel')}
        variant="danger"
        loading={revokeAllOthersMut.isPending}
        onConfirm={() => {
          revokeAllOthersMut.mutate(undefined, {
            onSettled: () => setShowAllOthersConfirm(false),
          })
        }}
        onCancel={() => setShowAllOthersConfirm(false)}
      />
    </>
  )
}

export default ActiveSessionsSection
