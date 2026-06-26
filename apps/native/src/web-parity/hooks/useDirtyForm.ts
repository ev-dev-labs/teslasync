// Native parity port of web/src/hooks/useDirtyForm.ts.
//
// The web hook does two things: (1) returns the localized "unsaved changes"
// confirm copy, and (2) installs a `window` `beforeunload` listener so the
// browser prompts before a tab reload / close / external link while the form is
// dirty. On React Native:
//
//   - There is NO tab / reload lifecycle and NO `beforeunload` event, so the
//     browser-level guard (web L49-59: `window.addEventListener('beforeunload',
//     handler)` + the `event.preventDefault()` / `event.returnValue = ''`
//     handler + the unmount cleanup) is STRUCTURALLY UNAVAILABLE. The OS will
//     suspend / terminate the app without giving JS a cancellable prompt, so the
//     effect has no native analogue and is dropped. The hook therefore degrades
//     to a pure localized-copy provider on native — the in-app "leaving a dirty
//     editor" guard is owned by NavigationGuardProvider
//     (../components/feedback/NavigationGuardProvider), which intercepts the
//     Android hardware Back press and the guarded-navigation affordances using
//     the SAME `forms.*` copy returned here.
//   - react-i18next `useTranslation` (web L2) is not in the apps/native manifest,
//     so it is replaced by the inlined `useNativeTranslationFallback()` shim
//     (the established NavigationGuardProvider pattern): a `useCallback`-stable
//     `(key, fallback) => fallback` function that preserves every i18n key
//     (forms.unsavedTitle / forms.unsavedWarning / forms.discard /
//     forms.keepEditing) as the first argument while returning the English
//     fallback copy verbatim.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported — only react's `useCallback`.

import { useCallback } from 'react';

/**
 * Result of {@link useDirtyForm}.
 */
export interface UseDirtyFormResult {
  /** Mirror of the input flag — exposed for ergonomic destructuring. */
  isDirty: boolean;
  /**
   * Localized "you have unsaved changes" copy. Pair with `useConfirm()` to
   * show a confirm dialog when the user clicks Cancel / a back link from
   * within an editor that is currently dirty.
   */
  message: string;
  /** Localized title to use for the confirm dialog above. */
  title: string;
  /** Localized "discard" button label. */
  discardLabel: string;
  /** Localized "keep editing" button label. */
  keepEditingLabel: string;
}

/** Native fallback translator signature — `(key, fallback) => fallback`. */
type NativeTFunction = (key: string, fallback: string) => string;

/**
 * Native stand-in for react-i18next `useTranslation().t`. The apps/native
 * manifest has no i18next runtime, so this returns a stable function that
 * ignores the (preserved) translation key and returns the English fallback
 * copy. Mirrors the NavigationGuardProvider shim so both consumers of the
 * `forms.*` keys resolve to identical strings.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * Guard helper for losing unsaved form input.
 *
 * On the web this hook installs a `beforeunload` listener so the browser
 * prompts the user before reloading the tab, closing it, or following an
 * external link while `isDirty` is true. **React Native has no tab/reload
 * lifecycle and no `beforeunload`**, so that browser-level guard is
 * structurally unavailable and is intentionally not wired here — the hook
 * degrades to returning the localized confirm copy below.
 *
 * **In-app navigation guard:** pair the returned copy with the native
 * NavigationGuardProvider (`../components/feedback/NavigationGuardProvider`) /
 * `useConfirm`-style confirm dialog to block Cancel buttons, back
 * affordances, and the Android hardware Back press from within a dirty editor,
 * using the localized `title` / `message` / `discardLabel` / `keepEditingLabel`
 * returned here.
 * @example
 *   const { isDirty, title, message, discardLabel, keepEditingLabel } =
 *     useDirtyForm(form.formState.isDirty)
 *   const { confirm } = useConfirm()
 *   const handleCancel = async () => {
 *     if (isDirty && !await confirm({
 *       title, message, variant: 'warning',
 *       confirmLabel: discardLabel, cancelLabel: keepEditingLabel,
 *     })) return
 *     goBack()
 *   }
 */
export function useDirtyForm(isDirty: boolean): UseDirtyFormResult {
  const t = useNativeTranslationFallback();

  // The web hook installs a `window` 'beforeunload' guard keyed on `isDirty`
  // (web L49-59); React Native has no such tab/reload lifecycle, so there is no
  // listener to install or tear down — only the localized confirm copy below is
  // reproduced for the in-app navigation guard.
  return {
    isDirty,
    title: t('forms.unsavedTitle', 'Unsaved changes'),
    message: t(
      'forms.unsavedWarning',
      'You have unsaved changes. Discard them?',
    ),
    discardLabel: t('forms.discard', 'Discard changes'),
    keepEditingLabel: t('forms.keepEditing', 'Keep editing'),
  };
}
