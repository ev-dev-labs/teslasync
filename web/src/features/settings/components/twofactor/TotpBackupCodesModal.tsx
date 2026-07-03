/**
 * Backup-codes reveal modal — shown once after enroll or regenerate.
 *
 * The plain-text codes are surfaced a single time; this modal offers
 * copy + download before the user dismisses it. Presentational only —
 * the code list, download handler, and dismissal come from the flow.
 */
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { Modal, Button, CopyButton, Code, Text } from '@/components/ui'

interface TotpBackupCodesModalProps {
  open: boolean
  codes: string[] | null
  onDownload: () => void
  onClose: () => void
}

export function TotpBackupCodesModal({ open, codes, onDownload, onClose }: TotpBackupCodesModalProps) {
  const { t } = useTranslation('settings')

  return (
    <Modal
      open={open && codes != null}
      onClose={onClose}
      size="sm"
      title={t('totp.backupCodes.title', 'Save your backup codes')}
      data-testid="totp-backup-modal"
    >
      {codes != null ? (
        <div className="space-y-4">
          <Text variant="bodySm" as="p">
            {t(
              'totp.backupCodes.warning',
              'These codes will not be shown again. Store them in a password manager. Each code can be used once if you lose access to your authenticator app.',
            )}
          </Text>
          <ul
            className="grid grid-cols-2 gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
            data-testid="totp-backup-list"
          >
            {(codes ?? []).map((c) => (
              <li key={c}>
                <Code>{c}</Code>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onDownload}
              data-testid="totp-backup-download"
            >
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('totp.backupCodes.download', 'Download .txt')}
            </Button>
            <CopyButton text={(codes ?? []).join('\n')} />
            <Button type="button" variant="primary" onClick={onClose} data-testid="totp-backup-done">
              {t('totp.backupCodes.done', 'I saved them')}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

export default TotpBackupCodesModal
