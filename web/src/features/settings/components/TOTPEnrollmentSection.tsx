/**
 * TOTP enrollment section — the interactive core of the two-factor page.
 *
 * Thin stateful container: it drives `useTotpEnrollmentFlow` (the
 * enroll → verify → backup-codes state machine + disable confirmation)
 * and composes the presentational surfaces in `./twofactor`:
 *
 *   • Open mode (no forward-auth header upstream) → `TotpOpenModeNotice`
 *     — the enroll/disable controls are NOT rendered so no enroll
 *     endpoint is hit. Mirrors the future
 *     `<RequiresAuth capability="totp_enrollment">` gate.
 *   • Forward-auth + not enrolled → `TotpStatusHero` with an "Enable
 *     TOTP" button that opens `TotpEnrollModal` (QR + manual secret +
 *     6-digit verify). Success flips to `TotpBackupCodesModal`.
 *   • Forward-auth + active credential → `TotpStatusHero` with last-used
 *     time, remaining backup-code count, and Regenerate + Disable. Disable
 *     opens a typed-confirmation `ConfirmDialog`; the upstream RequireSudo
 *     middleware triggers the ReauthDialog interceptor automatically.
 *
 * The section never throws — every mutation error is surfaced by the
 * flow's toasts or inline error text so the rest of the page keeps
 * working.
 */
import { useTranslation } from 'react-i18next'
import { GlassPanel, ConfirmDialog, Text } from '@/components/ui'
import { Skeleton } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import {
  useTotpEnrollmentFlow,
  TotpStatusHero,
  TotpEnrollModal,
  TotpBackupCodesModal,
  TotpOpenModeNotice,
} from './twofactor'

export function TOTPEnrollmentSection() {
  const { t } = useTranslation('settings')
  const flow = useTotpEnrollmentFlow()
  const { status } = flow

  if (status.isLoading) {
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
            <Text variant="bodySm" className="sr-only">
              {t('totp.loading', 'Loading two-factor settings…')}
            </Text>
          </div>
        </GlassPanel>
      </FadeIn>
    )
  }

  if (!status.data || status.data.mode === 'open') {
    return (
      <FadeIn delay={0.05}>
        <TotpOpenModeNotice />
      </FadeIn>
    )
  }

  const sessionStatus = status.data
  const activated = sessionStatus.activated === true
  const lastUsedAt = activated ? sessionStatus.last_used_at : undefined
  const backupRemaining = activated ? sessionStatus.backup_codes_remaining ?? 0 : 0

  return (
    <>
      <FadeIn delay={0.05}>
        <TotpStatusHero
          activated={activated}
          lastUsedAt={lastUsedAt}
          backupRemaining={backupRemaining}
          enrolling={flow.enrolling}
          regenerating={flow.regenerating}
          onEnroll={flow.handleEnroll}
          onRegenerate={flow.handleRegenerate}
          onDisable={flow.openDisableConfirm}
        />
      </FadeIn>

      <TotpEnrollModal
        open={flow.dialogStep === 'enroll'}
        enrollment={flow.enrollment}
        code={flow.verifyCode}
        error={flow.verifyError}
        verifying={flow.verifying}
        onCodeChange={flow.changeVerifyCode}
        onVerify={flow.handleVerify}
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
        requireTypedConfirmation="DISABLE"
        typedConfirmationLabel={flow.disableTypedLabel}
        onConfirm={flow.handleConfirmDisable}
        onCancel={flow.closeDisableConfirm}
      />
    </>
  )
}

export default TOTPEnrollmentSection
