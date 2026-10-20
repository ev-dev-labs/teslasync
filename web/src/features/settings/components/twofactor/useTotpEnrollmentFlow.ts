/**
 * TOTP enrollment flow controller.
 *
 * Owns the whole client-side state machine for the two-factor page:
 * the enroll → verify → backup-codes dialog progression, the disable
 * confirmation, and the copy/download of one-time backup codes. All
 * mutation wiring lives here so the presentational surfaces
 * (`TotpStatusHero`, `TotpEnrollModal`, `TotpBackupCodesModal`) stay
 * dumb and easy to test.
 *
 * Pending mutations retain their dialog until settlement. UI settlement
 * belongs to the captured query-client/auth-mode instance and attempt;
 * invalidating that ownership does not cancel the server operation.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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

export type TotpDialogStep = 'enroll' | 'backupCodes' | 'closed'
type PendingAction = 'enroll' | 'verify' | 'revoke' | 'regenerate'

export function useTotpEnrollmentFlow() {
  const { t } = useTranslation('settings')

  const status = useTOTPStatus()
  const queryClient = useQueryClient()
  const enrollMut = useTOTPEnroll()
  const verifyMut = useTOTPVerify()
  const revokeMut = useTOTPRevoke()
  const regenMut = useTOTPRegenerateBackupCodes()

  const [dialogStep, setDialogStep] = useState<TotpDialogStep>('closed')
  const [enrollment, setEnrollment] = useState<TOTPEnrollment | null>(null)
  const [revealedCodes, setRevealedCodes] = useState<string[] | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const instance = useRef<object | null>(null)
  const pendingAttempt = useRef<object | null>(null)
  const mode = status.data?.mode ?? 'session'

  useLayoutEffect(() => {
    instance.current = {}
    pendingAttempt.current = null
    setPendingAction(null)
    setDialogStep('closed')
    setEnrollment(null)
    setRevealedCodes(null)
    setVerifyCode('')
    setVerifyError(null)
    setShowDisableConfirm(false)
    return () => {
      // Invalidate UI ownership only; the server mutation is not aborted.
      instance.current = null
      pendingAttempt.current = null
    }
  }, [queryClient, mode])

  const beginAttempt = useCallback((action: PendingAction) => {
    if (!instance.current || pendingAttempt.current || mode === 'open') return null
    const owner = instance.current
    const attempt = {}
    pendingAttempt.current = attempt
    setPendingAction(action)
    const isCurrent = () => instance.current === owner && pendingAttempt.current === attempt
    return {
      isCurrent,
      settle: () => {
        if (!isCurrent()) return
        pendingAttempt.current = null
        setPendingAction(null)
      },
    }
  }, [mode])

  const disableTypedLabel = useMemo(
    () => t('totp.disable.typedLabel', 'Type DISABLE to confirm'),
    [t],
  )

  const closeDialog = useCallback(() => {
    if (pendingAttempt.current) return
    setDialogStep('closed')
    setEnrollment(null)
    setRevealedCodes(null)
    setVerifyCode('')
    setVerifyError(null)
  }, [])

  const handleEnroll = useCallback(async () => {
    const attempt = beginAttempt('enroll')
    if (!attempt) return
    try {
      const result = await enrollMut.mutateAsync()
      if (!attempt.isCurrent()) return
      setEnrollment(result)
      setVerifyCode('')
      setVerifyError(null)
      setDialogStep('enroll')
    } catch {
      // toast already surfaced by useTOTPEnroll's onError; the dialog
      // stays closed and the section's pill is unchanged.
    } finally {
      attempt.settle()
    }
  }, [enrollMut, beginAttempt])

  const handleVerify = useCallback(async () => {
    if (pendingAttempt.current) return
    setVerifyError(null)
    const code = verifyCode.replace(/\D/g, '')
    if (code.length !== 6) {
      setVerifyError(t('totp.errors.codeLength', 'Enter all 6 digits.'))
      return
    }
    const attempt = beginAttempt('verify')
    if (!attempt) return
    try {
      await verifyMut.mutateAsync({ code })
      if (!attempt.isCurrent()) return
      setRevealedCodes(enrollment?.backup_codes ?? [])
      setDialogStep('backupCodes')
    } catch (err) {
      if (!attempt.isCurrent()) return
      const errCode = isApiError(err) ? err.code : undefined
      if (errCode === TOTP_INVALID_CODE) {
        setVerifyError(t('totp.errors.invalidCode', 'Code did not match. Try the next one.'))
      } else if (errCode === TOTP_RATE_LIMITED_CODE) {
        setVerifyError(
          t('totp.errors.rateLimited', 'Too many incorrect attempts. Try again in 15 minutes.'),
        )
      } else if (errCode === TOTP_ENROLLMENT_EXPIRED_CODE) {
        setVerifyError(
          t('totp.errors.enrollmentExpired', 'Enrollment expired. Close and start over.'),
        )
      } else {
        setVerifyError(
          err instanceof Error
            ? err.message
            : t('totp.errors.verifyGeneric', 'Verification failed.'),
        )
      }
    } finally {
      attempt.settle()
    }
  }, [enrollment, verifyCode, verifyMut, t, beginAttempt])

  const handleConfirmDisable = useCallback(async () => {
    const attempt = beginAttempt('revoke')
    if (!attempt) return
    try {
      await revokeMut.mutateAsync()
    } catch {
      // toast already surfaced; dialog closes via finally below.
    } finally {
      if (attempt.isCurrent()) setShowDisableConfirm(false)
      attempt.settle()
    }
  }, [revokeMut, beginAttempt])

  const handleRegenerate = useCallback(async () => {
    const attempt = beginAttempt('regenerate')
    if (!attempt) return
    try {
      const result = await regenMut.mutateAsync()
      if (!attempt.isCurrent()) return
      // Mirror handleVerify's `?? []` guard: a malformed response missing
      // `backup_codes` must still leave `revealedCodes` a real array so the
      // state stays `string[] | null` (never `undefined`) and the
      // backup-codes modal — which only opens when `codes != null` — still
      // surfaces rather than silently vanishing after a successful regen.
      setRevealedCodes(result.backup_codes ?? [])
      setEnrollment(null)
      setDialogStep('backupCodes')
    } catch {
      // toast already surfaced; nothing else to do.
    } finally {
      attempt.settle()
    }
  }, [regenMut, beginAttempt])

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

  const openDisableConfirm = useCallback(() => {
    if (!pendingAttempt.current) setShowDisableConfirm(true)
  }, [])
  const closeDisableConfirm = useCallback(() => {
    if (!pendingAttempt.current) setShowDisableConfirm(false)
  }, [])
  const changeVerifyCode = useCallback(
    (raw: string) => {
      if (!pendingAttempt.current) setVerifyCode(raw.replace(/\D/g, '').slice(0, 6))
    },
    [],
  )

  return {
    status,
    dialogStep,
    enrollment,
    revealedCodes,
    verifyCode,
    verifyError,
    showDisableConfirm,
    disableTypedLabel,
    enrolling: pendingAction === 'enroll',
    verifying: pendingAction === 'verify',
    regenerating: pendingAction === 'regenerate',
    revoking: pendingAction === 'revoke',
    handleEnroll,
    handleVerify,
    handleConfirmDisable,
    handleRegenerate,
    downloadCodes,
    closeDialog,
    openDisableConfirm,
    closeDisableConfirm,
    changeVerifyCode,
  }
}
