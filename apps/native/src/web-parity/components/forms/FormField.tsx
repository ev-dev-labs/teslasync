/**
 * FormField — native parity port of web/src/components/forms/FormField.tsx.
 *
 * Opinionated label + control + hint/error wrapper. Mirrors the web component's
 * public API (FormFieldProps) one-for-one so callers that wrap a custom
 * composite control, lay out several controls under one shared label, or render
 * a react-hook-form <Controller> error get identical ergonomics on native.
 *
 * Sibling controls (Input/Select/Textarea) already render their own
 * label + hint + error block; use those directly for single-input fields. Reach
 * for FormField when the control is a custom composite that has no `label` prop,
 * when several controls share one label, or when you want uniform
 * `error={fieldState.error?.message}` rendering across a screen.
 *
 * Native adaptations vs. the web source:
 *   - The wrapping `<div className="space-y-1.5">` becomes a `<View>` with a
 *     6px vertical `gap` (Tailwind space-y-1.5 = 0.375rem = 6px). The Tailwind
 *     `cn()` merge + `className` override collapse to token styles; `className`
 *     is still accepted for source compatibility but ignored on native.
 *   - The `<label htmlFor>` / control `id` DOM association has no literal RN
 *     equivalent. `useId()` still derives `fieldId`/`errorId`/`hintId` (state
 *     names preserved); `fieldId` is applied as the label's `nativeID` so a
 *     caller can wire `accessibilityLabelledBy={fieldId}` on their control, and
 *     `errorId`/`hintId` tag the hint/error rows.
 *   - The visual `*` keeps showing for required fields; the screen-reader name
 *     swaps to "<label> required" (mirrors the web `aria-label="required"`).
 *   - `role="alert"` on the error row maps to `accessibilityRole="alert"` plus
 *     `accessibilityLiveRegion="assertive"` so validation errors are announced.
 *   - Colors map to tokens: var(--text-secondary) -> secondary tone,
 *     var(--text-muted) -> muted tone, text-rose-300 (error + required mark)
 *     -> danger tone. The label's `font-medium` (500) is applied via style.
 */

import React, {type ReactNode, useId} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

export interface FormFieldProps {
  /** Required visible label. */
  label: string;
  /**
   * The form control. If you pass a single element with no `id` we'll inject
   * one so the `<label htmlFor>` association works for screen readers.
   */
  children: ReactNode;
  /** Optional caller-supplied id; otherwise an auto id is generated. */
  htmlFor?: string;
  /** Helper / hint text shown when there is no error. */
  hint?: ReactNode;
  /** Validation error. When set, hint is hidden and the alert role exposed. */
  error?: string;
  /** Marks the field as required (visual asterisk + a11y label). */
  required?: boolean;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
}

/**
 * `<FormField>` — see the file header for the contract and native adaptations.
 */
export function FormField({
  label,
  children,
  htmlFor,
  hint,
  error,
  required,
  className: _className,
}: FormFieldProps) {
  const autoId = useId();
  const fieldId = htmlFor ?? autoId;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint && !error ? `${fieldId}-hint` : undefined;

  return (
    <View style={styles.field}>
      <AppText
        accessibilityLabel={required ? `${label} required` : undefined}
        nativeID={fieldId}
        style={styles.label}
        tone="secondary"
        variant="caption">
        {label}
        {required ? (
          <AppText tone="danger" variant="caption">
            {' *'}
          </AppText>
        ) : null}
      </AppText>
      {children}
      {error ? (
        <AppText
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          nativeID={errorId}
          tone="danger"
          variant="caption">
          {error}
        </AppText>
      ) : hint ? (
        <AppText nativeID={hintId} tone="muted" variant="caption">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

FormField.displayName = 'FormField';

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  label: {
    fontWeight: '500',
  },
});
