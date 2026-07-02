/**
 * ActiveSessionsPage — `/account/sessions`.
 *
 * First-class page under the "Account" side-nav category. Lists every active
 * browser/device session for the signed-in user and allows per-row + bulk
 * revoke — all step-up-gated by RequireSudo upstream (the SPA's `request()`
 * interceptor pops the reauth dialog before either DELETE mutation fires).
 *
 * Modern-UI layout (matches the analytics gold standard):
 *   1. KPI band     — total / this device / other devices / last active.
 *   2. Breakdown    — bento of by-browser / by-platform / by-network panels.
 *   3. Active devices — full-width table with per-row "Sign out".
 * The "Sign out all other devices" bulk action lives in the header actions
 * slot. AUTH_MODE_OPEN collapses the body to a single informational panel.
 *
 * Both destructive actions go through `ConfirmDialog` with NO `silenceKey` —
 * security prompts must never be silenceable.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, Globe, MonitorSmartphone, Network } from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { Button, ConfirmDialog, SectionTitle } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import {
  useSessions,
  useRevokeSession,
  useRevokeAllOtherSessions,
} from '@/api/hooks/useSessions'
import type { ActiveSession } from '@/api/types'

import {
  SessionsSummaryCards,
  SessionBreakdownPanel,
  SessionsTable,
  SessionsOpenModeNotice,
  describeDevice,
  computeSessionStats,
} from '../components/sessions'

export default function ActiveSessionsPage() {
  const { t } = useTranslation('settings')
  usePageTitle(t('account.sessions.title', 'Active sessions'))

  const sessionsQuery = useSessions()
  const revokeMut = useRevokeSession()
  const revokeAllOthersMut = useRevokeAllOtherSessions()

  // Discrete confirm-dialog bits: the per-row confirm carries a session
  // reference, the all-others confirm doesn't — a tagged union would add more
  // noise than it saves at this scale.
  const [revokeTarget, setRevokeTarget] = useState<ActiveSession | null>(null)
  const [showAllOthersConfirm, setShowAllOthersConfirm] = useState(false)

  const data = sessionsQuery.data
  const isSessionMode = data?.mode === 'session'
  const isOpenMode = data?.mode === 'open'
  const sessions = isSessionMode ? data.sessions : []

  const stats = useMemo(() => computeSessionStats(sessions), [sessions])
  const hasOthers = stats.otherCount > 0

  const isLoading = sessionsQuery.isLoading
  const isError = sessionsQuery.isError
  const refetch = () => {
    void sessionsQuery.refetch()
  }

  const revokingId =
    revokeMut.isPending && typeof revokeMut.variables === 'string'
      ? revokeMut.variables
      : null

  const actions =
    isSessionMode && hasOthers ? (
      <Button
        variant="secondary"
        onClick={() => setShowAllOthersConfirm(true)}
        disabled={revokeAllOthersMut.isPending}
        icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
        data-testid="active-sessions-revoke-all-others"
      >
        {revokeAllOthersMut.isPending
          ? t('account.sessions.revokeAllOthersBusy', 'Signing out…')
          : t('account.sessions.revokeAllOthers', 'Sign out all other devices')}
      </Button>
    ) : undefined

  return (
    <PageContainer
      title={t('account.sessions.title', 'Active sessions')}
      subtitle={t(
        'account.sessions.subtitle',
        'Devices currently signed in to TeslaSync. Revoke individual sessions or sign out everywhere else.',
      )}
      actions={actions}
      query={sessionsQuery}
      copyLink
    >
      {isOpenMode ? (
        <FadeIn>
          <SessionsOpenModeNotice />
        </FadeIn>
      ) : (
        <>
          <FadeIn>
            <SessionsSummaryCards
              total={stats.total}
              current={stats.current}
              otherCount={stats.otherCount}
              lastActive={stats.lastActive}
              isLoading={isLoading}
              isError={isError}
              error={sessionsQuery.error}
              onRetry={refetch}
            />
          </FadeIn>

          <FadeIn delay={0.1}>
            <section aria-labelledby="sessions-breakdown-heading" className="space-y-3">
              <SectionTitle id="sessions-breakdown-heading">
                {t('account.sessions.breakdownTitle', 'Device breakdown')}
              </SectionTitle>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <SessionBreakdownPanel
                  title={t('account.sessions.byBrowser', 'By browser')}
                  icon={<Globe className="h-4 w-4" />}
                  items={stats.byBrowser}
                  total={stats.total}
                  isLoading={isLoading}
                  isError={isError}
                  error={sessionsQuery.error}
                  onRetry={refetch}
                  emptyMessage={t(
                    'account.sessions.breakdownEmpty',
                    'No sessions to summarize yet.',
                  )}
                  colorOffset={0}
                />
                <SessionBreakdownPanel
                  title={t('account.sessions.byPlatform', 'By platform')}
                  icon={<MonitorSmartphone className="h-4 w-4" />}
                  items={stats.byOS}
                  total={stats.total}
                  isLoading={isLoading}
                  isError={isError}
                  error={sessionsQuery.error}
                  onRetry={refetch}
                  emptyMessage={t(
                    'account.sessions.breakdownEmpty',
                    'No sessions to summarize yet.',
                  )}
                  colorOffset={2}
                />
                <SessionBreakdownPanel
                  title={t('account.sessions.byNetwork', 'By network')}
                  icon={<Network className="h-4 w-4" />}
                  items={stats.byNetwork}
                  total={stats.total}
                  isLoading={isLoading}
                  isError={isError}
                  error={sessionsQuery.error}
                  onRetry={refetch}
                  emptyMessage={t(
                    'account.sessions.breakdownEmpty',
                    'No sessions to summarize yet.',
                  )}
                  colorOffset={4}
                />
              </div>
            </section>
          </FadeIn>

          <FadeIn delay={0.2}>
            <SessionsTable
              sessions={sessions}
              onRevoke={setRevokeTarget}
              revokingId={revokingId}
              isLoading={isLoading}
              isError={isError}
              error={sessionsQuery.error}
              onRetry={refetch}
            />
          </FadeIn>
        </>
      )}

      {/*
       * Per-row revoke confirm. NO silenceKey — security primitives must always
       * confirm. The upstream RequireSudo gate triggers the reauth dialog
       * automatically once the mutation fires.
       */}
      <ConfirmDialog
        open={revokeTarget != null}
        title={t('account.sessions.confirm.revokeTitle', 'Sign out this device?')}
        message={t(
          'account.sessions.confirm.revokeMessage',
          '{{device}} will be signed out on its next request. Your other devices will stay signed in.',
          { device: revokeTarget ? describeDevice(revokeTarget.user_agent) : '' },
        )}
        confirmLabel={t('account.sessions.confirm.revokeConfirm', 'Sign out')}
        cancelLabel={t('account.sessions.confirm.revokeCancel', 'Keep signed in')}
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
       * "Sign out all other devices" confirm. Same NO-silenceKey rule. The
       * all-others mutation excludes the current session automatically based on
       * the inbound cookie, so the user can't accidentally lock themselves out
       * of this tab.
       */}
      <ConfirmDialog
        open={showAllOthersConfirm}
        title={t('account.sessions.confirm.allOthersTitle', 'Sign out all other devices?')}
        message={t(
          'account.sessions.confirm.allOthersMessage',
          'Every browser other than this one will be signed out on its next request. You can sign back in immediately.',
        )}
        confirmLabel={t('account.sessions.confirm.allOthersConfirm', 'Sign out all others')}
        cancelLabel={t('account.sessions.confirm.allOthersCancel', 'Cancel')}
        variant="danger"
        loading={revokeAllOthersMut.isPending}
        onConfirm={() => {
          revokeAllOthersMut.mutate(undefined, {
            onSettled: () => setShowAllOthersConfirm(false),
          })
        }}
        onCancel={() => setShowAllOthersConfirm(false)}
      />
    </PageContainer>
  )
}
