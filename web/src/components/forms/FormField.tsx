import {
  cloneElement,
  isValidElement,
  type ReactNode,
  useId,
} from 'react'
import { cn } from '@/lib/cn'
import { Label } from '@/components/ui/Label'

interface FieldControlProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-required'?: boolean | 'true' | 'false'
}

export interface FormFieldProps {
  /** Required visible label. */
  label: string
  /**
   * The form control. If you pass a single element with no `id` we'll inject
   * one so the `<label htmlFor>` association works for screen readers.
   */
  children: ReactNode
  /** Optional caller-supplied id; otherwise an auto id is generated. */
  htmlFor?: string
  /** Helper / hint text shown when there is no error. */
  hint?: ReactNode
  /** Validation error. When set, hint is hidden and the alert role exposed. */
  error?: string
  /** Marks the field as required (visual asterisk + a11y label). */
  required?: boolean
  /** Additional className applied to the wrapping `<div>`. */
  className?: string
}

/**
 * `<FormField>` — opinionated label + control + hint/error wrapper.
 *
 * Sibling controls in `@/components/ui` (`<Input>`, `<Select>`, `<Textarea>`)
 * already render their own label + hint + error block. Use those directly for
 * single-input fields. Reach for `<FormField>` when:
 *
 *   - The control is a custom composite (e.g. coordinate picker, code editor)
 *     that doesn't accept a `label` prop.
 *   - You need to lay out multiple controls under one shared label (e.g. a
 *     toggle group rendered as a row of buttons).
 *   - You're wiring a `react-hook-form` `<Controller>` and want a uniform
 *     `error={fieldState.error?.message}` rendering across the page.
 *
 * The component is intentionally tiny and unstyled — use Tailwind classes on
 * `className` for spacing tweaks.
 *
 * @example
 *   <FormField label={t('alerts.signal', 'Signal')} required error={errors.signal_name?.message}>
 *     <Select {...register('signal_name')} options={signalOptions} />
 *   </FormField>
 */
export function FormField({
  label,
  children,
  htmlFor,
  hint,
  error,
  required,
  className,
}: FormFieldProps) {
  const autoId = useId()
  const isSingleControl = isValidElement<FieldControlProps>(children)
  const childId = isSingleControl ? children.props.id : undefined
  const fieldId = htmlFor ?? childId ?? autoId
  const errorId = error ? `${fieldId}-error` : undefined
  const hintId = hint && !error ? `${fieldId}-hint` : undefined
  const feedbackId = errorId ?? hintId
  const control = isSingleControl
    ? cloneElement(children, {
        id: childId ?? fieldId,
        'aria-describedby': [
          children.props['aria-describedby'],
          feedbackId,
        ].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? 'true' : children.props['aria-invalid'],
        'aria-required': required ? 'true' : children.props['aria-required'],
      })
    : children

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label
        htmlFor={fieldId}
        required={required}
        className="block text-xs font-medium text-[var(--text-secondary)]"
      >
        {label}
      </Label>
      {control}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
