import { forwardRef, useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Text } from './Typography';

const sizes = {
  sm: { box: 'h-3.5 w-3.5', icon: 'h-2.5 w-2.5' },
  md: { box: 'h-4 w-4', icon: 'h-3 w-3' },
  lg: { box: 'h-5 w-5', icon: 'h-3.5 w-3.5' },
} as const;

export type CheckboxSize = keyof typeof sizes;

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'size'> {
  /** Optional inline label rendered to the right of the box. */
  label?: ReactNode;
  /** Mixed-state checkbox (typically used by "select all" headers). */
  indeterminate?: boolean;
  /** Visual size of the box. Defaults to `md`. */
  size?: CheckboxSize;
  /** Standard React-style change handler reporting the new boolean. */
  onChange?: (checked: boolean) => void;
}

/**
 * Accessible checkbox primitive.
 *
 * Uses a visually-hidden native `<input type="checkbox">` for keyboard,
 * screen-reader, and form-association semantics, layered with a styled
 * indicator that follows the design system tokens. Supports the
 * indeterminate (mixed) state for bulk-selection patterns.
 *
 * The `<input>` element here is intentional — `components/ui/` is
 * exempt from the audit's raw-HTML rule precisely because this is
 * where shared primitives live. Feature pages should import this
 * component instead of writing their own checkbox.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      indeterminate = false,
      size = 'md',
      onChange,
      className,
      disabled,
      checked,
      defaultChecked,
      id,
      ...inputProps
    },
    forwardedRef,
  ) => {
    const localRef = useRef<HTMLInputElement | null>(null);
    const generatedId = useId();
    const inputId = id ?? generatedId;

    useEffect(() => {
      const el = localRef.current;
      if (!el) return;
      el.indeterminate = indeterminate;
    }, [indeterminate, checked]);

    const setRefs = (node: HTMLInputElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    };

    const dims = sizes[size];

    const indicator = (
      <span
        aria-hidden="true"
        className={cn(
          'checkbox-indicator inline-flex shrink-0 items-center justify-center rounded-shape-sm border transition-colors duration-fast ease-standard motion-reduce:transition-none',
          dims.box,
          'border-[var(--control-border)] bg-[var(--control-bg)] text-transparent',
          'peer-checked:border-[var(--theme-primary)] peer-checked:bg-[var(--theme-primary)] peer-checked:text-[var(--theme-on-primary)]',
          'peer-indeterminate:border-[var(--theme-primary)] peer-indeterminate:bg-[var(--theme-primary)] peer-indeterminate:text-[var(--theme-on-primary)]',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring)]',
          'forced-colors:border-[var(--border-strong)] forced-colors:bg-[var(--surface-2)] forced-colors:peer-focus-visible:outline-[var(--theme-primary)]',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-80',
        )}
      >
        {indeterminate ? <Minus className={dims.icon} strokeWidth={3} /> : <Check className={dims.icon} strokeWidth={3} />}
      </span>
    );

    return (
      <label
        htmlFor={inputId}
        className={cn(
          'relative inline-flex min-h-11 min-w-11 max-w-full cursor-pointer items-center gap-2 select-none md:min-h-6 md:min-w-6',
          disabled && 'cursor-not-allowed opacity-60',
          className,
        )}
      >
        <input
          ref={setRefs}
          id={inputId}
          type="checkbox"
          // `peer` powers the indicator's checked/focus/disabled styles
          // via Tailwind's peer-* variants. `sr-only` hides it visually
          // while keeping it in the accessibility tree.
          className="peer sr-only"
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          onChange={e => {
            if (disabled) return;
            onChange?.(e.target.checked);
          }}
          {...inputProps}
        />
        {indicator}
        {label != null && <Text variant="bodySm" className="min-w-0 break-words">{label}</Text>}
      </label>
    );
  },
);
Checkbox.displayName = 'Checkbox';
