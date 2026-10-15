/**
 * ActiveSessionsPage — `/account/sessions`.
 * Lists the signed-in user's devices with per-row and bulk revocation.
 * RequireSudo gates both mutations upstream.
 * Both destructive actions pin their confirmation scope and revalidate the
 * latest cached session mode, targets and current device before submission.
 * Retained metadata stays visible; revocation requires current capabilities,
 * live mode and a successful, unblocked read at entry and final confirmation.
 * Security prompts must never be silenceable.
 */

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, Globe, MonitorSmartphone, Network } from 'lucide-react'

import { PageLayout } from '@/components/layout'
import { deriveDataState } from '@/api/dataState'
import { Button, ConfirmDialog, SectionTitle, Text } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useLoadAnnouncement } from '@/hooks/useStatusAnnouncer'
import { useOperationalMode } from '@/hooks/useOperationalMode'
import { authModeKeys, useAuthMode } from '@/api/hooks/useAuthMode'
import { readOperationalModeFromEnvironment } from '@/lib/operationalMode'
import {
  useSessions,
  useRevokeSession,
  useRevokeAllOtherSessions,
  sessionKeys,
} from '@/api/hooks/useSessions'
import type { ActiveSession, ActiveSessionsResponse, AuthModeResponse } from '@/api/types'

import {
  SessionsSummaryCards,
  SessionBreakdownPanel,
  SessionsTable,
  SessionsOpenModeNotice,
  describeDevice,
  computeSessionStats,
} from '../components/sessions'

type SessionConfirmation = {
  action: 'session' | 'all-others'
  targets: ActiveSession[]
  currentScope: string
}

const sessionScope = (sessions: ActiveSession[]) =>
  JSON.stringify(sessions.map(({ id, created_at }) => [id, created_at]).sort())

