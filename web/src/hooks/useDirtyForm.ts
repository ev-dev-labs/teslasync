import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Result of {@link useDirtyForm}.
 */
export interface UseDirtyFormResult {
  /** Mirror of the input flag — exposed for ergonomic destructuring. */
  isDirty: boolean
  /**
   * Localized "you have unsaved changes" copy. Pair with `useConfirm()` to
   * show a confirm dialog when the user clicks Cancel / a back link from
   * within an editor that is currently dirty.
   */
  message: string
  /** Localized title to use for the confirm dialog above. */
  title: string
  /** Localized "discard" button label. */
  discardLabel: string
  /** Localized "keep editing" button label. */
  keepEditingLabel: string
}

/**
 * Browser-level guard against losing unsaved form input.
 *
 * When `isDirty` is true, the hook installs a `beforeunload` listener so the
 * browser prompts the user before reloading the tab, closing it, or following
 * an external link. The listener is removed automatically when the form is
 * saved/reset (`isDirty` flips back to false) or the component unmounts.
 *
 * **In-app navigation guard:** TeslaSync uses `<BrowserRouter>` (not the
 * data-router API), so `react-router-dom`'s `useBlocker` is unavailable.
 * For in-app Cancel buttons, back links, etc. pair this hook with
 * {@link useConfirm} to show a confirm dialog using the localized
 * `title` / `message` / `discardLabel` / `keepEditingLabel` returned here.
 *
 * @example
 *   const { isDirty } = useDirtyForm(form.formState.isDirty)
 *   const { confirm, dialogProps } = useConfirm()
 *   const handleCancel = async () => {
 *     if (isDirty && !await confirm({
 *       title, message, variant: 'warning',
 *       confirmLabel: discardLabel, cancelLabel: keepEditingLabel,
 *     })) return
 *     navigate(-1)
 *   }
 */
export function useDirtyForm(isDirty: boolean): UseDirtyFormResult {
  const { t } = useTranslation()

  useEffect(() => {
    if (!isDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Setting returnValue is required for legacy browsers to display the
      // native unsaved-changes prompt. Modern browsers ignore the string.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  return {
    isDirty,
    title: t('forms.unsavedTitle', 'Unsaved changes'),
    message: t(
      'forms.unsavedWarning',
      'You have unsaved changes. Discard them?',
    ),
    discardLabel: t('forms.discard', 'Discard changes'),
    keepEditingLabel: t('forms.keepEditing', 'Keep editing'),
  }
}
