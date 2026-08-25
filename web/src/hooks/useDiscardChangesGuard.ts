import { useCallback } from 'react'
import type { ConfirmDialogProps } from '@/components/ui'
import { useConfirm } from '@/hooks/useConfirm'
import { useDirtyForm } from '@/hooks/useDirtyForm'
import { useNavigationGuard } from '@/hooks/useNavigationGuard'

export interface DiscardChangesGuardOptions {
  /** Optional workflow-specific warning shown for explicit and route closes. */
  message?: string
}

export interface DiscardChangesGuardResult {
  /** Request dismissal, resolving true only when the editor may close. */
  requestClose: () => Promise<boolean>
  /** Render with `<ConfirmDialog {...dialogProps} />` when non-null. */
  dialogProps: ConfirmDialogProps | null
}

/**
 * Standard unsaved-draft protection for modal and inline editors.
 *
 * Covers tab close/reload, guarded in-app navigation, and explicit close,
 * Cancel, backdrop, and Escape requests through one dirty-state contract.
 */
export function useDiscardChangesGuard(
  isDirty: boolean,
  onDiscard: () => void,
  options: DiscardChangesGuardOptions = {},
): DiscardChangesGuardResult {
  const dirtyForm = useDirtyForm(isDirty)
  const message = options.message ?? dirtyForm.message
  useNavigationGuard(isDirty, message)
  const { confirm, dialogProps } = useConfirm()

  const requestClose = useCallback(async () => {
    if (!isDirty) {
      onDiscard()
      return true
    }

    const confirmed = await confirm({
      title: dirtyForm.title,
      message,
      variant: 'warning',
      confirmLabel: dirtyForm.discardLabel,
      cancelLabel: dirtyForm.keepEditingLabel,
    })
    if (confirmed) onDiscard()
    return confirmed
  }, [
    confirm,
    dirtyForm.discardLabel,
    dirtyForm.keepEditingLabel,
    dirtyForm.title,
    isDirty,
    message,
    onDiscard,
  ])

  return { requestClose, dialogProps }
}
