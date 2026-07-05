/**
 * Backup-codes reveal modal — shown once after enroll or regenerate.
 *
 * The plain-text codes are surfaced a single time; this modal offers
 * copy + download before the user dismisses it. Presentational only —
 * the code list, download handler, and dismissal come from the flow.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { Modal, Button, CopyButton, Code, Text } from '@/components/ui'
import { EmptyState } from '@/components/feedback'

interface TotpBackupCodesModalProps {
  open: boolean
  codes: string[] | null
  onDownload: () => void
  onClose: () => void
}

export function TotpBackupCodesModal({ open, codes, onDownload, onClose }: TotpBackupCodesModalProps) {
  const { t } = useTranslation('settings')

  // Null-safe copy of the list so `.length`/`.map`/`.join` never touch a
  // nullish value, and a stable clipboard payload that only changes when the
  // codes do.
  const list = useMemo(() => codes ?? [], [codes])
  const clipboardText = useMemo(() => list.join('\n'), [list])
  const hasCodes = list.length > 0

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
          {hasCodes ? (
            <>
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
                {list.map((c, i) => (
                  <li key={`${c}-${i}`}>
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
                <CopyButton text={clipboardText} />
                <Button type="button" variant="primary" onClick={onClose} data-testid="totp-backup-done">
                  {t('totp.backupCodes.done', 'I saved them')}
                </Button>
              </div>
            </>
          ) : (
            // Degraded path: the enroll/regenerate response carried no codes.
            // Never render an empty grid with a copy button that copies nothing
            // — surface an actionable empty state and a way out instead.
            <div className="space-y-4" data-testid="totp-backup-empty">
              <EmptyState
                message={t(
                  'totp.backupCodes.empty',
                  'No backup codes were returned. Close this dialog and regenerate your codes from the two-factor settings.',
                )}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  onClick={onClose}
                  data-testid="totp-backup-dismiss"
                >
                  {t('totp.backupCodes.close', 'Close')}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  )
}

export default TotpBackupCodesModal
