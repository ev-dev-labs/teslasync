/**
 * Phase-46 / Prompt 35 — TOTP enrollment UI.
 *
 * Renders a single GlassPanel under <section id="security"> on the
 * Settings page with three states:
 *
 *   1. Open mode (no forward-auth header configured upstream) — shows
 *      an inline "feature requires authenticated mode" placeholder.
 *      Mirrors the future <RequiresAuth capability="totp_enrollment">
 *      gate (prompt 57). The Enroll/Disable buttons are NOT rendered
 *      in this mode so no enroll endpoint is hit.
 *
 *   2. Forward-auth + not enrolled — shows a status pill ("Not
 *      enrolled") and an "Enroll" button. Clicking opens a Modal with
 *      the QR data URI (rendered as a plain <img>), the manual base32
 *      secret with a CopyButton, and a 6-digit verify input. On
 *      success the modal flips to a "Save these backup codes!" view
 *      with copy + download.
 *
 *   3. Forward-auth + active credential — shows "Active" pill, the
 *      last_used_at time, the remaining backup-code count, plus
 *      Regenerate-Backup-Codes and Disable buttons. Disable opens a
 *      ConfirmDialog with `requireTypedConfirmation="DISABLE"` and
 *      relies on the upstream RequireSudo middleware to trigger the
 *      ReauthDialog interceptor automatically.
 *
 * The section never throws — every error path renders an inline
 * ErrorText element so the rest of the Settings page keeps working.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, KeyRound, Download, RefreshCw, Trash2, AlertTriangle } from 'lucide-react'
import {
  GlassPanel,
  IconBox,
  Button,
  Badge,
  Input,
  Modal,
  ConfirmDialog,
  CopyButton,
  Heading,
  Text,
  ErrorText,
  HelperText,
  Code,
} from '@/components/ui'
import { Spinner } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { isApiError } from '@/api/client'
import {
  useTOTPStatus,
  useTOTPEnroll,
  useTOTPVerify,
  useTOTPRevoke,
  useTOTPRegenerateBackupCodes,
  TOTP_INVALID_CODE,
  TOTP_RATE_LIMITED_CODE,
  TOTP_ENROLLMENT_EXPIRED_CODE,
} from '@/api/hooks/useTOTP'
import type { TOTPEnrollment } from '@/api/types'

type DialogStep = 'enroll' | 'backupCodes' | 'closed'

export function TOTPEnrollmentSection() {
  const { t } = useTranslation('settings')

  const status = useTOTPStatus()
  const enrollMut = useTOTPEnroll()
  const verifyMut = useTOTPVerify()
  const revokeMut = useTOTPRevoke()
  const regenMut = useTOTPRegenerateBackupCodes()

  const [dialogStep, setDialogStep] = useState<DialogStep>('closed')
  const [enrollment, setEnrollment] = useState<TOTPEnrollment | null>(null)
  const [revealedCodes, setRevealedCodes] = useState<string[] | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)

  // Memoized i18n labels — must be at the top of the component so
  // they're called on every render path (the early returns below
  // would otherwise violate the rules of hooks).
  const disableTypedLabel = useMemo(
    () => t('totp.disable.typedLabel', 'Type DISABLE to confirm'),
    [t],
  )

  const closeDialog = useCallback(() => {
    setDialogStep('closed')
    setEnrollment(null)
    setRevealedCodes(null)
    setVerifyCode('')
    setVerifyError(null)
  }, [])

  const handleEnroll = useCallback(async () => {
    try {
      const result = await enrollMut.mutateAsync()
      setEnrollment(result)
      setVerifyCode('')
      setVerifyError(null)
      setDialogStep('enroll')
    } catch {
      // toast already surfaced by useTOTPEnroll's onError; nothing
      // else to do — the dialog stays closed and the section's pill
      // is unchanged.
    }
  }, [enrollMut])

  const handleVerify = useCallback(async () => {
    setVerifyError(null)
    const code = verifyCode.replace(/\D/g, '')
    if (code.length !== 6) {
      setVerifyError(t('totp.errors.codeLength', 'Enter all 6 digits.'))
      return
    }
    try {
      await verifyMut.mutateAsync({ code })
      setRevealedCodes(enrollment?.backup_codes ?? [])
      setDialogStep('backupCodes')
    } catch (err) {
      const code = isApiError(err) ? err.code : undefined
      if (code === TOTP_INVALID_CODE) {
        setVerifyError(t('totp.errors.invalidCode', 'Code did not match. Try the next one.'))
      } else if (code === TOTP_RATE_LIMITED_CODE) {
        setVerifyError(
          t(
            'totp.errors.rateLimited',
            'Too many incorrect attempts. Try again in 15 minutes.',
          ),
        )
      } else if (code === TOTP_ENROLLMENT_EXPIRED_CODE) {
        setVerifyError(
          t(
            'totp.errors.enrollmentExpired',
            'Enrollment expired. Close and start over.',
          ),
        )
      } else {
        setVerifyError(
          err instanceof Error
            ? err.message
            : t('totp.errors.verifyGeneric', 'Verification failed.'),
        )
      }
    }
  }, [enrollment, verifyCode, verifyMut, t])

  const handleConfirmDisable = useCallback(async () => {
    try {
      await revokeMut.mutateAsync()
    } catch {
      // toast already surfaced; dialog closes via finally below.
    } finally {
      setShowDisableConfirm(false)
    }
  }, [revokeMut])

  const handleRegenerate = useCallback(async () => {
    try {
      const result = await regenMut.mutateAsync()
      setRevealedCodes(result.backup_codes)
      setEnrollment(null)
      setDialogStep('backupCodes')
    } catch {
      // toast already surfaced; nothing else to do.
    }
  }, [regenMut])

  const downloadCodes = useCallback(() => {
    if (!revealedCodes || revealedCodes.length === 0) return
    const header = t(
      'totp.backupCodes.fileHeader',
      '# TeslaSync TOTP backup codes — keep secret.',
    )
    const body = `${header}\n\n${revealedCodes.join('\n')}\n`
    const blob = new Blob([body], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'teslasync-totp-backup-codes.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [revealedCodes, t])

  // Render branches ────────────────────────────────────────────────

  if (status.isLoading) {
    return (
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6 flex items-center gap-4">
          <Spinner size="sm" />
          <Text variant="bodySm">{t('totp.loading', 'Loading two-factor settings…')}</Text>
        </GlassPanel>
      </FadeIn>
    )
  }

  // Open-mode placeholder. Mirrors what <RequiresAuth> will render
  // once prompt 57 ships — for now we inline the message here.
  if (!status.data || status.data.mode === 'open') {
    return (
      <FadeIn delay={0.05}>
        <GlassPanel
          className="p-6 space-y-3"
          data-testid="totp-section-open-mode"
        >
          <div className="flex items-center gap-3">
            <IconBox color="amber">
              <AlertTriangle className="h-5 w-5" />
            </IconBox>
            <Heading level="panel">
              {t('totp.title', 'Two-factor authentication')}
            </Heading>
          </div>
          <HelperText>
            {t(
              'totp.openMode.message',
              'Per-user TOTP requires forward-auth mode. Configure your reverse proxy to inject X-Forwarded-User then reload.',
            )}
          </HelperText>
        </GlassPanel>
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
        <GlassPanel className="p-6 space-y-5" data-testid="totp-section">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <IconBox color={activated ? 'green' : 'cyan'}>
                <ShieldCheck className="h-5 w-5" />
              </IconBox>
              <div>
                <Heading level="panel">
                  {t('totp.title', 'Two-factor authentication')}
                </Heading>
                <HelperText>
                  {t(
                    'totp.subtitle',
                    'TOTP codes from your authenticator app are required for the sudo step-up before destructive admin actions.',
                  )}
                </HelperText>
              </div>
            </div>
            <Badge
              variant={activated ? 'success' : 'neutral'}
              data-testid="totp-status-pill"
            >
              {activated
                ? t('totp.status.active', 'Active')
                : t('totp.status.notEnrolled', 'Not enrolled')}
            </Badge>
          </div>

          {activated ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Text variant="label">
                    {t('totp.lastUsed.label', 'Last used')}
                  </Text>
                  <Text variant="bodySm">
                    {lastUsedAt
                      ? new Date(lastUsedAt).toLocaleString()
                      : t('totp.lastUsed.never', 'Never')}
                  </Text>
                </div>
                <div>
                  <Text variant="label">
                    {t('totp.backupCodesRemaining.label', 'Backup codes remaining')}
                  </Text>
                  <Text
                    variant="bodySm"
                    data-testid="totp-backup-remaining"
                  >
                    {backupRemaining}
                  </Text>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={handleRegenerate}
                  loading={regenMut.isPending}
                  data-testid="totp-regenerate"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('totp.actions.regenerate', 'Regenerate backup codes')}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setShowDisableConfirm(true)}
                  data-testid="totp-disable"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('totp.actions.disable', 'Disable')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={handleEnroll}
                loading={enrollMut.isPending}
                data-testid="totp-enroll"
              >
                <KeyRound className="h-4 w-4 mr-2" />
                {t('totp.actions.enroll', 'Enable TOTP')}
              </Button>
              <HelperText>
                {t(
                  'totp.actions.enrollHint',
                  'Compatible with Google Authenticator, 1Password, Bitwarden, Authy and other RFC 6238 clients.',
                )}
              </HelperText>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Enroll modal — QR + manual code + 6-digit verify */}
      <Modal
        open={dialogStep === 'enroll' && enrollment != null}
        onClose={closeDialog}
        size="sm"
        title={t('totp.modal.enrollTitle', 'Enable TOTP')}
        data-testid="totp-enroll-modal"
      >
        {enrollment != null ? (
          <div className="space-y-4">
            <Text variant="bodySm">
              {t(
                'totp.modal.scanInstructions',
                'Scan the QR code with your authenticator app, or enter the secret manually.',
              )}
            </Text>
            <div className="flex justify-center">
              <img
                src={enrollment.qr_data_uri}
                alt={t('totp.modal.qrAlt', 'TOTP QR code')}
                width={224}
                height={224}
                className="rounded-md border border-[var(--border-subtle)] bg-white p-2"
                data-testid="totp-qr"
              />
            </div>
            <div>
              <Text variant="label">
                {t('totp.modal.manualLabel', 'Manual entry secret')}
              </Text>
              <div className="flex items-center gap-2">
                <Code className="text-xs break-all flex-1" data-testid="totp-secret">
                  {enrollment.secret}
                </Code>
                <CopyButton text={enrollment.secret} />
              </div>
            </div>
            <div>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                label={t('totp.modal.codeLabel', 'Enter the 6-digit code from your app')}
                autoFocus
                data-testid="totp-verify-input"
                disabled={verifyMut.isPending}
              />
            </div>
            {verifyError != null ? (
              <ErrorText data-testid="totp-verify-error">{verifyError}</ErrorText>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={closeDialog}
                disabled={verifyMut.isPending}
              >
                {t('totp.modal.cancel', 'Cancel')}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleVerify}
                loading={verifyMut.isPending}
                data-testid="totp-verify-submit"
              >
                {t('totp.modal.verify', 'Verify and activate')}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Backup-codes reveal modal — shown ONCE after enroll/regen */}
      <Modal
        open={dialogStep === 'backupCodes' && revealedCodes != null}
        onClose={closeDialog}
        size="sm"
        title={t('totp.backupCodes.title', 'Save your backup codes')}
        data-testid="totp-backup-modal"
      >
        {revealedCodes != null ? (
          <div className="space-y-4">
            <Text variant="bodySm">
              {t(
                'totp.backupCodes.warning',
                'These codes will not be shown again. Store them in a password manager. Each code can be used once if you lose access to your authenticator app.',
              )}
            </Text>
            <ul
              className="grid grid-cols-2 gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              data-testid="totp-backup-list"
            >
              {revealedCodes.map((code) => (
                <li key={code}>
                  <Code className="text-xs">{code}</Code>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={downloadCodes}
                data-testid="totp-backup-download"
              >
                <Download className="h-4 w-4 mr-2" />
                {t('totp.backupCodes.download', 'Download .txt')}
              </Button>
              <CopyButton text={revealedCodes.join('\n')} />
              <Button
                type="button"
                variant="primary"
                onClick={closeDialog}
                data-testid="totp-backup-done"
              >
                {t('totp.backupCodes.done', 'I saved them')}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Disable confirmation — typed-confirmation + RequireSudo
          interceptor on the network round-trip handles the step-up. */}
      <ConfirmDialog
        open={showDisableConfirm}
        title={t('totp.disable.title', 'Disable two-factor authentication?')}
        message={t(
          'totp.disable.message',
          'You will no longer be prompted for a TOTP code on the sudo step-up. Your backup codes will be invalidated.',
        )}
        confirmLabel={t('totp.disable.confirm', 'Disable')}
        cancelLabel={t('totp.disable.cancel', 'Keep TOTP enabled')}
        variant="danger"
        loading={revokeMut.isPending}
        requireTypedConfirmation="DISABLE"
        typedConfirmationLabel={disableTypedLabel}
        onConfirm={handleConfirmDisable}
        onCancel={() => setShowDisableConfirm(false)}
      />
    </>
  )
}

export default TOTPEnrollmentSection
