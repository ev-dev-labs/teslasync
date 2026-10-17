/**
 * Composes the enrollment flow without persisting credentials.
 * Retained status stays visible, but mutations require capability and live
 * readiness, rechecked on submit. Only confirmed open mode hides controls.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { onlineManager, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { GlassPanel, ConfirmDialog, HelperText, Button } from '@/components/ui'
import { VisuallyHidden } from '@/components/a11y'
import { Skeleton, QueryError } from '@/components/feedback'
import { deriveDataState } from '@/api/dataState'
import { FadeIn } from '@/components/motion'
import { totpKeys, type TOTPStatus } from '@/api/hooks/useTOTP'
import {
  useTotpEnrollmentFlow,
  TotpStatusHero,
  TotpEnrollModal,
  TotpBackupCodesModal,
  TotpOpenModeNotice,
} from './twofactor'

interface TOTPEnrollmentSectionProps {
  capability?: boolean
  liveReady?: boolean
}

const subscribeToOnline = (onChange: () => void) => onlineManager.subscribe(onChange)
const getOnlineSnapshot = () => onlineManager.isOnline()

export function TOTPEnrollmentSection({
  capability = true,
  liveReady = true,
}: TOTPEnrollmentSectionProps = {}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const flow = useTotpEnrollmentFlow()
  const { status } = flow
  const statusState = deriveDataState(status)
  const online = useSyncExternalStore(subscribeToOnline, getOnlineSnapshot)
  const readiness = useRef({ capability, liveReady })
  readiness.current = { capability, liveReady }
  const [submissionBlocked, setSubmissionBlocked] = useState(false)
  const commandsReady = capability && liveReady && online
    && status.isSuccess && status.fetchStatus === 'idle'
    && status.data?.mode === 'session'
  useEffect(() => {
    if (commandsReady) setSubmissionBlocked(false)
  }, [commandsReady, status.dataUpdatedAt])
  const blockedMessage = t(
    'totp.commands.blocked',
    'Two-factor changes require available enrollment access and a successful live status check. Previously loaded settings remain visible. Retry the status check when access and the connection are ready.',
  )
  const guardCommand = (command: () => void | Promise<void>, expectedActivated: boolean) => () => {
    // Read the cache at submission time too: a dialog may outlive its status read.
    const current = queryClient.getQueryState<TOTPStatus>(totpKeys.status)
    if (!readiness.current.capability || !readiness.current.liveReady
      || !onlineManager.isOnline() || current?.status !== 'success'
      || current.fetchStatus !== 'idle' || current.data?.mode !== 'session'
      || (current.data.activated === true) !== expectedActivated) {
      setSubmissionBlocked(true)
      return
    }
    setSubmissionBlocked(false)
    void command()
  }

  if (statusState.status === 'initial' && !statusState.isRefreshBlocked
    && status.fetchStatus === 'fetching') {
    return (
      <FadeIn delay={0.05}>
        <GlassPanel
          role="status"
          aria-busy="true"
          aria-label={t('totp.loading', 'Loading two-factor settings…')}
          className="flex items-center gap-4 p-4 sm:p-5"
        >
          <Skeleton rounded className="h-11 w-11 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-full max-w-md" />
            <VisuallyHidden>
              {t('totp.loading', 'Loading two-factor settings…')}
            </VisuallyHidden>
          </div>
        </GlassPanel>
      </FadeIn>
    )
  }

  if (statusState.fatalError) {
    return (
      <FadeIn delay={0.05}>
        <GlassPanel className="p-4 sm:p-5">
          <QueryError error={statusState.fatalError} onRetry={() => void status.refetch()} />
        </GlassPanel>
      </FadeIn>
    )
  }

  if (!status.data) {
    return (
      <FadeIn delay={0.05}>
        <GlassPanel className="space-y-3 p-4 sm:p-5" role="status">
          <HelperText>
            {statusState.isRefreshBlocked
              ? t('common:dataSources.status.paused', 'Refresh paused')
              : t('totp.loading', 'Loading two-factor settings…')}
          </HelperText>
          <HelperText>{blockedMessage}</HelperText>
          <Button variant="ghost" onClick={() => void status.refetch()}>
            {t('common:retry', 'Retry')}
          </Button>
        </GlassPanel>
      </FadeIn>
    )
  }

  if (status.data.mode === 'open') {
    return (
      <FadeIn delay={0.05}>
        <TotpOpenModeNotice />
      </FadeIn>
    )
  }

  const sessionStatus = status.data
  const activated = sessionStatus.activated === true
  const lastUsedAt = activated ? sessionStatus.last_used_at : undefined
  const backupRemaining = activated ? sessionStatus.backup_codes_remaining : 0

  return (
    <>
      <FadeIn delay={0.05}>
        {!commandsReady && (
          <div className="space-y-2 pb-3" role="status" data-testid="totp-commands-blocked">
            <HelperText>{blockedMessage}</HelperText>
            <Button variant="ghost" onClick={() => void status.refetch()} disabled={status.isFetching}>
              {t('common:retry', 'Retry')}
            </Button>
          </div>
        )}
        <fieldset disabled={!commandsReady} className="min-w-0">
          <TotpStatusHero
            activated={activated}
            lastUsedAt={lastUsedAt}
            backupRemaining={backupRemaining}
            enrolling={flow.enrolling}
            regenerating={flow.regenerating}
            onEnroll={guardCommand(flow.handleEnroll, false)}
            onRegenerate={guardCommand(flow.handleRegenerate, true)}
            onDisable={guardCommand(flow.openDisableConfirm, true)}
          />
        </fieldset>
      </FadeIn>

      <TotpEnrollModal
        open={flow.dialogStep === 'enroll'}
        enrollment={flow.enrollment}
        code={flow.verifyCode}
        error={!commandsReady || submissionBlocked ? blockedMessage : flow.verifyError}
        verifying={flow.verifying}
        onCodeChange={flow.changeVerifyCode}
        onVerify={guardCommand(flow.handleVerify, false)}
        onClose={flow.closeDialog}
      />

      <TotpBackupCodesModal
        open={flow.dialogStep === 'backupCodes'}
        codes={flow.revealedCodes}
        onDownload={flow.downloadCodes}
        onClose={flow.closeDialog}
      />

      <ConfirmDialog
        open={flow.showDisableConfirm}
        title={t('totp.disable.title', 'Disable two-factor authentication?')}
        message={t(
          'totp.disable.message',
          'You will no longer be prompted for a TOTP code on the sudo step-up. Your backup codes will be invalidated.',
        )}
        confirmLabel={t('totp.disable.confirm', 'Disable')}
        cancelLabel={t('totp.disable.cancel', 'Keep TOTP enabled')}
        variant="danger"
        loading={flow.revoking}
        confirmDisabled={!commandsReady}
        details={!commandsReady || submissionBlocked ? <HelperText>{blockedMessage}</HelperText> : undefined}
        requireTypedConfirmation="DISABLE"
        typedConfirmationLabel={flow.disableTypedLabel}
        onConfirm={guardCommand(flow.handleConfirmDisable, true)}
        onCancel={flow.closeDisableConfirm}
      />
    </>
  )
}

export default TOTPEnrollmentSection
