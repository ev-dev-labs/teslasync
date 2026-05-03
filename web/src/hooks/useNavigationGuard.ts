import { useCallback, useEffect, useId, useRef } from 'react'
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom'
import { useNavigationGuardContext } from '@/components/feedback/NavigationGuardProvider'

/**
 * Register the calling component's dirty-state with the global
 * {@link NavigationGuardProvider}.
 *
 * Pair with `react-hook-form`'s `formState.isDirty`, a `useFormDraft` diff,
 * or any other "user has unsaved edits" boolean. Until the form is saved or
 * reset, in-app navigations through {@link GuardedLink}, {@link GuardedNavLink},
 * {@link useGuardedNavigate}, and the browser back/forward buttons will
 * surface a confirm dialog.
 *
 * @param isDirty - True when the form has pending edits.
 * @param message - Optional localized prompt body (e.g. "You have an unsaved
 *   alert rule."). Falls back to the generic `forms.unsavedWarning` copy.
 *
 * @example
 *   const { isDirty } = formMethods.formState
 *   useNavigationGuard(isDirty, t('alerts.unsavedRule', 'You have an unsaved alert rule.'))
 */
export function useNavigationGuard(isDirty: boolean, message?: string): void {
  const id = useId()
  const ctx = useNavigationGuardContext()
  const isDirtyRef = useRef(isDirty)
  const messageRef = useRef(message)
  isDirtyRef.current = isDirty
  messageRef.current = message

  useEffect(() => {
    return ctx.register({
      id,
      isDirty: () => isDirtyRef.current,
      getMessage: () => messageRef.current,
    })
  }, [ctx, id])
}

/**
 * Drop-in replacement for `useNavigate()` that consults the global guard
 * before navigating. Use for imperative navigations from button handlers,
 * post-mutation redirects, etc., so they don't bypass the same dialog
 * `<GuardedLink>` shows.
 *
 * @example
 *   const guardedNavigate = useGuardedNavigate()
 *   const onCancel = () => guardedNavigate('/automations')
 */
export function useGuardedNavigate() {
  const navigate = useNavigate()
  const { confirmIfDirty } = useNavigationGuardContext()
  return useCallback(
    async (to: To | number, options?: NavigateOptions) => {
      const ok = await confirmIfDirty()
      if (!ok) return false
      if (typeof to === 'number') {
        navigate(to)
      } else {
        navigate(to, options)
      }
      return true
    },
    [navigate, confirmIfDirty],
  )
}