export default function ActiveSessionsPage() {
  const { t } = useTranslation('settings')
  const { t: tt } = useTranslation()
  usePageTitle(t('account.sessions.title', 'Active sessions'))

  const sessionsQuery = useSessions()
  const revokeMut = useRevokeSession()
  const revokeAllOthersMut = useRevokeAllOtherSessions()
  const queryClient = useQueryClient()
  const authQuery = useAuthMode()
  const operationalMode = useOperationalMode()

  const [confirmation, setConfirmation] = useState<SessionConfirmation | null>(null)
  const [confirmationInvalidated, setConfirmationInvalidated] = useState(false)
  const [deferredReason, setDeferredReason] = useState<string | null>(null)

  const getWriteBlockReason = () => {
    const mode = readOperationalModeFromEnvironment()
    if (!operationalMode.canWrite || mode.isReadOnly) {
      return operationalMode.writeBlockReason ?? (mode.mode === 'cached'
        ? tt('operationalMode.cached.writeBlocked', 'Reconnect before making operational changes.')
        : tt('operationalMode.writeBlocked', 'Return to live mode before making operational changes.'))
    }
    const auth = queryClient.getQueryData<AuthModeResponse>(authModeKeys.all)
    const authState = queryClient.getQueryState(authModeKeys.all)
    if (authState?.status !== 'success' || authState.fetchStatus !== 'idle' || authState.isInvalidated) {
      return tt('dataState.stale.message', 'The latest values are temporarily unavailable. Previously loaded data remains visible.')
    }
    if (auth?.mode !== 'forward_auth' || !auth.capabilities.session_list || !auth.capabilities.step_up_reauth) {
      return tt('error.unsupported.message', 'This feature is not available with the current server or deployment configuration.')
    }
    const source = queryClient.getQueryState(sessionKeys.list)
    if (source?.status !== 'success' || source.fetchStatus !== 'idle' || source.isInvalidated) {
      return source?.fetchStatus === 'paused'
        ? tt('dataSources.status.paused', 'Refresh paused')
        : tt('dataState.stale.message', 'The latest values are temporarily unavailable. Previously loaded data remains visible.')
    }
    return null
  }
  // Subscribe to capability changes, but re-read cache state at each action boundary.
  const writeBlockReason = getWriteBlockReason()

  const data = sessionsQuery.data
  const isSessionMode = data?.mode === 'session'
  const isOpenMode = data?.mode === 'open'
  const sessions = isSessionMode ? data.sessions : []

  const stats = useMemo(() => computeSessionStats(sessions), [sessions])
  const hasOthers = stats.otherCount > 0
  const revokeTarget = confirmation?.action === 'session' ? confirmation.targets[0] : null
  const openConfirmation = (action: SessionConfirmation['action'], targets: ActiveSession[]) => {
    const reason = getWriteBlockReason()
    setDeferredReason(reason)
    if (reason || revokeMut.isPending || revokeAllOthersMut.isPending) return
    setConfirmationInvalidated(false)
    setConfirmation({
      action,
      targets: targets.map(session => ({ ...session })),
      currentScope: sessionScope(sessions.filter(session => session.current)),
    })
  }
  const canConfirm = (source: ActiveSessionsResponse | undefined) => {
    if (!confirmation || confirmationInvalidated || source?.mode !== 'session') return false
    if (sessionScope(source.sessions.filter(session => session.current)) !== confirmation.currentScope) return false
    const eligible = source.sessions.filter(session => !session.current && !session.revoked_at)
    if (!confirmation.targets.length || !confirmation.targets.every(target =>
      eligible.some(session => session.id === target.id && session.created_at === target.created_at),
    )) return false
    return confirmation.action === 'session' || sessionScope(eligible) === sessionScope(confirmation.targets)
  }
  const confirmationValid = !writeBlockReason && !deferredReason && canConfirm(data)
  const confirmationDetails = !confirmationValid && confirmation ? (
    <Text role="alert" variant="bodySm" color="secondary">
      {deferredReason ?? writeBlockReason ?? t(
        'account.sessions.confirm.invalidated',
        'The session mode or selected devices changed. Nothing was signed out. Cancel and review the current devices before confirming again.',
      )}
    </Text>
  ) : undefined
  const submitConfirmation = () => {
    const reason = getWriteBlockReason()
    if (reason) {
      setDeferredReason(reason)
      return
    }
    // Read the cache again: it may have changed before React rendered the update.
    if (!canConfirm(queryClient.getQueryData<ActiveSessionsResponse>(sessionKeys.list))) {
      setConfirmationInvalidated(true)
      return
    }
    if (deferredReason || revokeMut.isPending || revokeAllOthersMut.isPending) return
    if (confirmation?.action === 'session') {
      revokeMut.mutate(confirmation.targets[0].id, { onSettled: () => setConfirmation(null) })
    } else if (confirmation?.action === 'all-others') {
      revokeAllOthersMut.mutate(undefined, { onSettled: () => setConfirmation(null) })
    }
  }

  const sessionsState = deriveDataState(sessionsQuery)
  const isLoading = sessionsState.status === 'initial'
  const isError = sessionsState.fatalError != null
  useLoadAnnouncement({
    label: t('account.sessions.title', 'Active sessions'),
    isLoading,
    isError,
    count: isSessionMode ? sessions.length : undefined,
  })
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
        wrapLabel
        onClick={() => openConfirmation('all-others', sessions.filter(session => !session.current && !session.revoked_at))}
        disabled={revokeMut.isPending || revokeAllOthersMut.isPending || writeBlockReason != null}
        title={writeBlockReason ?? undefined}
        icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
        data-testid="active-sessions-revoke-all-others"
      >
        {revokeAllOthersMut.isPending
          ? t('account.sessions.revokeAllOthersBusy', 'Signing out…')
          : t('account.sessions.revokeAllOthers', 'Sign out all other devices')}
      </Button>
    ) : undefined

  return (
    <PageLayout
      title={t('account.sessions.title', 'Active sessions')}
      subtitle={t(
        'account.sessions.subtitle',
        'Devices currently signed in to TeslaSync. Revoke individual sessions or sign out everywhere else.',
      )}
      destructiveActions={actions}
      query={sessionsQuery}
      busy={isLoading || sessionsState.isRefreshing}
      announce={false}
      copyLink
    >
      <StaleRefreshWarning state={sessionsState} />
      <StaleRefreshWarning state={deriveDataState(authQuery)} />
      {isSessionMode && (deferredReason ?? writeBlockReason) && (
        <Text role="status" variant="bodySm" color="secondary" data-testid="active-sessions-deferred">
          {deferredReason ?? writeBlockReason}
        </Text>
      )}
      {sessionsState.status === 'initial' && sessionsState.isRefreshBlocked && (
        <AlertBanner
          variant="info"
          title={t('account.sessions.title', 'Active sessions')}
          role="status"
          aria-live="polite"
          data-testid="active-sessions-paused"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Text as="p" variant="bodySm" color="secondary">{tt('Paused', 'Paused')}</Text>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              wrapLabel
              className="min-h-11 md:min-h-9"
              onClick={refetch}
            >
              {tt('common.retry', 'Retry')}
            </Button>
          </div>
        </AlertBanner>
      )}
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
              retained={sessionsState.status === 'stale'}
              sourceAvailable={isSessionMode}
              error={sessionsState.fatalError}
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
                  error={sessionsState.fatalError}
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
                  error={sessionsState.fatalError}
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
                  error={sessionsState.fatalError}
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
              onRevoke={session => openConfirmation('session', [session])}
              revokingId={revokingId}
              isLoading={isLoading}
              isError={isError}
              error={sessionsState.fatalError}
              onRetry={refetch}
            />
          </FadeIn>
        </>
      )}

      <ConfirmDialog
        open={confirmation != null}
        title={revokeTarget
          ? t('account.sessions.confirm.revokeTitle', 'Sign out this device?')
          : t('account.sessions.confirm.allOthersTitle', 'Sign out all other devices?')}
        message={revokeTarget
          ? t(
            'account.sessions.confirm.revokeMessage',
            '{{device}} will be signed out on its next request. Your other devices will stay signed in.',
            { device: describeDevice(revokeTarget.user_agent) },
          )
          : t(
            'account.sessions.confirm.allOthersMessage',
            'Every browser other than this one will be signed out on its next request. You can sign back in immediately.',
          )}
        confirmLabel={revokeTarget
          ? t('account.sessions.confirm.revokeConfirm', 'Sign out')
          : t('account.sessions.confirm.allOthersConfirm', 'Sign out all others')}
        cancelLabel={revokeTarget
          ? t('account.sessions.confirm.revokeCancel', 'Keep signed in')
          : t('account.sessions.confirm.allOthersCancel', 'Cancel')}
        variant="danger"
        loading={revokeMut.isPending || revokeAllOthersMut.isPending}
        confirmDisabled={!confirmationValid}
        details={confirmationDetails}
        onConfirm={submitConfirmation}
        onCancel={() => setConfirmation(null)}
      />
    </PageLayout>
  )
}
