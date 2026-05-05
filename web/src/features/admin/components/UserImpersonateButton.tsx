import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserCog } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useStartImpersonation } from '@/api/hooks/useImpersonation'

/**
 * Phase-46 / Prompt 46 — Per-row "Impersonate" button.
 *
 * Mounted in the admin Subjects list. Click flow:
 *   1. Open ConfirmDialog (warning variant, no silence key).
 *   2. On confirm, fire the start mutation. The mutation is
 *      sudo-gated upstream — the SPA's request() interceptor will
 *      surface the reauth dialog before the POST actually hits.
 *   3. On success the global ImpersonationBanner appears (driven by
 *      the status-poll cache invalidation inside the hook).
 *
 * Hidden in open-mode installs (parent component should gate render
 * on `useImpersonationStatus().data?.mode !== 'open'`); this
 * component intentionally does NOT re-check the mode so the parent
 * controls the visibility decision in one place.
 */
export interface UserImpersonateButtonProps {
  /**
   * The opaque proxy-issued subject identifier to impersonate. The
   * backend validates this against the active subjects list, so the
   * button does not need to filter — it just submits.
   */
  subject: string
  /**
   * Disable the button (e.g. when this row IS the current admin or
   * when impersonation is already active for someone else). The
   * parent owns the disabled-row decision.
   */
  disabled?: boolean
}

export function UserImpersonateButton({ subject, disabled }: UserImpersonateButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const startMut = useStartImpersonation()

  const handleClick = () => {
    if (disabled || startMut.isPending) return
    setOpen(true)
  }

  const handleConfirm = () => {
    setOpen(false)
    startMut.mutate({ subject })
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleClick}
        disabled={disabled || startMut.isPending}
        loading={startMut.isPending}
        icon={<UserCog className="h-4 w-4" aria-hidden />}
        data-testid={`user-impersonate-button-${subject}`}
        aria-label={t('impersonation.button.aria', 'Impersonate {{subject}}', { subject })}
      >
        {startMut.isPending
          ? t('impersonation.button.starting', 'Starting…')
          : t('impersonation.button.start', 'Impersonate')}
      </Button>
      <ConfirmDialog
        open={open}
        title={t('impersonation.confirm.title', 'Start impersonation session?')}
        message={t(
          'impersonation.confirm.message',
          'You will see TeslaSync as {{subject}} for up to 15 minutes. The action is logged to the audit log. End the session from the banner when you are done.',
          { subject },
        )}
        confirmLabel={t('impersonation.confirm.confirm', 'Start impersonation')}
        cancelLabel={t('impersonation.confirm.cancel', 'Cancel')}
        variant="warning"
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  )
}

export default UserImpersonateButton
