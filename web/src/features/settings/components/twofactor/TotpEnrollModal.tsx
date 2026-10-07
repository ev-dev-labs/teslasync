/**
 * Enroll modal — QR + manual secret + 6-digit verify.
 *
 * Presentational only; the enrollment payload, code value, error, and
 * submit/cancel intent all come from `useTotpEnrollmentFlow`. Retains
 * the original `data-testid` hooks used by the section contract test.
 */
import { useTranslation } from 'react-i18next'
import { Modal, Button, Input, CopyButton, Code, Text, ErrorText } from '@/components/ui'
import type { TOTPEnrollment } from '@/api/types'

interface TotpEnrollModalProps {
  open: boolean
  enrollment: TOTPEnrollment | null
  code: string
  error: string | null
  verifying: boolean
  onCodeChange: (value: string) => void
  onVerify: () => void
  onClose: () => void
}

export function TotpEnrollModal({
  open,
  enrollment,
  code,
  error,
  verifying,
  onCodeChange,
  onVerify,
  onClose,
}: TotpEnrollModalProps) {
  const { t } = useTranslation('settings')

  return (
    <Modal
      open={open && enrollment != null}
      onClose={onClose}
      size="sm"
      title={t('totp.modal.enrollTitle', 'Enable TOTP')}
      data-testid="totp-enroll-modal"
    >
      {enrollment != null ? (
        <div className="space-y-4">
          <Text variant="bodySm" as="p">
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
          <div className="space-y-1">
            <Text variant="label">{t('totp.modal.manualLabel', 'Manual entry secret')}</Text>
            <div className="flex items-center gap-2">
              <Code className="flex-1 break-all" data-testid="totp-secret">
                {enrollment.secret}
              </Code>
              <CopyButton text={enrollment.secret} />
            </div>
          </div>
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            // Enter submits the code so keyboard users don't have to tab to
            // the Verify button. Suppressed while a verify is in flight.
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !verifying) {
                e.preventDefault()
                onVerify()
              }
            }}
            label={t('totp.modal.codeLabel', 'Enter the 6-digit code from your app')}
            autoFocus
            data-testid="totp-verify-input"
            disabled={verifying}
          />
          {error ? <ErrorText data-testid="totp-verify-error">{error}</ErrorText> : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={verifying}>
              {t('totp.modal.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={onVerify}
              loading={verifying}
              data-testid="totp-verify-submit"
            >
              {t('totp.modal.verify', 'Verify and activate')}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

export default TotpEnrollModal
